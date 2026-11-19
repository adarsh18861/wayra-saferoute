"""Phase 3: street safety scores -> data/processed/edge_risk.npy + edge_index.parquet.

- Downloads the City of Chicago walk graph once with osmnx (keeps the OSM `lit` tag) and caches
  it to data/graph/chicago_walk.graphml.
- Base edge risk per bucket = calibrated risk (data/processed/cell_risk.parquet) of the H3 cell
  containing the edge midpoint. Edges outside the modelled cell universe (no incident in the cell
  or its neighbours since 2022) get that bucket's minimum cell risk.
- Adjustments (ml/config.yaml `edges`): night buckets +penalty if no street lamp within 40 m of
  the midpoint and no lit=yes tag; busier edges (POIs within 100 m) get a small multiplicative
  reduction; clipped to [0, 1].
- edge_risk.npy is float32 (n_edges, 12); row i belongs to row i of edge_index.parquet
  (u, v, key in G.edges(keys=True) order).

Usage: python ml/05_score_edges.py [--force-download]
"""
from __future__ import annotations

import argparse
import sys
import time
from typing import Any

import h3
import numpy as np
import pandas as pd
from sklearn.neighbors import BallTree

from common import CACHE_DIR, DATA_DIR, PROCESSED_DIR, RAW_DIR, load_config

GRAPH_PATH = DATA_DIR / "graph" / "chicago_walk.graphml"
EDGES_CACHE = DATA_DIR / "graph" / "walk_edges.parquet"  # u, v, key, length, lit_tag, lat, lon
EARTH_R_M = 6_371_000.0
LIT_YES = {"yes", "24/7", "automatic", "limited", "interval", "sunset-sunrise", "dusk-dawn"}


# ---------------------------------------------------------------- graph
def load_graph(cfg: dict[str, Any], force: bool = False):
    import osmnx as ox

    ox.settings.cache_folder = str(CACHE_DIR / "osmnx")
    ox.settings.use_cache = True
    if "lit" not in ox.settings.useful_tags_way:
        ox.settings.useful_tags_way = list(ox.settings.useful_tags_way) + ["lit"]
    if GRAPH_PATH.exists() and not force:
        print(f"Loading cached graph {GRAPH_PATH} ...")
        return ox.load_graphml(GRAPH_PATH)
    print(f"Downloading walk graph for {cfg['city']['osm_place']} (one-off, several minutes) ...")
    G = ox.graph_from_place(cfg["city"]["osm_place"], network_type="walk")
    GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(G, GRAPH_PATH)
    return G


def is_lit(value: Any) -> bool:
    """OSM lit tag -> bool. Merged edges can carry a list of values; any lit part counts."""
    if isinstance(value, (list, tuple)):
        return any(is_lit(v) for v in value)
    if not isinstance(value, str):
        return False
    s = value.strip().lower()
    if s.startswith("["):  # list serialised to a string by graphml
        return any(is_lit(p.strip(" '\"")) for p in s.strip("[]").split(","))
    return s in LIT_YES


def edge_frame(G) -> pd.DataFrame:
    xs = {n: d["x"] for n, d in G.nodes(data=True)}
    ys = {n: d["y"] for n, d in G.nodes(data=True)}
    rows = [(u, v, k, d.get("length", 0.0), is_lit(d.get("lit"))) for u, v, k, d in G.edges(keys=True, data=True)]
    e = pd.DataFrame(rows, columns=["u", "v", "key", "length", "lit_tag"])
    e["lat"] = (e["u"].map(ys).to_numpy(float) + e["v"].map(ys).to_numpy(float)) / 2
    e["lon"] = (e["u"].map(xs).to_numpy(float) + e["v"].map(xs).to_numpy(float)) / 2
    e["length"] = pd.to_numeric(e["length"], errors="coerce").fillna(0.0).astype(np.float32)
    return e


# ---------------------------------------------------------------- scoring (pure numpy, tested)
def nearest_m(points_lat: np.ndarray, points_lon: np.ndarray, ref_lat: np.ndarray, ref_lon: np.ndarray) -> np.ndarray:
    if len(ref_lat) == 0:
        return np.full(len(points_lat), np.inf)
    tree = BallTree(np.radians(np.c_[ref_lat, ref_lon]), metric="haversine")
    d, _ = tree.query(np.radians(np.c_[points_lat, points_lon]), k=1)
    return d[:, 0] * EARTH_R_M


def count_within_m(points_lat: np.ndarray, points_lon: np.ndarray, ref_lat: np.ndarray, ref_lon: np.ndarray,
                   radius_m: float) -> np.ndarray:
    if len(ref_lat) == 0:
        return np.zeros(len(points_lat), np.int32)
    tree = BallTree(np.radians(np.c_[ref_lat, ref_lon]), metric="haversine")
    return tree.query_radius(np.radians(np.c_[points_lat, points_lon]), r=radius_m / EARTH_R_M,
                             count_only=True).astype(np.int32)


