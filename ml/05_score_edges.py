"""Phase 3: street safety scores -> data/processed/edge_risk.npy + edge_index.parquet.

- Downloads the City of Chicago walk graph once with osmnx (keeps the OSM `lit` tag) and caches
  it to data/graph/chicago_walk.graphml.
- Base edge risk per bucket = calibrated risk (data/processed/cell_risk.parquet) of the H3 cell
  containing the edge midpoint. Edges outside the modelled cell universe (no incident in the cell
  or its neighbours since 2022) get that bucket's minimum cell risk.
- Adjustment (ml/config.yaml `edges`): busier edges (POIs within 100 m) get a small multiplicative
  reduction; clipped to [0, 1]. There is NO lighting penalty in the stored risk (Phase 5): OSM
  lighting data is too sparse (92 % of edges fall back to unlit), so a flat night penalty only
  shifted almost every street. The `unlit` flag is still saved in edge_index.parquet and the
  backend router adds an unlit penalty inside the routing cost when night-safe mode is on.
- Lighting: an edge counts as lit if it has a lit=yes-type tag or a mapped street lamp within
  40 m. If it has neither a lit tag (yes or no) nor a lamp, fall back to road class: trunk/primary/
  secondary/tertiary (and _link) = lit, everything else (residential, service/alley, footway,
  path, ...) = unlit.
- edge_risk.npy is float32 (n_edges, 12); row i belongs to row i of edge_index.parquet
  (u, v, key in G.edges(keys=True) order).
- edge_rel_risk.npy is float32 (n_edges, 12): percentile rank (0..1) of each edge-bucket risk,
  ranked jointly over all edges and all 12 buckets, so night buckets are relatively riskier.
  The routing API and the map colours use this; the raw probability stays in edge_risk.npy.
- Graph files for the backend (no graphml parsing at API startup):
  data/graph/walk_edges.parquet (u, v, key, length, lit_tag, lit_known, highway, lat, lon),
  data/graph/walk_nodes.parquet (osmid, lat, lon), data/graph/walk_geom.npz (offsets, coords).

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
from scipy.stats import rankdata
from sklearn.neighbors import BallTree

from common import CACHE_DIR, DATA_DIR, PROCESSED_DIR, RAW_DIR, load_config

GRAPH_PATH = DATA_DIR / "graph" / "chicago_walk.graphml"
EDGES_CACHE = DATA_DIR / "graph" / "walk_edges.parquet"  # u, v, key, length, lit_tag, lit_known, highway, lat, lon
NODES_CACHE = DATA_DIR / "graph" / "walk_nodes.parquet"  # osmid, lat, lon
GEOM_CACHE = DATA_DIR / "graph" / "walk_geom.npz"  # offsets (E+1), coords (N, 2) lat/lon per edge, u -> v
EDGE_CACHE_COLS = {"u", "v", "key", "length", "lit_tag", "lit_known", "highway", "lat", "lon"}
EARTH_R_M = 6_371_000.0
LIT_YES = {"yes", "24/7", "automatic", "limited", "interval", "sunset-sunrise", "dusk-dawn"}
LIT_ROAD_CLASSES = {"trunk", "primary", "secondary", "tertiary",
                    "trunk_link", "primary_link", "secondary_link", "tertiary_link"}


# ---------------------------------------------------------------- graph
def download_graph(cfg: dict[str, Any]) -> None:
    """Download the walk graph with osmnx (keeps the OSM `lit` tag) and save it as graphml."""
    import osmnx as ox

    ox.settings.cache_folder = str(CACHE_DIR / "osmnx")
    ox.settings.use_cache = True
    if "lit" not in ox.settings.useful_tags_way:
        ox.settings.useful_tags_way = list(ox.settings.useful_tags_way) + ["lit"]
    print(f"Downloading walk graph for {cfg['city']['osm_place']} (one-off, several minutes) ...")
    G = ox.graph_from_place(cfg["city"]["osm_place"], network_type="walk")
    GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
    ox.save_graphml(G, GRAPH_PATH)


def tag_values(value: Any) -> list[str]:
    """Tag value (str, possibly a serialised list like "['a', 'b']", or a list) -> lower-case strings."""
    if isinstance(value, (list, tuple)):
        return [x for v in value for x in tag_values(v)]
    if not isinstance(value, str) or not value.strip():
        return []
    s = value.strip()
    if s.startswith("["):
        parts = (p.strip(" '\"") for p in s.strip("[]").split(","))
        return [p.lower() for p in parts if p]
    return [s.lower()]


def is_lit(value: Any) -> bool:
    """OSM lit tag -> bool. Merged edges can carry a list of values; any lit part counts."""
    return any(v in LIT_YES for v in tag_values(value))


def road_class_lit(highway: Any) -> bool:
    """Lighting fallback from road class: any part trunk/primary/secondary/tertiary(_link) = lit."""
    return any(h in LIT_ROAD_CLASSES for h in tag_values(highway))


def _parse_linestring(wkt: str) -> list[tuple[float, float]]:
    """'LINESTRING (x y, x y, ...)' -> [(lat, lon), ...]."""
    body = wkt[wkt.index("(") + 1: wkt.rindex(")")]
    out = []
    for pair in body.split(","):
        x, y = pair.split()
        out.append((float(y), float(x)))
    return out


def parse_graphml(path) -> tuple[pd.DataFrame, pd.DataFrame, np.ndarray, np.ndarray]:
    """Stream the osmnx graphml with stdlib iterparse (much faster than ox.load_graphml).

    Returns (edges, nodes, geom_offsets, geom_coords). Edges keep file order, which is the
    G.edges(keys=True) order osmnx wrote. Geometry per edge runs u -> v and includes both ends.
    """
    import xml.etree.ElementTree as ET

    ns = "{http://graphml.graphdrawing.org/xmlns}"
    keys: dict[str, str] = {}
    node_ids: list[int] = []
    node_lat: list[float] = []
    node_lon: list[float] = []
    node_pos: dict[int, int] = {}
    eu: list[int] = []
    ev: list[int] = []
    ek: list[int] = []
    elen: list[float] = []
    elit: list[str] = []
    ehw: list[str] = []
    offsets = [0]
    coords: list[tuple[float, float]] = []
    for _, el in ET.iterparse(str(path), events=("end",)):
        tag = el.tag[len(ns):] if el.tag.startswith(ns) else el.tag
        if tag == "key":
            keys[el.get("id")] = el.get("attr.name")
        elif tag == "node":
            d = {keys.get(c.get("key")): c.text for c in el}
            nid = int(el.get("id"))
            node_pos[nid] = len(node_ids)
            node_ids.append(nid)
            node_lat.append(float(d["y"]))
            node_lon.append(float(d["x"]))
            el.clear()
        elif tag == "edge":
            d = {keys.get(c.get("key")): c.text for c in el}
            u, v = int(el.get("source")), int(el.get("target"))
            eu.append(u)
            ev.append(v)
            ek.append(int(el.get("id") or 0))
            elen.append(float(d.get("length") or 0.0))
            elit.append(d.get("lit") or "")
            ehw.append(d.get("highway") or "")
            pu, pv = node_pos[u], node_pos[v]
            a, b = (node_lat[pu], node_lon[pu]), (node_lat[pv], node_lon[pv])
            pts = _parse_linestring(d["geometry"]) if d.get("geometry") else [a, b]
            # orient u -> v (osmnx normally does already)
            d0 = (pts[0][0] - a[0]) ** 2 + (pts[0][1] - a[1]) ** 2
            d1 = (pts[-1][0] - a[0]) ** 2 + (pts[-1][1] - a[1]) ** 2
            if d0 > d1:
                pts.reverse()
            coords.extend(pts)
            offsets.append(len(coords))
            el.clear()
    nodes = pd.DataFrame({"osmid": np.array(node_ids, np.int64), "lat": node_lat, "lon": node_lon})
    lat_of = pd.Series(node_lat, index=node_ids)
    lon_of = pd.Series(node_lon, index=node_ids)
    e = pd.DataFrame({"u": np.array(eu, np.int64), "v": np.array(ev, np.int64), "key": np.array(ek, np.int64),
                      "length": np.array(elen, np.float32)})
    e["lit_tag"] = [is_lit(x) for x in elit]
    e["lit_known"] = [bool(tag_values(x)) for x in elit]
    e["highway"] = ehw
    e["lat"] = (lat_of.reindex(e["u"]).to_numpy() + lat_of.reindex(e["v"]).to_numpy()) / 2
    e["lon"] = (lon_of.reindex(e["u"]).to_numpy() + lon_of.reindex(e["v"]).to_numpy()) / 2
    return e, nodes, np.array(offsets, np.int64), np.array(coords, np.float64)


def build_graph_cache(cfg: dict[str, Any], force_download: bool = False) -> pd.DataFrame:
    """Make sure walk_edges/walk_nodes/walk_geom exist, are complete and newer than the graphml."""
    if force_download or not GRAPH_PATH.exists():
        download_graph(cfg)
    caches = (EDGES_CACHE, NODES_CACHE, GEOM_CACHE)
    if all(p.exists() and p.stat().st_mtime > GRAPH_PATH.stat().st_mtime for p in caches):
        e = pd.read_parquet(EDGES_CACHE)
        if EDGE_CACHE_COLS <= set(e.columns):
            return e
    t = time.time()
    print(f"Parsing {GRAPH_PATH.name} (streaming, a few minutes, one-off) ...")
    e, nodes, offsets, coords = parse_graphml(GRAPH_PATH)
    EDGES_CACHE.parent.mkdir(parents=True, exist_ok=True)
    e.to_parquet(EDGES_CACHE, index=False)
    nodes.to_parquet(NODES_CACHE, index=False)
    np.savez(GEOM_CACHE, offsets=offsets, coords=coords)
    print(f"  {len(nodes):,} nodes, {len(e):,} edges, {len(coords):,} geometry points ({time.time() - t:.0f}s)")
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


def adjust_edge_risk(base: np.ndarray, poi_count: np.ndarray, ecfg: dict[str, Any]) -> np.ndarray:
    """Apply the crowd adjustment, then clip to [0, 1]. base: (E, B).

    No lighting term: the unlit penalty lives only in the router's night-safe cost."""
    busy = np.minimum(poi_count / float(ecfg["busy_poi_cap"]), 1.0)
    r = base * (1.0 - float(ecfg["busy_max_reduction"]) * busy)[:, None]
    return np.clip(r, 0.0, 1.0).astype(np.float32)


