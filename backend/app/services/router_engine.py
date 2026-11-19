"""Walking router on the precomputed street risk (Phase 3b/4).

The graph is built from the parquet/npz caches written by ml/05_score_edges.py; the backend never
parses the graphml. Each request runs scipy Dijkstra on a bbox subgraph (from/to box + 2 km).

Edge cost = length * (1 + lambda * r) + epsilon, where r is the edge's relative risk (percentile
0..1) for the request's 2-hour bucket. Night-safe mode multiplies lambda by 1.5 and adds a lighting
penalty: r_eff = min(1, r + NIGHT_UNLIT_PENALTY) on unlit edges. Fastest (lambda 0) stays the
plain shortest path. Safety score = round(100 * (1 - length-weighted mean r)), always on plain r.
"""
from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

logger = logging.getLogger("wayra.router")

PROFILES: tuple[tuple[str, str, float], ...] = (
    ("fastest", "Fastest", 0.0),
    ("balanced", "Balanced", 1.5),
    ("safest", "Safest", 8.0),
)
NIGHT_LAMBDA_FACTOR = 1.5
NIGHT_UNLIT_PENALTY = 0.2
WALK_SPEED_M_PER_MIN = 5000.0 / 60.0  # 5 km/h
SUBGRAPH_PAD_M = 2000.0
MAX_SNAP_M = 1500.0
GREEN_MAX, AMBER_MAX = 0.33, 0.66
M_PER_DEG_LAT = 111_320.0
EPS_COST = 1e-3  # keeps zero-length edges as real edges in the sparse matrix


class RoutingError(Exception):
    """A request the router cannot serve (point outside the graph, no path)."""


def edge_cost(length: np.ndarray, rel_risk: np.ndarray, lam: float, night: bool = False,
              unlit: np.ndarray | None = None) -> np.ndarray:
    """Cost per edge for one profile. rel_risk is the bucket's column (E,)."""
    r = rel_risk.astype(np.float64)
    if night:
        lam = lam * NIGHT_LAMBDA_FACTOR
        if unlit is not None:
            r = np.minimum(1.0, r + NIGHT_UNLIT_PENALTY * unlit)
    return length.astype(np.float64) * (1.0 + lam * r)


def safety_score(lengths: np.ndarray, rel_risk: np.ndarray) -> int:
    """round(100 * (1 - length-weighted mean relative risk)); 100 for an empty route."""
    total = float(np.sum(lengths))
    if total <= 0:
        return 100 if len(rel_risk) == 0 else int(round(100 * (1 - float(np.mean(rel_risk)))))
    return int(round(100 * (1 - float(np.sum(lengths * rel_risk)) / total)))


def risk_level(r: float) -> str:
    return "green" if r < GREEN_MAX else "amber" if r < AMBER_MAX else "red"


@dataclass
class RouteResult:
    profile: str
    label: str
    lam: float
    edges: np.ndarray  # edge indices in travel order
    geometry: list[list[float]]
    distance_m: float
    eta_min: float
    safety_score: int
    risk_m: dict[str, float]
    segments: list[dict]
    identical_to: list[str] = field(default_factory=list)