def base_edge_risk(edge_cells: np.ndarray, cell_risk: pd.DataFrame, n_buckets: int = 12) -> np.ndarray:
    """(E, B) risk of each edge's cell; cells not in cell_risk get the per-bucket minimum."""
    cols = [f"risk_{b:02d}" for b in range(n_buckets)]
    table = cell_risk[cols].to_numpy(np.float32)
    fallback = table.min(axis=0)
    idx = pd.Index(cell_risk["h3"]).get_indexer(edge_cells)
    out = np.where((idx >= 0)[:, None], table[np.maximum(idx, 0)], fallback[None, :])
    return out.astype(np.float32)


def adjust_edge_risk(base: np.ndarray, unlit: np.ndarray, poi_count: np.ndarray, ecfg: dict[str, Any]) -> np.ndarray:
    """Apply lighting (night only) and crowd adjustments, then clip to [0, 1]. base: (E, B)."""
    B = base.shape[1]
    night = np.zeros(B, bool)
    night[list(ecfg["night_buckets"])] = True
    busy = np.minimum(poi_count / float(ecfg["busy_poi_cap"]), 1.0)
    r = base * (1.0 - float(ecfg["busy_max_reduction"]) * busy)[:, None]
    r = r + float(ecfg["unlit_night_penalty"]) * (unlit[:, None] & night[None, :])
    return np.clip(r, 0.0, 1.0).astype(np.float32)


def summarize(risk: np.ndarray, night_buckets: list[int]) -> str:
    night = np.zeros(risk.shape[1], bool)
    night[list(night_buckets)] = True
    lines = [f"  {'':<6} {'mean':>6} {'p50':>6} {'p90':>6} {'p99':>6} {'>=0.33':>7} {'>=0.66':>7}"]
    for name, sel in (("day", ~night), ("night", night)):
        a = risk[:, sel].ravel()
        q = np.percentile(a, [50, 90, 99])
        lines.append(f"  {name:<6} {a.mean():6.3f} {q[0]:6.3f} {q[1]:6.3f} {q[2]:6.3f} "
                     f"{(a >= 0.33).mean():7.1%} {(a >= 0.66).mean():7.1%}")
    return "\n".join(lines)


# ---------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force-download", action="store_true")
    args = ap.parse_args(argv)
    t0 = time.time()
    cfg = load_config()
    ecfg = cfg["edges"]
    risk_path = PROCESSED_DIR / "cell_risk.parquet"
    if not risk_path.exists():
        print(f"Missing {risk_path}. Run `npm run train` first.", file=sys.stderr)
        return 1
    cell_risk = pd.read_parquet(risk_path)

    # Parsing the ~400 MB graphml takes minutes; cache the few columns we need next to it.
    if EDGES_CACHE.exists() and GRAPH_PATH.exists() and not args.force_download \
            and EDGES_CACHE.stat().st_mtime > GRAPH_PATH.stat().st_mtime:
        e = pd.read_parquet(EDGES_CACHE)
    else:
        G = load_graph(cfg, args.force_download)
        e = edge_frame(G)
        del G
        e.to_parquet(EDGES_CACHE, index=False)
    print(f"Graph: {len(e):,} directed edges  ({time.time() - t0:.0f}s)")

    res = int(cfg["h3_resolution"])
    e["h3"] = [h3.latlng_to_cell(a, b, res) for a, b in zip(e["lat"].to_numpy(), e["lon"].to_numpy())]
    lamps = pd.read_parquet(RAW_DIR / "osm_lamps.parquet")
    pois = pd.read_parquet(RAW_DIR / "osm_pois.parquet")
    lat, lon = e["lat"].to_numpy(), e["lon"].to_numpy()
    e["lamp_near"] = nearest_m(lat, lon, lamps["lat"].to_numpy(), lamps["lon"].to_numpy()) <= ecfg["lamp_radius_m"]
    e["poi_count"] = count_within_m(lat, lon, pois["lat"].to_numpy(), pois["lon"].to_numpy(), ecfg["poi_radius_m"])
    unlit = ~(e["lamp_near"].to_numpy() | e["lit_tag"].to_numpy())

    base = base_edge_risk(e["h3"].to_numpy(), cell_risk, int(cfg["model"]["n_buckets"]))
    risk = adjust_edge_risk(base, unlit, e["poi_count"].to_numpy(), ecfg)

    np.save(PROCESSED_DIR / "edge_risk.npy", risk)
    e.insert(0, "edge_idx", np.arange(len(e), dtype=np.int64))
    e.drop(columns=["lat", "lon"]).to_parquet(PROCESSED_DIR / "edge_index.parquet", index=False)

    in_universe = pd.Index(cell_risk["h3"]).get_indexer(e["h3"]) >= 0
    print(f"Edges in modelled cells: {in_universe.mean():.1%}   lit=yes tag: {e['lit_tag'].mean():.1%}   "
          f"lamp within {ecfg['lamp_radius_m']} m: {e['lamp_near'].mean():.1%}   unlit: {unlit.mean():.1%}")
    print(f"Edge risk, day vs night buckets (night = {ecfg['night_buckets']}):")
    print(summarize(risk, ecfg["night_buckets"]))
    print(f"Saved edge_risk.npy {risk.shape} + edge_index.parquet in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
