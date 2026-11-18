"""Phase 1, step 2: clean crimes -> data/processed/incidents.parquet.

Applies the street-safety relevance filter from ml/config.yaml, drops rows without
coordinates or outside the Chicago bbox, and adds severity, time features, an
after-dark flag (astral sunrise/sunset for Chicago) and the H3 cell.

Usage: python ml/02_clean.py [--input data/raw/crimes.csv] [--output data/processed/incidents.parquet]
"""
from __future__ import annotations

import argparse
import fnmatch
import sys
from datetime import date as Date
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import h3
import numpy as np
import pandas as pd
from astral import LocationInfo
from astral.sun import sun

from common import PROCESSED_DIR, RAW_DIR, load_config

KEEP_COLUMNS = [
    "id", "date", "primary_type", "description", "location_description", "domestic", "arrest",
    "latitude", "longitude", "community_area", "district",
    "severity", "hour", "weekday", "month", "after_dark", "h3",
]


# ---------------------------------------------------------------- helpers
def to_bool(s: pd.Series) -> pd.Series:
    """'true'/'false'/True/1/'Y' etc. -> bool (missing -> False)."""
    if s.dtype == bool:
        return s
    return s.astype("string").str.strip().str.lower().isin(["true", "t", "1", "y", "yes"]).astype(bool)


def _upper(s: pd.Series) -> pd.Series:
    return s.astype("string").str.strip().str.upper()


def matches_patterns(values: pd.Series, patterns: list[str]) -> pd.Series:
    """True where the value equals a pattern or matches a shell-style `*` pattern (case-insensitive)."""
    v = _upper(values).fillna("")
    exact = {p.upper() for p in patterns if "*" not in p and "?" not in p}
    globs = [p.upper() for p in patterns if "*" in p or "?" in p]
    uniq = pd.Series(v.unique())
    ok = {u for u in uniq if u in exact or any(fnmatch.fnmatchcase(u, g) for g in globs)}
    return v.isin(ok) & (v != "")


# ---------------------------------------------------------------- filters
def filter_types(df: pd.DataFrame, cfg: dict[str, Any]) -> pd.DataFrame:
    types = {t.upper() for t in cfg["crimes"]["primary_types"]}
    return df[_upper(df["primary_type"]).isin(types).fillna(False).to_numpy()]


def filter_non_domestic(df: pd.DataFrame) -> pd.DataFrame:
    return df[~to_bool(df["domestic"]).to_numpy()]


def filter_theft(df: pd.DataFrame, cfg: dict[str, Any]) -> pd.DataFrame:
    """THEFT rows survive only when the description contains a listed keyword."""
    keep = [k.upper() for k in cfg["crimes"]["theft_descriptions_keep"]]
    is_theft = (_upper(df["primary_type"]) == "THEFT").fillna(False)
    desc = _upper(df["description"]).fillna("")
    desc_ok = pd.Series(False, index=df.index)
    for k in keep:
        desc_ok |= desc.str.contains(k, regex=False)
    return df[(~is_theft | desc_ok).to_numpy()]


def filter_public(df: pd.DataFrame, cfg: dict[str, Any]) -> pd.DataFrame:
    return df[matches_patterns(df["location_description"], cfg["crimes"]["public_locations"]).to_numpy()]


