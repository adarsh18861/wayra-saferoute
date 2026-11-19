"""Deviation geometry and timers (services/deviation.py), with an injected clock."""
from __future__ import annotations

import math

import numpy as np
import pytest

from app.services.deviation import (
    DEMO_CONFIG,
    AlertDue,
    Arrived,
    CheckCleared,
    CheckStarted,
    DeviationMonitor,
    MonitorConfig,
    RouteGeometry,
    distance_to_route_m,
    haversine_m,
)

LAT0, LNG0 = 41.88, -87.63
M_LAT = 111_320.0
M_LNG = M_LAT * math.cos(math.radians(LAT0))


def pt(east_m: float, north_m: float) -> tuple[float, float]:
    return LAT0 + north_m / M_LAT, LNG0 + east_m / M_LNG


# A straight 1 km route due east.
ROUTE = [list(pt(0, 0)), list(pt(500, 0)), list(pt(1000, 0))]


def kinds(events: list) -> list[str]:
    return [type(e).__name__ for e in events]


# ---------------------------------------------------------------- geometry
def test_haversine_known_distance() -> None:
    a, b = pt(0, 0), pt(0, 1000)
    assert haversine_m(*a, *b) == pytest.approx(1000, rel=2e-3)


def test_distance_to_route_perpendicular_and_beyond_end() -> None:
    assert distance_to_route_m(*pt(300, 120), ROUTE) == pytest.approx(120, abs=1)
    assert distance_to_route_m(*pt(250, -80), ROUTE) == pytest.approx(80, abs=1)
    # past the end: distance to the last vertex
    assert distance_to_route_m(*pt(1030, 40), ROUTE) == pytest.approx(50, abs=1)


def test_locate_along_and_remaining() -> None:
    geo = RouteGeometry(np.asarray(ROUTE))
    assert geo.length_m == pytest.approx(1000, abs=1)
    d, along = geo.locate(*pt(700, 10))
    assert d == pytest.approx(10, abs=1) and along == pytest.approx(700, abs=1)
    assert geo.remaining_m(*pt(700, 10)) == pytest.approx(300, abs=1)


def test_locate_on_l_shaped_route_picks_nearest_leg() -> None:
    route = [list(pt(0, 0)), list(pt(400, 0)), list(pt(400, 400))]
    d, along = RouteGeometry(np.asarray(route)).locate(*pt(420, 300))
    assert d == pytest.approx(20, abs=1) and along == pytest.approx(700, abs=1)


def test_single_point_route_is_allowed() -> None:
    assert RouteGeometry(np.asarray([list(pt(0, 0))])).length_m == 0


# ---------------------------------------------------------------- off route
def test_off_route_needs_more_than_30_s_then_check_then_alert() -> None:
    m = DeviationMonitor(ROUTE)
    _, ev = m.update(*pt(100, 0), t=0)
    assert ev == []
    st, ev = m.update(*pt(200, 150), t=10)
    assert not st.on_route and st.off_route_m == pytest.approx(150, abs=1) and ev == []
    _, ev = m.update(*pt(200, 150), t=40)  # exactly 30 s off: not yet (> 30 s)
    assert ev == []
    _, ev = m.update(*pt(210, 150), t=41)
    assert kinds(ev) == ["CheckStarted"]
    assert ev[0].reason == "off_route" and ev[0].deadline == 41 + 15
    assert m.tick(55) == []
    due = m.tick(56)
    assert kinds(due) == ["AlertDue"] and due[0].reason == "off_route"
    assert due[0].off_route_m == pytest.approx(150, abs=1)
    # no repeat alert while still off route
    _, ev = m.update(*pt(260, 150), t=60)  # still off route (and moving)
    assert ev == []


def test_short_detour_under_30_s_does_nothing() -> None:
    m = DeviationMonitor(ROUTE)
    m.update(*pt(100, 150), t=0)
    m.update(*pt(150, 150), t=20)
    _, ev = m.update(*pt(200, 0), t=29)  # back on route in time
    _, ev2 = m.update(*pt(250, 0), t=60)
    assert ev == [] and ev2 == []


def test_within_100_m_is_on_route() -> None:
    m = DeviationMonitor(ROUTE)
    for t in range(0, 120, 3):
        st, ev = m.update(*pt(10 + t * 1.4, 95), t=t)
        assert st.on_route and not any(isinstance(e, CheckStarted) for e in ev)


