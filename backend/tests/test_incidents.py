"""Incident reports: decay, edge boost, live re-routing and the trip re-check."""
from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.incidents import BOOST, DECAY_S, decay_weight, edge_boost, reports_near_route
from tests.test_contacts import auth
from tests.test_routing import NODE_LAT, NODE_LON, fake_engine

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)
NODE2 = (float(NODE_LAT[2]), float(NODE_LON[2]))  # the safe detour's middle node


@dataclass
class R:
    lat: float
    lng: float
    created_at: datetime


@pytest.fixture()
def engine() -> Iterator[None]:
    old = app.state.router_engine
    app.state.router_engine = fake_engine()
    yield
    app.state.router_engine = old


def test_decay_is_linear_over_two_hours() -> None:
    assert decay_weight(NOW, NOW) == 1
    assert decay_weight(NOW - timedelta(hours=1), NOW) == pytest.approx(0.5)
    assert decay_weight(NOW - timedelta(seconds=DECAY_S), NOW) == 0
    assert decay_weight((NOW - timedelta(hours=1)).replace(tzinfo=None), NOW) == pytest.approx(0.5)


def test_edge_boost_hits_only_nearby_edges_and_takes_max() -> None:
    eng = fake_engine()
    assert edge_boost(eng, [], NOW) is None
    assert edge_boost(eng, [R(*NODE2, NOW - timedelta(hours=3))], NOW) is None
    b = edge_boost(eng, [R(*NODE2, NOW), R(*NODE2, NOW - timedelta(hours=1))], NOW)
    assert b is not None
    touches_2 = np.array([2 in (u, v) for u, v in zip(eng.eu, eng.ev)])
    assert np.allclose(b[touches_2], BOOST)  # strongest report wins, no stacking
    assert np.allclose(b[~touches_2], 0)


def test_reports_near_route_ahead_only() -> None:
    route = [[float(NODE_LAT[i]), float(NODE_LON[i])] for i in (0, 2, 3)]
    rep = R(*NODE2, NOW)
    assert reports_near_route(route, [rep], NOW) == [rep]
    assert reports_near_route(route, [rep], NOW, from_along_m=550) == []  # already passed it


def test_report_endpoint_and_live_route_change(client: TestClient, engine: None) -> None:
    h = auth(client)
    body = {"from": {"lat": float(NODE_LAT[0]), "lng": float(NODE_LON[0])},
            "to": {"lat": float(NODE_LAT[3]), "lng": float(NODE_LON[3])},
            "depart_at": "2026-06-21T14:00", "night_mode": False}
    before = {r["profile"]: r for r in client.post("/api/route", json=body, headers=h).json()["routes"]}
    assert before["safest"]["distance_m"] == 600  # the safe detour

    assert client.post("/api/reports", json={"category": "nope", "lat": 41.9, "lng": -87.6}, headers=h).status_code == 422
    r = client.post("/api/reports", json={"category": "harassment", "note": "Followed near the alley",
                                          "lat": NODE2[0], "lng": NODE2[1]}, headers=h)
    assert r.status_code == 201
    listed = client.get("/api/reports", headers=h).json()
    assert len(listed) == 1 and listed[0]["weight"] == pytest.approx(1, abs=0.01)

    after = {r["profile"]: r for r in client.post("/api/route", json=body, headers=h).json()["routes"]}
    assert after["safest"]["distance_m"] == 400  # the detour is now riskier than the direct street
    assert after["safest"]["safety_score"] < before["safest"]["safety_score"]


def test_trip_recheck_suggests_safer_route(client: TestClient, engine: None) -> None:
    h = auth(client)
    detour = [[float(NODE_LAT[i]), float(NODE_LON[i])] for i in (0, 2, 3)]
    t = client.post("/api/trips", json={"geometry": detour, "distance_m": 600, "eta_min": 7.2,
                                        "to_name": "Goal"}, headers=h).json()
    start = {"lat": float(NODE_LAT[0]), "lng": float(NODE_LON[0])}
    assert client.post(f"/api/trips/{t['id']}/recheck", json=start, headers=h).json()["safer"] is None
    client.post("/api/reports", json={"category": "suspicious", "lat": NODE2[0], "lng": NODE2[1]}, headers=h)
    res = client.post(f"/api/trips/{t['id']}/recheck", json=start, headers=h).json()
    assert res["safer"] is not None and res["avoided"] == 1
    assert res["safer"]["distance_m"] == 400 and res["extra_min"] < 0
