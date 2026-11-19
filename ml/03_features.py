"""Phase 2, step 1: build the monthly risk panel -> data/processed/panel.parquet + cells.parquet.

Unit = (H3 res-9 cell, month, 2-hour bucket 0-11). Target = at least one incident in that
cell/bucket/month. All lag features use only months strictly before the row's month.

Cell universe = every cell with at least one incident since the start date, plus its k=1 ring
(so quiet streets next to hotspots are scored too). One extra "forecast" month after the last
complete month is added with lag features only; 04_train.py scores it to get the latest risk.

Usage: python ml/03_features.py
"""
from __future__ import annotations

import sys
import time
from typing import Any

import h3
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from common import PROCESSED_DIR, RAW_DIR, load_config

EARTH_R_M = 6_371_000.0
LAGS = (1, 3, 12)


# ---------------------------------------------------------------- small helpers
def last_complete_month(max_date: pd.Timestamp) -> pd.Period:
    """The month of max_date if the data reaches its last day, else the month before."""
    p = max_date.to_period("M")
    return p if max_date.normalize() >= p.end_time.normalize() else p - 1


def cell_universe(incident_cells: pd.Series) -> list[str]:
    cells = set(incident_cells.dropna().unique())
    ring = {n for c in cells for n in h3.grid_disk(c, 1)}
    return sorted(cells | ring)


def neighbour_index(cells: list[str]) -> np.ndarray:
    """(C, 6) indices of each cell's k=1 neighbours inside the universe; -1 where missing."""
    pos = {c: i for i, c in enumerate(cells)}
    out = np.full((len(cells), 6), -1, dtype=np.int64)
    for i, c in enumerate(cells):
        nbrs = [pos[n] for n in h3.grid_disk(c, 1) if n != c and n in pos]
        out[i, : len(nbrs)] = nbrs
    return out


def lag_sum(cube: np.ndarray, k: int) -> np.ndarray:
    """Sum over the previous k months (axis 1), excluding the current month. Shape preserved."""
    cs = np.concatenate([np.zeros_like(cube[:, :1]), np.cumsum(cube, axis=1)], axis=1)
    m = np.arange(cube.shape[1])
    return cs[:, m] - cs[:, np.maximum(m - k, 0)]


def ring_sum(arr: np.ndarray, nbr: np.ndarray) -> np.ndarray:
    """Sum of arr over each cell's neighbours (arr's first axis = cell)."""
    padded = np.concatenate([arr, np.zeros_like(arr[:1])], axis=0)  # index -1 -> zero row
    out = np.zeros_like(arr)
    for j in range(nbr.shape[1]):
        out += padded[nbr[:, j]]
    return out


