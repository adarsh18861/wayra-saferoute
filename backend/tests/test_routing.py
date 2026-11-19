"""Routing cost, safety score, night-mode switching and /api/route on a tiny fake graph."""
from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import night_mode as nm
from app.services.risk_service import RiskService
from app.services.router_engine import (
    NIGHT_LAMBDA_FACTOR,
    NIGHT_UNLIT_PENALTY,
    RouterEngine,
    edge_cost,
    risk_level,
    safety_score,
)

# Fake graph near the Loop. 0 = start, 3 = goal.
#   direct  0 -> 1 -> 3 : ~400 m, risky (rel 0.9 by day)
#   detour  0 -> 2 -> 3 : ~600 m, safe  (rel 0.1)
# All edges in both directions. Bucket 11 (night) makes the detour unlit.
LAT0, LON0 = 41.88, -87.63
DLAT, DLON = 200 / 111_320, 200 / (111_320 * np.cos(np.radians(LAT0)))
NODE_LAT = np.array([LAT0, LAT0 + DLAT, LAT0 - DLAT, LAT0])
NODE_LON = np.array([LON0, LON0 + DLON, LON0 + DLON, LON0 + 2 * DLON])
PAIRS = [(0, 1, 200.0, 0.9), (1, 3, 200.0, 0.9), (0, 2, 300.0, 0.1), (2, 3, 300.0, 0.1)]


def fake_engine(detour_unlit: bool = False) -> RouterEngine:
    eu, ev, length, rel, unlit = [], [], [], [], []
    for u, v, L, r in PAIRS:
        for a, b in ((u, v), (v, u)):
            eu.append(a)
            ev.append(b)
            length.append(L)
            rel.append(np.full(12, r, np.float32))
            unlit.append(detour_unlit and 2 in (u, v))
    return RouterEngine(NODE_LAT, NODE_LON, np.array(eu), np.array(ev), np.array(length, np.float32),
                        np.vstack(rel), np.array(unlit))


# ---------------------------------------------------------------- pure functions
def test_edge_cost_formula() -> None:
    L, r = np.array([100.0, 50.0]), np.array([0.5, 0.0])
    assert np.allclose(edge_cost(L, r, 0.0), [100, 50])
    assert np.allclose(edge_cost(L, r, 8.0), [100 * (1 + 8 * 0.5), 50])


def test_edge_cost_night_scales_lambda_and_penalises_unlit() -> None:
    L, r, unlit = np.array([100.0, 100.0]), np.array([0.5, 0.5]), np.array([False, True])
    c = edge_cost(L, r, 2.0, night=True, unlit=unlit)
    lam = 2.0 * NIGHT_LAMBDA_FACTOR
    assert np.allclose(c, [100 * (1 + lam * 0.5), 100 * (1 + lam * (0.5 + NIGHT_UNLIT_PENALTY))])
    # Fastest ignores risk and lighting even at night
    assert np.allclose(edge_cost(L, r, 0.0, night=True, unlit=unlit), [100, 100])


def test_safety_score_length_weighted() -> None:
    assert safety_score(np.array([100.0, 300.0]), np.array([1.0, 0.0])) == 75
    assert safety_score(np.array([50.0]), np.array([0.2])) == 80
    assert safety_score(np.array([]), np.array([])) == 100


def test_risk_level_thresholds() -> None:
    assert [risk_level(x) for x in (0.0, 0.329, 0.33, 0.659, 0.66, 1.0)] == \
        ["green", "green", "amber", "amber", "red", "red"]


# ---------------------------------------------------------------- night mode
def test_night_mode_auto_follows_sun() -> None:
    day = datetime(2026, 6, 21, 14, 0, tzinfo=nm.CHICAGO_TZ)
    night = datetime(2026, 6, 21, 23, 0, tzinfo=nm.CHICAGO_TZ)
    winter_evening = datetime(2026, 12, 21, 17, 30, tzinfo=nm.CHICAGO_TZ)  # sunset ~16:20
    assert nm.resolve_night_mode("auto", day) == (False, "auto")
    assert nm.resolve_night_mode("auto", night) == (True, "auto")
    assert nm.resolve_night_mode("auto", winter_evening) == (True, "auto")
    assert nm.resolve_night_mode(True, day) == (True, "override")
    assert nm.resolve_night_mode(False, night) == (False, "override")


def test_local_time_and_bucket() -> None:
    naive = nm.to_local(datetime(2026, 3, 1, 23, 15))
    assert naive.tzinfo is not None and naive.hour == 23 and nm.time_bucket(naive) == 11
    utc = nm.to_local(datetime.fromisoformat("2026-07-01T19:00:00+00:00"))  # 14:00 CDT
    assert utc.hour == 14 and nm.time_bucket(utc) == 7


# ---------------------------------------------------------------- engine
def test_engine_profiles_pick_direct_vs_detour() -> None:
    out = fake_engine().route((NODE_LAT[0], NODE_LON[0]), (NODE_LAT[3], NODE_LON[3]), bucket=7, night=False)
    fastest, balanced, safest = out["routes"]
    assert fastest.distance_m == 400 and safest.distance_m == 600
    assert fastest.safety_score == 10 and safest.safety_score == 90
    assert balanced.identical_to == ["safest"] and safest.identical_to == ["balanced"]
    assert fastest.risk_m == {"green": 0.0, "amber": 0.0, "red": 400.0}
    assert fastest.eta_min == pytest.approx(400 / (5000 / 60), abs=0.1)
    assert fastest.geometry[0] == pytest.approx([NODE_LAT[0], NODE_LON[0]])
    assert fastest.geometry[-1] == pytest.approx([NODE_LAT[3], NODE_LON[3]])


