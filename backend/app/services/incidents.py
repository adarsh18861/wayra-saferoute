"""User incident reports -> temporary risk boost on nearby street edges (feature 5).

A report raises the relative risk of edges whose midpoint lies within RADIUS_M by up to BOOST,
fading linearly to zero over DECAY_S (2 h). Several reports near one edge don't stack: the edge
takes the strongest current boost. The router adds the boost to the bucket's rel_risk (clipped
to 1), so costs, safety scores and segment colours all reflect fresh reports.
"""
from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Protocol

import numpy as np

from app.services.deviation import RouteGeometry

RADIUS_M = 150.0
BOOST = 0.6
DECAY_S = 2 * 3600.0


class ReportLike(Protocol):
    lat: float
    lng: float
    created_at: datetime


def decay_weight(created_at: datetime, now: datetime) -> float:
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    age = (now - created_at).total_seconds()
    if age < 0:
        age = 0.0
    return max(0.0, 1.0 - age / DECAY_S)


def active_reports(reports: Sequence[ReportLike], now: datetime) -> list[tuple[ReportLike, float]]:
    return [(r, w) for r in reports if (w := decay_weight(r.created_at, now)) > 0]


def edge_boost(engine: object, reports: Sequence[ReportLike], now: datetime) -> np.ndarray | None:
    """Per-edge risk boost (E,) for the current reports, or None when nothing is active."""
    act = active_reports(reports, now)
    if not act:
        return None
    tree, n_edges, kx, m_lat = engine.edge_mid_tree()  # type: ignore[attr-defined]
    boost = np.zeros(n_edges, np.float32)
    for r, w in act:
        idx = tree.query_ball_point([r.lat * m_lat, r.lng * kx], RADIUS_M)
        if idx:
            np.maximum.at(boost, np.asarray(idx, np.int64), np.float32(BOOST * w))
    return boost


def reports_near_route(route: list[list[float]], reports: Sequence[ReportLike], now: datetime,
                       from_along_m: float = 0.0, radius_m: float = RADIUS_M) -> list[ReportLike]:
    """Active reports within radius_m of the route, ahead of from_along_m (50 m grace behind)."""
    if len(route) < 2:
        return []
    geo = RouteGeometry(np.asarray(route))
    out = []
    for r, _ in active_reports(reports, now):
        d, along = geo.locate(r.lat, r.lng)
        if d <= radius_m and along >= from_along_m - 50:
            out.append(r)
    return out