# ---------------------------------------------------------------- panel
def build_panel(inc: pd.DataFrame, cells: list[str], first: pd.Period, last: pd.Period,
                n_buckets: int = 12, min_history: int = 12) -> pd.DataFrame:
    """Dense monthly panel. `last` = last complete month; one forecast month is appended.

    inc needs columns: date, h3, severity, after_dark.
    Returns one row per (cell_idx, month, bucket) for months first+min_history .. last+1.
    """
    months = pd.period_range(first, last + 1, freq="M")  # last slot = forecast month (no data)
    C, M, B = len(cells), len(months), n_buckets
    pos = pd.Series(np.arange(C), index=cells)

    d = inc[inc["h3"].isin(pos.index)]
    mper = d["date"].dt.to_period("M")
    d = d[(mper >= first) & (mper <= last)]
    ci = pos.loc[d["h3"]].to_numpy()
    mi = ((d["date"].dt.year - first.year) * 12 + d["date"].dt.month - first.month).to_numpy()
    bi = (d["date"].dt.hour // (24 // B)).to_numpy()

    cnt = np.zeros((C, M, B), np.float32)
    sev = np.zeros((C, M, B), np.float32)
    dark = np.zeros((C, M), np.float32)
    np.add.at(cnt, (ci, mi, bi), 1)
    np.add.at(sev, (ci, mi, bi), d["severity"].to_numpy(np.float32))
    np.add.at(dark, (ci, mi), d["after_dark"].to_numpy(np.float32))

    nbr = neighbour_index(cells)
    feats: dict[str, np.ndarray] = {}
    for k in LAGS:
        c_l, s_l = lag_sum(cnt, k), lag_sum(sev, k)
        feats[f"cnt_l{k}"], feats[f"sev_l{k}"] = c_l, s_l
        feats[f"nb_cnt_l{k}"], feats[f"nb_sev_l{k}"] = ring_sum(c_l, nbr), ring_sum(s_l, nbr)

    cell_cnt = cnt.sum(axis=2)
    cell_cnt_l12 = lag_sum(cell_cnt, 12)
    cell_l = {
        "cell_cnt_l1": lag_sum(cell_cnt, 1),
        "cell_cnt_l12": cell_cnt_l12,
        "cell_sev_l12": lag_sum(sev.sum(axis=2), 12),
        "nb_cell_cnt_l12": ring_sum(cell_cnt_l12, nbr),
        "dark_share_l12": np.where(cell_cnt_l12 > 0, lag_sum(dark, 12) / np.maximum(cell_cnt_l12, 1), np.nan),
    }
    for name, a in cell_l.items():
        feats[name] = np.broadcast_to(a[:, :, None], (C, M, B))

    keep = slice(min_history, M)
    Mk = M - min_history
    cidx, midx, bidx = np.meshgrid(np.arange(C), np.arange(min_history, M), np.arange(B), indexing="ij")
    panel = pd.DataFrame({
        "cell_idx": cidx.ravel().astype(np.int32),
        "month": np.array([str(p) for p in months])[midx.ravel()],
        "bucket": bidx.ravel().astype(np.int8),
        "moy": np.array([p.month for p in months], np.int8)[midx.ravel()],
    })
    for name, a in feats.items():
        panel[name] = np.ascontiguousarray(a[:, keep, :]).reshape(C * Mk * B).astype(np.float32)
    y_count = cnt[:, keep, :].reshape(C * Mk * B)
    panel["y_count"] = y_count
    panel["y"] = (y_count > 0).astype(np.int8)
    is_fc = panel["month"] == str(last + 1)
    panel.loc[is_fc, ["y_count", "y"]] = np.nan  # unknown future
    return panel


def assign_split(month: pd.Series, train_end: str, valid_end: str, forecast_month: str) -> pd.Series:
    s = np.where(month <= train_end, "train", np.where(month <= valid_end, "valid", "test"))
    s = np.where(month == forecast_month, "forecast", s)
    return pd.Series(s, index=month.index)


# ---------------------------------------------------------------- static environment per cell
def haversine_tree(lat: np.ndarray, lon: np.ndarray) -> BallTree:
    return BallTree(np.radians(np.c_[lat, lon]), metric="haversine")


def cell_static(cells: list[str], lamps: pd.DataFrame, pois: pd.DataFrame, stations: pd.DataFrame,
                cfg: dict[str, Any]) -> pd.DataFrame:
    res = int(cfg["h3_resolution"])
    night = set(cfg["model"]["night_poi_categories"])
    out = pd.DataFrame({"h3": cells})

    def per_cell(df: pd.DataFrame) -> pd.Series:
        if df.empty:
            return pd.Series(0, index=out.index, dtype=np.float32)
        h = pd.Series([h3.latlng_to_cell(a, b, res) for a, b in zip(df["lat"], df["lon"])])
        return out["h3"].map(h.value_counts()).fillna(0).astype(np.float32)

    out["lamps"] = per_cell(lamps)
    out["pois"] = per_cell(pois)
    out["night_pois"] = per_cell(pois[pois["category"].isin(night)])
    centres = np.array([h3.cell_to_latlng(c) for c in cells])
    st = stations.dropna(subset=["latitude", "longitude"])
    dist, _ = haversine_tree(st["latitude"].to_numpy(float), st["longitude"].to_numpy(float)).query(
        np.radians(centres), k=1)
    out["police_km"] = (dist[:, 0] * EARTH_R_M / 1000).astype(np.float32)
    out["lat"], out["lon"] = centres[:, 0], centres[:, 1]
    return out


# ---------------------------------------------------------------- main
def main() -> int:
    t0 = time.time()
    cfg = load_config()
    mcfg = cfg["model"]
    inc_path = PROCESSED_DIR / "incidents.parquet"
    if not inc_path.exists():
        print(f"Missing {inc_path}. Run `npm run data` first.", file=sys.stderr)
        return 1
    inc = pd.read_parquet(inc_path, columns=["date", "h3", "severity", "after_dark"])
    first = inc["date"].min().to_period("M")
    last = last_complete_month(inc["date"].max())
    cells = cell_universe(inc["h3"])
    print(f"Incidents {len(inc):,}  months {first}..{last} (+ forecast {last + 1})  cells {len(cells):,}")

    panel = build_panel(inc, cells, first, last, int(mcfg["n_buckets"]), int(mcfg["min_history_months"]))
    panel["split"] = assign_split(panel["month"], mcfg["train_end"], mcfg["valid_end"], str(last + 1))

    static = cell_static(cells, pd.read_parquet(RAW_DIR / "osm_lamps.parquet"),
                         pd.read_parquet(RAW_DIR / "osm_pois.parquet"),
                         pd.read_csv(RAW_DIR / "police_stations.csv"), cfg)
    static.insert(0, "cell_idx", np.arange(len(cells), dtype=np.int32))

    panel.to_parquet(PROCESSED_DIR / "panel.parquet", index=False)
    static.to_parquet(PROCESSED_DIR / "cells.parquet", index=False)
    summary = panel.groupby("split", sort=False).agg(rows=("y", "size"), pos_rate=("y", "mean"),
                                                     months=("month", "nunique"))
    print(summary.to_string())
    print(f"Saved panel {panel.shape} and {len(static):,} cells in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