class RouterEngine:
    def __init__(self, node_lat: np.ndarray, node_lon: np.ndarray, eu: np.ndarray, ev: np.ndarray,
                 length: np.ndarray, rel_risk: np.ndarray, unlit: np.ndarray | None = None,
                 geom_offsets: np.ndarray | None = None, geom_coords: np.ndarray | None = None) -> None:
        self.node_lat = np.asarray(node_lat, np.float64)
        self.node_lon = np.asarray(node_lon, np.float64)
        self.eu = np.asarray(eu, np.int64)
        self.ev = np.asarray(ev, np.int64)
        self.length = np.asarray(length, np.float32)
        self.rel_risk = np.asarray(rel_risk, np.float32)
        self.unlit = np.zeros(len(self.eu), bool) if unlit is None else np.asarray(unlit, bool)
        self.geom_offsets = geom_offsets
        self.geom_coords = geom_coords
        self.lat0 = float(np.mean(self.node_lat))
        self.kx = M_PER_DEG_LAT * math.cos(math.radians(self.lat0))
        self.tree = cKDTree(np.c_[self.node_lat * M_PER_DEG_LAT, self.node_lon * self.kx])
        self._mid_tree: cKDTree | None = None

    def edge_mid_tree(self) -> tuple[cKDTree, int, float, float]:
        """KD-tree over edge midpoints (metric coords), built on first use (incident reports)."""
        if self._mid_tree is None:
            mlat = (self.node_lat[self.eu] + self.node_lat[self.ev]) / 2
            mlon = (self.node_lon[self.eu] + self.node_lon[self.ev]) / 2
            self._mid_tree = cKDTree(np.c_[mlat * M_PER_DEG_LAT, mlon * self.kx])
        return self._mid_tree, self.n_edges, self.kx, M_PER_DEG_LAT

    @property
    def n_nodes(self) -> int:
        return len(self.node_lat)

    @property
    def n_edges(self) -> int:
        return len(self.eu)

    # ------------------------------------------------------------ loading
    @classmethod
    def from_data_dir(cls, data_dir: Path) -> RouterEngine:
        need = {
            "nodes": data_dir / "graph" / "walk_nodes.parquet",
            "edges": data_dir / "processed" / "edge_index.parquet",
            "rel_risk": data_dir / "processed" / "edge_rel_risk.npy",
        }
        missing = [str(p) for p in need.values() if not p.exists()]
        if missing:
            raise FileNotFoundError("missing " + ", ".join(missing) + " (run `npm run score`)")
        nodes = pd.read_parquet(need["nodes"])
        e = pd.read_parquet(need["edges"], columns=["u", "v", "length", "unlit"])
        rel = np.load(need["rel_risk"])
        if len(rel) != len(e):
            raise ValueError(f"edge_rel_risk.npy has {len(rel)} rows but edge_index.parquet {len(e)}; "
                             "re-run `npm run score`")
        idx = pd.Index(nodes["osmid"].to_numpy())
        eu, ev = idx.get_indexer(e["u"].to_numpy()), idx.get_indexer(e["v"].to_numpy())
        if (eu < 0).any() or (ev < 0).any():
            raise ValueError("edges reference unknown nodes; re-run `npm run score`")
        offsets = coords = None
        geom = data_dir / "graph" / "walk_geom.npz"
        if geom.exists():
            g = np.load(geom)
            if len(g["offsets"]) == len(e) + 1:
                offsets, coords = g["offsets"], g["coords"]
        return cls(nodes["lat"].to_numpy(), nodes["lon"].to_numpy(), eu, ev, e["length"].to_numpy(),
                   rel, e["unlit"].to_numpy(), offsets, coords)

    # ------------------------------------------------------------ helpers
    def snap(self, lat: float, lon: float) -> tuple[int, float]:
        d, i = self.tree.query([lat * M_PER_DEG_LAT, lon * self.kx])
        return int(i), float(d)

    def _edge_coords(self, e: int) -> list[list[float]]:
        if self.geom_offsets is not None and self.geom_coords is not None:
            a, b = self.geom_offsets[e], self.geom_offsets[e + 1]
            return self.geom_coords[a:b].tolist()
        u, v = self.eu[e], self.ev[e]
        return [[float(self.node_lat[u]), float(self.node_lon[u])], [float(self.node_lat[v]), float(self.node_lon[v])]]

    def _subgraph_edges(self, s: int, t: int, pad_m: float | None) -> np.ndarray:
        if pad_m is None:
            return np.arange(self.n_edges)
        lat = self.node_lat[[s, t]]
        lon = self.node_lon[[s, t]]
        dlat, dlon = pad_m / M_PER_DEG_LAT, pad_m / self.kx
        inside = ((self.node_lat >= lat.min() - dlat) & (self.node_lat <= lat.max() + dlat)
                  & (self.node_lon >= lon.min() - dlon) & (self.node_lon <= lon.max() + dlon))
        return np.flatnonzero(inside[self.eu] & inside[self.ev])

    def _shortest(self, s: int, t: int, sub: np.ndarray, cost: np.ndarray) -> np.ndarray | None:
        """Edge indices of the cheapest s -> t path within the edge subset `sub`, or None."""
        nodes, inv = np.unique(np.r_[self.eu[sub], self.ev[sub], s, t], return_inverse=True)
        m = len(sub)
        su, sv = inv[:m], inv[m:2 * m]
        ls, lt = int(inv[2 * m]), int(inv[2 * m + 1])
        if ls == lt:
            return np.array([], np.int64)
        n = len(nodes)
        key = su * n + sv
        order = np.lexsort((cost, key))  # by key, then cost: first of each key = cheapest parallel edge
        k_sorted = key[order]
        first = np.r_[True, k_sorted[1:] != k_sorted[:-1]]
        keep = order[first]
        keys_kept = k_sorted[first]
        g = csr_matrix((cost[keep] + EPS_COST, (su[keep], sv[keep])), shape=(n, n))
        _, pred = dijkstra(g, directed=True, indices=ls, return_predecessors=True)
        if pred[lt] < 0:
            return None
        path = [lt]
        while path[-1] != ls:
            path.append(int(pred[path[-1]]))
        path.reverse()
        a, b = np.array(path[:-1]), np.array(path[1:])
        pos = np.searchsorted(keys_kept, a * n + b)
        return sub[keep[pos]]

    def _build(self, profile: str, label: str, lam: float, edges: np.ndarray, bucket: int,
               boost: np.ndarray | None = None) -> RouteResult:
        lengths = self.length[edges].astype(np.float64)
        rel = self.rel_risk[edges, bucket].astype(np.float64)
        if boost is not None:
            rel = np.minimum(1.0, rel + boost[edges])
        geometry: list[list[float]] = []
        segments = []
        risk_m = {"green": 0.0, "amber": 0.0, "red": 0.0}
        for e, L, r in zip(edges.tolist(), lengths.tolist(), rel.tolist()):
            pts = self._edge_coords(e)
            geometry.extend(pts if not geometry else pts[1:])
            lvl = risk_level(r)
            risk_m[lvl] += L
            segments.append({"coords": pts, "rel_risk": round(r, 3), "length_m": round(L, 1), "level": lvl})
        dist = float(lengths.sum())
        return RouteResult(profile, label, lam, edges, geometry, round(dist, 1),
                           round(dist / WALK_SPEED_M_PER_MIN, 1), safety_score(lengths, rel),
                           {k: round(v, 1) for k, v in risk_m.items()}, segments)

    # ------------------------------------------------------------ public
    def route(self, from_latlon: tuple[float, float], to_latlon: tuple[float, float], bucket: int,
              night: bool, risk_boost: np.ndarray | None = None) -> dict:
        """risk_boost (E,): temporary extra rel_risk from incident reports (services/incidents.py)."""
        t0 = time.perf_counter()
        s, ds = self.snap(*from_latlon)
        t, dt = self.snap(*to_latlon)
        if ds > MAX_SNAP_M or dt > MAX_SNAP_M:
            raise RoutingError("Start or destination is too far from the walking network (pilot area: City of Chicago).")
        sub = self._subgraph_edges(s, t, SUBGRAPH_PAD_M)
        col = self.rel_risk[:, bucket]
        if risk_boost is not None:
            col = np.minimum(1.0, col + risk_boost).astype(np.float32)
        results: list[RouteResult] = []
        for profile, label, lam in PROFILES:
            cost = edge_cost(self.length[sub], col[sub], lam, night, self.unlit[sub])
            path = self._shortest(s, t, sub, cost)
            if path is None:  # bbox cut the connection: retry on the whole graph
                full = np.arange(self.n_edges)
                path = self._shortest(s, t, full, edge_cost(self.length, col, lam, night, self.unlit))
            if path is None:
                raise RoutingError("No walking route found between these points.")
            results.append(self._build(profile, label, lam, path, bucket, risk_boost))
        for r in results:
            r.identical_to = [o.profile for o in results if o is not r and np.array_equal(o.edges, r.edges)]
        return {
            "routes": results,
            "snapped": {
                "from": {"lat": float(self.node_lat[s]), "lng": float(self.node_lon[s]), "distance_m": round(ds, 1)},
                "to": {"lat": float(self.node_lat[t]), "lng": float(self.node_lon[t]), "distance_m": round(dt, 1)},
            },
            "subgraph_edges": int(len(sub)),
            "compute_ms": round((time.perf_counter() - t0) * 1000, 1),
        }