def filter_coords(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    return df.dropna(subset=["latitude", "longitude"])


def filter_bbox(df: pd.DataFrame, cfg: dict[str, Any]) -> pd.DataFrame:
    b = cfg["city"]["bbox"]
    inside = df["latitude"].between(b["min_lat"], b["max_lat"]) & df["longitude"].between(b["min_lon"], b["max_lon"])
    return df[inside.to_numpy()]


# ---------------------------------------------------------------- features
def parse_dates(df: pd.DataFrame) -> pd.DataFrame:
    """Socrata timestamps are Chicago local time without an offset; keep them naive local."""
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"], format="ISO8601", errors="coerce")
    return df.dropna(subset=["date"])


def add_severity(df: pd.DataFrame, cfg: dict[str, Any]) -> pd.DataFrame:
    sev = cfg["severity"]
    by_type = {k.upper(): float(v) for k, v in sev["by_type"].items()}
    pt = _upper(df["primary_type"])
    w = pt.map(by_type).astype("float64").fillna(float(sev["default"]))
    agg = sev.get("aggravated")
    if agg:
        is_agg = pt.isin([t.upper() for t in agg["types"]]) & _upper(df["description"]).fillna("").str.startswith(
            agg["description_prefix"].upper())
        w = w.where(~is_agg.fillna(False).to_numpy(), float(agg["weight"]))
    df = df.copy()
    df["severity"] = w.to_numpy()
    return df


def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    d = df["date"].dt
    df["hour"] = d.hour.astype("int8")
    df["weekday"] = d.day_of_week.astype("int8")  # Monday = 0
    df["month"] = d.month.astype("int8")
    return df


def sun_times(dates: list[Date], cfg: dict[str, Any]) -> pd.DataFrame:
    """Naive local sunrise/sunset per calendar date for the configured city."""
    c = cfg["city"]
    tz = ZoneInfo(c["timezone"])
    loc = LocationInfo(c["name"], "USA", c["timezone"], c["latitude"], c["longitude"])
    rows = []
    for d in dates:
        s = sun(loc.observer, date=d, tzinfo=tz)
        rows.append((pd.Timestamp(d), s["sunrise"].replace(tzinfo=None), s["sunset"].replace(tzinfo=None)))
    return pd.DataFrame(rows, columns=["day", "sunrise", "sunset"])


def add_after_dark(df: pd.DataFrame, cfg: dict[str, Any]) -> pd.DataFrame:
    df = df.copy()
    day = df["date"].dt.normalize()
    st = sun_times(sorted({ts.date() for ts in day.unique()}), cfg).set_index("day")
    sunrise = day.map(st["sunrise"]).astype("datetime64[ns]")
    sunset = day.map(st["sunset"]).astype("datetime64[ns]")
    ts = df["date"].astype("datetime64[ns]")
    df["after_dark"] = ((ts < sunrise) | (ts >= sunset)).to_numpy()
    return df


def add_h3(df: pd.DataFrame, resolution: int) -> pd.DataFrame:
    df = df.copy()
    df["h3"] = [h3.latlng_to_cell(lat, lon, resolution)
                for lat, lon in zip(df["latitude"].to_numpy(), df["longitude"].to_numpy())]
    return df


# ---------------------------------------------------------------- pipeline
def clean(raw: pd.DataFrame, cfg: dict[str, Any]) -> tuple[pd.DataFrame, list[tuple[str, int]]]:
    """Run all filters and feature steps. Returns (incidents, [(step, rows_after), ...])."""
    steps: list[tuple[str, int]] = [("raw (server-side filtered)", len(raw))]
    df = raw
    for name, fn in [
        ("relevant primary types", lambda d: filter_types(d, cfg)),
        ("non-domestic", filter_non_domestic),
        ("theft: from-person only", lambda d: filter_theft(d, cfg)),
        ("public locations", lambda d: filter_public(d, cfg)),
        ("has coordinates", filter_coords),
        ("inside Chicago bbox", lambda d: filter_bbox(d, cfg)),
        ("valid date", parse_dates),
    ]:
        df = fn(df)
        steps.append((name, len(df)))

    df = add_severity(df, cfg)
    df = add_time_features(df)
    df = add_after_dark(df, cfg)
    df = add_h3(df, int(cfg["h3_resolution"]))
    df["domestic"] = to_bool(df["domestic"]).to_numpy()
    df["arrest"] = to_bool(df["arrest"]).to_numpy()
    for col in ("primary_type", "description", "location_description"):
        df[col] = _upper(df[col]).to_numpy()
    for col in ("community_area", "district"):
        df[col] = pd.to_numeric(df[col], errors="coerce").astype("Int16")
    df = df[[c for c in KEEP_COLUMNS if c in df.columns]].sort_values("date").reset_index(drop=True)
    return df, steps


def summarize(df: pd.DataFrame, steps: list[tuple[str, int]]) -> str:
    lines = ["", "=== Phase 1 cleaning summary ===", "Rows after each filter:"]
    prev = None
    for name, n in steps:
        delta = "" if prev is None else f"  (-{prev - n:,})"
        lines.append(f"  {name:<28} {n:>10,}{delta}")
        prev = n
    if len(df):
        lines.append(f"Date range: {df['date'].min()}  ->  {df['date'].max()}")
        lines.append("Top 10 crime types:")
        lines += [f"  {k:<32} {v:>8,}" for k, v in df["primary_type"].value_counts().head(10).items()]
        lines.append("Top 10 location types:")
        lines += [f"  {k:<40} {v:>8,}" for k, v in df["location_description"].value_counts().head(10).items()]
        lines.append(f"Share after dark (sunset-sunrise): {100 * df['after_dark'].mean():.1f}%")
        lines.append(f"Distinct H3 res-9 cells: {df['h3'].nunique():,}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", type=Path, default=RAW_DIR / "crimes.csv")
    ap.add_argument("--output", type=Path, default=PROCESSED_DIR / "incidents.parquet")
    args = ap.parse_args(argv)

    if not args.input.exists():
        print(f"Missing {args.input}. Run `npm run data:download` first.", file=sys.stderr)
        return 1
    cfg = load_config()
    print(f"Reading {args.input} ...", flush=True)
    raw = pd.read_csv(args.input, dtype=str, keep_default_na=False, na_values=[""])
    df, steps = clean(raw, cfg)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(args.output, index=False)
    print(summarize(df, steps))
    print(f"\nSaved {len(df):,} incidents -> {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