def unlit_mask(lit_tag: np.ndarray, lit_known: np.ndarray, lamp_near: np.ndarray, highway: np.ndarray) -> np.ndarray:
    """True = unlit. A lit tag (yes/no) or a nearby lamp decides; with no lighting data at all,
    fall back to road class (trunk/primary/secondary/tertiary = lit)."""
    by_class = np.array([road_class_lit(h) for h in highway], bool)
    lit = lit_tag | lamp_near | (~lit_known & by_class)
    return ~lit


def relative_risk(risk: np.ndarray) -> np.ndarray:
    """Percentile rank in [0, 1] over ALL edge-bucket values jointly (ties share their mean rank)."""
    flat = risk.ravel()
    if flat.size <= 1:
        return np.zeros_like(risk, dtype=np.float32)
    r = (rankdata(flat, method="average") - 1.0) / (flat.size - 1.0)
    return r.reshape(risk.shape).astype(np.float32)


def colour_shares(rel: np.ndarray, night_buckets: list[int]) -> str:
    night = np.zeros(rel.shape[1], bool)
    night[list(night_buckets)] = True
    lines = [f"  {'':<6} {'green<0.33':>11} {'amber<0.66':>11} {'red':>7}"]
    for name, sel in (("day", ~night), ("night", night)):
        a = rel[:, sel].ravel()
        g, am = (a < 0.33).mean(), ((a >= 0.33) & (a < 0.66)).mean()
        lines.append(f"  {name:<6} {g:11.1%} {am:11.1%} {1 - g - am:7.1%}")
    return "\n".join(lines)


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

    # The graphml is parsed once (streaming) into parquet/npz caches that the backend loads quickly.
    e = build_graph_cache(cfg, args.force_download)
    print(f"Graph: {len(e):,} directed edges  ({time.time() - t0:.0f}s)")

    res = int(cfg["h3_resolution"])
    e["h3"] = [h3.latlng_to_cell(a, b, res) for a, b in zip(e["lat"].to_numpy(), e["lon"].to_numpy())]
    lamps = pd.read_parquet(RAW_DIR / "osm_lamps.parquet")
    pois = pd.read_parquet(RAW_DIR / "osm_pois.parquet")
    lat, lon = e["lat"].to_numpy(), e["lon"].to_numpy()
    e["lamp_near"] = nearest_m(lat, lon, lamps["lat"].to_numpy(), lamps["lon"].to_numpy()) <= ecfg["lamp_radius_m"]
    e["poi_count"] = count_within_m(lat, lon, pois["lat"].to_numpy(), pois["lon"].to_numpy(), ecfg["poi_radius_m"])
    unlit = unlit_mask(e["lit_tag"].to_numpy(bool), e["lit_known"].to_numpy(bool), e["lamp_near"].to_numpy(bool),
                       e["highway"].to_numpy())
    e["unlit"] = unlit

    base = base_edge_risk(e["h3"].to_numpy(), cell_risk, int(cfg["model"]["n_buckets"]))
    risk = adjust_edge_risk(base, e["poi_count"].to_numpy(), ecfg)

    rel = relative_risk(risk)
    np.save(PROCESSED_DIR / "edge_risk.npy", risk)
    np.save(PROCESSED_DIR / "edge_rel_risk.npy", rel)
    e.insert(0, "edge_idx", np.arange(len(e), dtype=np.int64))
    e.drop(columns=["lat", "lon", "highway"]).to_parquet(PROCESSED_DIR / "edge_index.parquet", index=False)

    in_universe = pd.Index(cell_risk["h3"]).get_indexer(e["h3"]) >= 0
    print(f"Edges in modelled cells: {in_universe.mean():.1%}   lit=yes tag: {e['lit_tag'].mean():.1%}   "
          f"lamp within {ecfg['lamp_radius_m']} m: {e['lamp_near'].mean():.1%}   unlit: {unlit.mean():.1%}  "
          f"(no lighting data, road-class fallback: {(~e['lit_known'] & ~e['lamp_near']).mean():.1%})")
    print(f"Edge risk, day vs night buckets (night = {ecfg['night_buckets']}):")
    print(summarize(risk, ecfg["night_buckets"]))
    print("Relative risk (percentile over all edge-bucket pairs), share of edge-bucket pairs:")
    print(colour_shares(rel, ecfg["night_buckets"]))
    print(f"Saved edge_risk.npy + edge_rel_risk.npy {risk.shape} + edge_index.parquet in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