def test_gps_accuracy_slack_is_capped() -> None:
    m = DeviationMonitor(ROUTE)
    st, _ = m.update(*pt(100, 130), t=0, accuracy=40)
    assert st.on_route  # 130 - 40 <= 100
    st, _ = m.update(*pt(100, 200), t=1, accuracy=500)
    assert not st.on_route  # slack capped at 50 m


def test_back_on_route_clears_pending_check() -> None:
    m = DeviationMonitor(ROUTE)
    m.update(*pt(100, 200), t=0)
    _, ev = m.update(*pt(110, 200), t=31)
    assert kinds(ev) == ["CheckStarted"]
    _, ev = m.update(*pt(120, 5), t=35)
    assert kinds(ev) == ["CheckCleared"] and ev[0].by == "condition"
    assert m.tick(100) == []


def test_user_cancel_snoozes_then_rechecks() -> None:
    cfg = MonitorConfig(snooze_s=120)
    m = DeviationMonitor(ROUTE, cfg)
    m.update(*pt(100, 200), t=0)
    m.update(*pt(100, 200), t=31)
    cleared = m.cancel_check(t=35)
    assert isinstance(cleared, CheckCleared) and cleared.by == "user"
    assert m.tick(60) == []
    _, ev = m.update(*pt(105, 200), t=100)  # still snoozed
    assert ev == []
    _, ev = m.update(*pt(110, 200), t=160)  # snooze over and > 30 s since cancel
    assert kinds(ev) == ["CheckStarted"]


def test_cancel_without_pending_is_none() -> None:
    assert DeviationMonitor(ROUTE).cancel_check(5) is None


# ---------------------------------------------------------------- stopped
def test_stationary_over_3_min_triggers_check() -> None:
    m = DeviationMonitor(ROUTE)
    m.update(*pt(300, 0), t=0)
    for t in range(3, 181, 3):  # jitter within 25 m
        _, ev = m.update(*pt(300 + (t % 2) * 8, 4), t=t)
        assert ev == []
    _, ev = m.update(*pt(305, 0), t=181)
    assert kinds(ev) == ["CheckStarted"] and ev[0].reason == "stopped"
    due = m.tick(196)
    assert kinds(due) == ["AlertDue"] and due[0].reason == "stopped" and due[0].stopped_s >= 180


def test_moving_resets_stationary_timer_and_clears_check() -> None:
    m = DeviationMonitor(ROUTE)
    m.update(*pt(300, 0), t=0)
    _, ev = m.update(*pt(300, 0), t=181)
    assert kinds(ev) == ["CheckStarted"]
    _, ev = m.update(*pt(340, 0), t=185)  # walked 40 m
    assert kinds(ev) == ["CheckCleared"]
    _, ev = m.update(*pt(340, 0), t=300)
    assert ev == []


def test_only_one_check_at_a_time() -> None:
    m = DeviationMonitor(ROUTE)
    m.update(*pt(300, 200), t=0)
    _, ev = m.update(*pt(300, 200), t=181)  # both off route and stopped
    assert kinds(ev) == ["CheckStarted"] and ev[0].reason == "off_route"


def test_demo_config_uses_short_timers() -> None:
    m = DeviationMonitor(ROUTE, DEMO_CONFIG)
    m.update(*pt(100, 200), t=0)
    _, ev = m.update(*pt(150, 200), t=10.5)
    assert kinds(ev) == ["CheckStarted"]


# ---------------------------------------------------------------- arrival
def test_arrival_within_40_m_once() -> None:
    m = DeviationMonitor(ROUTE)
    m.update(*pt(900, 0), t=0)
    _, ev = m.update(*pt(970, 10), t=10)
    assert kinds(ev) == ["Arrived"]
    _, ev = m.update(*pt(1000, 0), t=20)
    assert ev == []


def test_arrival_drops_pending_check() -> None:
    m = DeviationMonitor(ROUTE)
    m.update(*pt(990, 0), t=0)
    m.anchor = (*pt(990, 0), -500.0)
    m.pending = None
    m.update(*pt(1000, 0), t=1)
    assert m.arrived and m.pending is None
    _, ev = DeviationMonitor(ROUTE).update(*pt(1000, 0), t=0)
    assert isinstance(ev[-1], Arrived)


def test_alert_due_is_returned_by_update_too() -> None:
    m = DeviationMonitor(ROUTE)
    m.update(*pt(100, 200), t=0)
    m.update(*pt(100, 200), t=31)
    _, ev = m.update(*pt(100, 200), t=50)
    assert any(isinstance(e, AlertDue) for e in ev)