def test_engine_night_unlit_penalty_flips_safest() -> None:
    # Direct path lit but mildly risky; detour risk-free but unlit.
    eng = fake_engine(detour_unlit=True)
    eng.rel_risk[:4] = 0.3  # direct edges
    eng.rel_risk[4:] = 0.0  # detour edges
    a, b = (NODE_LAT[0], NODE_LON[0]), (NODE_LAT[3], NODE_LON[3])
    # day, lambda 8: direct 400*(1+8*0.3)=1360 > detour 600 -> detour
    assert eng.route(a, b, bucket=7, night=False)["routes"][2].distance_m == 600
    # night, lambda 12: direct 400*(1+12*0.3)=1840 < detour 600*(1+12*0.2)=2040 -> direct (lit)
    assert eng.route(a, b, bucket=11, night=True)["routes"][2].distance_m == 400


# ---------------------------------------------------------------- API
@pytest.fixture()
def auth_headers(client: TestClient) -> dict[str, str]:
    r = client.post("/api/auth/register",
                    json={"name": "Asha", "email": "route@example.com", "password": "s3cure-pass"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def with_engine() -> Iterator[None]:
    app.state.router_engine = fake_engine()
    try:
        yield
    finally:
        app.state.router_engine = None


BODY = {"from": {"lat": NODE_LAT[0], "lng": NODE_LON[0]}, "to": {"lat": NODE_LAT[3], "lng": NODE_LON[3]},
        "depart_at": "2026-06-21T23:00:00"}


def test_route_requires_auth(client: TestClient) -> None:
    assert client.post("/api/route", json=BODY).status_code == 401


def test_route_503_without_data(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.post("/api/route", json=BODY, headers=auth_headers)
    assert r.status_code == 503 and "Routing is unavailable" in r.json()["detail"]


def test_route_endpoint(client: TestClient, auth_headers: dict[str, str], with_engine: None) -> None:
    r = client.post("/api/route", json=BODY, headers=auth_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["bucket"] == 11 and d["night_mode"] is True and d["night_mode_source"] == "auto"
    assert [x["profile"] for x in d["routes"]] == ["fastest", "balanced", "safest"]
    assert [x["lambda"] for x in d["routes"]] == [0.0, 2.25, 12.0]
    assert d["identical_routes"] is True
    fastest, safest = d["routes"][0], d["routes"][2]
    assert safest["safety_score"] > fastest["safety_score"]
    assert {"distance_m", "eta_min", "geometry", "segments", "risk_m"} <= set(fastest)
    assert fastest["segments"][0]["level"] == "red" and safest["segments"][0]["level"] == "green"


def test_route_night_override(client: TestClient, auth_headers: dict[str, str], with_engine: None) -> None:
    r = client.post("/api/route", json={**BODY, "night_mode": False}, headers=auth_headers)
    d = r.json()
    assert d["night_mode"] is False and d["night_mode_source"] == "override"
    assert d["routes"][2]["lambda"] == 8.0


def test_status_endpoint(client: TestClient, with_engine: None) -> None:
    d = client.get("/api/status", params={"at": "2026-06-21T23:00:00"}).json()  # public, no auth
    assert d["night_mode"] is True and d["bucket"] == 11 and d["routing_ready"] is True
    assert d["heatmap_ready"] is False
    d = client.get("/api/status", params={"at": "2026-06-21T14:00:00"}).json()
    assert d["night_mode"] is False and d["bucket"] == 7
    assert d["sunrise"].startswith("2026-06-21T05:") and d["sunset"].startswith("2026-06-21T20:")


def test_route_outside_network(client: TestClient, auth_headers: dict[str, str], with_engine: None) -> None:
    body = {**BODY, "to": {"lat": 40.0, "lng": -88.0}}
    assert client.post("/api/route", json=body, headers=auth_headers).status_code == 422


def test_heatmap_and_model_card(client: TestClient, auth_headers: dict[str, str], tmp_path: Path) -> None:
    import h3

    cells = [h3.latlng_to_cell(LAT0, LON0, 9), h3.latlng_to_cell(LAT0 + 0.01, LON0, 9)]
    risk = np.array([np.linspace(0.01, 0.12, 12), np.linspace(0.02, 0.5, 12)], np.float32)
    app.state.risk_service = RiskService(cells, risk, "2026-11")
    metrics = tmp_path / "metrics.json"
    metrics.write_text('{"test": {"model": {"roc_auc": 0.8}}}', encoding="utf-8")
    old_metrics = app.state.metrics_path
    app.state.metrics_path = metrics
    try:
        assert client.get("/api/heatmap?bucket=3").status_code == 401
        fc = client.get("/api/heatmap?bucket=11", headers=auth_headers).json()
        assert fc["type"] == "FeatureCollection" and len(fc["features"]) == 2
        rel = [f["properties"]["rel_risk"] for f in fc["features"]]
        assert rel[1] == 1.0 and 0 < rel[0] < 1
        ring = fc["features"][0]["geometry"]["coordinates"][0]
        assert ring[0] == ring[-1] and len(ring) == 7
        assert client.get("/api/model-card", headers=auth_headers).json()["test"]["model"]["roc_auc"] == 0.8
        summary = client.get("/api/public/model-summary")  # public: no auth header
        assert summary.status_code == 200 and summary.json()["roc_auc"] == 0.8
        assert "feature_importance_gain_share" not in summary.json()
        app.state.metrics_path = tmp_path / "missing.json"
        assert client.get("/api/model-card", headers=auth_headers).status_code == 503
        assert client.get("/api/public/model-summary").status_code == 503
    finally:
        app.state.risk_service = None
        app.state.metrics_path = old_metrics
