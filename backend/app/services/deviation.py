"""Deviation detection for a live trip (Phase 6-7).

Pure logic with an injected clock (`t` in seconds), so the geometry and timers are unit-testable:

* **Off route**: farther than `off_route_m` (100 m) from the planned polyline for longer than
  `off_route_s` (30 s) -> a check-in starts.
* **Stopped**: has not moved more than `stationary_m` (25 m) from an anchor point for longer than
  `stationary_s` (3 min) while the trip is running -> a check-in starts.
* **Check-in**: the user's app shows "Are you OK? Alerting contacts in 15 s". If the user does not
  answer within `check_s`, `tick()` returns an AlertDue event and the contacts are alerted.
  Answering cancels it and snoozes that reason until the condition clears (back on the route /
  moving again) or `snooze_s` passes, so a deliberate detour doesn't nag every 45 s.
* **Arrived**: within `arrive_m` (40 m) of the destination -> one Arrived event.

Only one check-in is pending at a time. After an alert for a reason, that reason re-arms only
when its condition clears. Demo trips use shorter timers (DEMO_CONFIG) so a presenter doesn't
wait 3 minutes; the UI labels them.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

M_PER_DEG_LAT = 111_320.0

Reason = Literal["off_route", "stopped"]


@dataclass(frozen=True)
class MonitorConfig:
    off_route_m: float = 100.0
    off_route_s: float = 30.0
    stationary_m: float = 25.0
    stationary_s: float = 180.0
    arrive_m: float = 40.0
    check_s: float = 15.0
    snooze_s: float = 120.0
    # GPS accuracy (metres) counted in the user's favour, capped so a bad fix can't hide a deviation.
    max_accuracy_slack_m: float = 50.0


REAL_CONFIG = MonitorConfig()
DEMO_CONFIG = MonitorConfig(off_route_s=10.0, stationary_s=20.0, snooze_s=30.0)


# ---------------------------------------------------------------- geometry
def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


@dataclass
class RouteGeometry:
    """A polyline in a local metric projection (equirectangular around its first point)."""

    latlng: np.ndarray  # (N, 2)
    xy: np.ndarray = field(init=False)
    cum: np.ndarray = field(init=False)  # cumulative length at each vertex (N,)
    lat0: float = field(init=False)
    lng0: float = field(init=False)
    kx: float = field(init=False)

    def __post_init__(self) -> None:
        pts = np.asarray(self.latlng, np.float64).reshape(-1, 2)
        if len(pts) == 0:
            raise ValueError("route geometry is empty")
        if len(pts) == 1:
            pts = np.vstack([pts, pts])
        self.latlng = pts
        self.lat0, self.lng0 = float(pts[0, 0]), float(pts[0, 1])
        self.kx = M_PER_DEG_LAT * math.cos(math.radians(self.lat0))
        self.xy = self.project(pts[:, 0], pts[:, 1])
        seg = np.hypot(*np.diff(self.xy, axis=0).T)
        self.cum = np.r_[0.0, np.cumsum(seg)]

    def project(self, lat: np.ndarray | float, lng: np.ndarray | float) -> np.ndarray:
        lat, lng = np.asarray(lat, np.float64), np.asarray(lng, np.float64)
        return np.stack([(lng - self.lng0) * self.kx, (lat - self.lat0) * M_PER_DEG_LAT], axis=-1)

    @property
    def length_m(self) -> float:
        return float(self.cum[-1])

    @property
    def destination(self) -> tuple[float, float]:
        return float(self.latlng[-1, 0]), float(self.latlng[-1, 1])

    def locate(self, lat: float, lng: float) -> tuple[float, float]:
        """(distance to the polyline in metres, distance along the route of the closest point)."""
        p = self.project(lat, lng)
        a, b = self.xy[:-1], self.xy[1:]
        ab = b - a
        L2 = np.einsum("ij,ij->i", ab, ab)
        t = np.where(L2 > 0, np.einsum("ij,ij->i", p - a, ab) / np.where(L2 > 0, L2, 1.0), 0.0)
        t = np.clip(t, 0.0, 1.0)
        closest = a + ab * t[:, None]
        d = np.hypot(*(closest - p).T)
        i = int(np.argmin(d))
        along = float(self.cum[i] + t[i] * math.sqrt(L2[i]))
        return float(d[i]), along

    def remaining_m(self, lat: float, lng: float) -> float:
        _, along = self.locate(lat, lng)
        return max(0.0, self.length_m - along)


def distance_to_route_m(lat: float, lng: float, route: list[list[float]]) -> float:
    return RouteGeometry(np.asarray(route)).locate(lat, lng)[0]


# ---------------------------------------------------------------- events
@dataclass(frozen=True)
class CheckStarted:
    reason: Reason
    deadline: float
    distance_m: float  # metres off route (off_route) or seconds stopped (stopped)


@dataclass(frozen=True)
class CheckCleared:
    reason: Reason
    by: Literal["user", "condition"]


@dataclass(frozen=True)
class AlertDue:
    reason: Reason
    off_route_m: float
    stopped_s: float


@dataclass(frozen=True)
class Arrived:
    pass


Event = CheckStarted | CheckCleared | AlertDue | Arrived


@dataclass
class Status:
    off_route_m: float
    remaining_m: float
    on_route: bool


@dataclass
class _Pending:
    reason: Reason
    deadline: float


class DeviationMonitor:
    def __init__(self, route: list[list[float]] | np.ndarray, config: MonitorConfig = REAL_CONFIG) -> None:
        self.geo = RouteGeometry(np.asarray(route, np.float64))
        self.cfg = config
        self.off_since: float | None = None
        self.anchor: tuple[float, float, float] | None = None  # lat, lng, t
        self.pending: _Pending | None = None
        self.armed: dict[str, bool] = {"off_route": True, "stopped": True}
        self.snoozed_until: dict[str, float] = {"off_route": -math.inf, "stopped": -math.inf}
        self.arrived = False
        self.last: Status | None = None
        self.last_off_m = 0.0
        self.last_t: float | None = None

    # -- helpers
    def _stopped_for(self, t: float) -> float:
        return 0.0 if self.anchor is None else t - self.anchor[2]

    def _can_fire(self, reason: Reason, t: float) -> bool:
        return self.pending is None and self.armed[reason] and t >= self.snoozed_until[reason]

    # -- public API
    def update(self, lat: float, lng: float, t: float, accuracy: float | None = None) -> tuple[Status, list[Event]]:
        """Feed one location fix. Returns the current status and any events it caused."""
        events: list[Event] = []
        self.last_t = t
        if self.arrived:
            st = Status(0.0, 0.0, True)
            return st, events

        off_m, along = self.geo.locate(lat, lng)
        slack = min(accuracy or 0.0, self.cfg.max_accuracy_slack_m)
        is_off = off_m - slack > self.cfg.off_route_m
        remaining = max(0.0, self.geo.length_m - along)
        self.last_off_m = off_m
        st = Status(round(off_m, 1), round(remaining, 1), not is_off)
        self.last = st

        # Arrival ends monitoring (and drops any pending check).
        dlat, dlng = self.geo.destination
        if haversine_m(lat, lng, dlat, dlng) <= self.cfg.arrive_m:
            self.arrived = True
            if self.pending is not None:
                events.append(CheckCleared(self.pending.reason, "condition"))
                self.pending = None
            events.append(Arrived())
            return st, events

        # Off-route timer.
        if is_off:
            if self.off_since is None:
                self.off_since = t
        else:
            self.off_since = None
            self.armed["off_route"] = True
            self.snoozed_until["off_route"] = -math.inf
            if self.pending is not None and self.pending.reason == "off_route":
                events.append(CheckCleared("off_route", "condition"))
                self.pending = None

        # Stationary timer: the anchor moves whenever the user gets stationary_m away from it.
        if self.anchor is None or haversine_m(lat, lng, self.anchor[0], self.anchor[1]) > self.cfg.stationary_m:
            moved = self.anchor is not None
            self.anchor = (lat, lng, t)
            if moved:
                self.armed["stopped"] = True
                self.snoozed_until["stopped"] = -math.inf
                if self.pending is not None and self.pending.reason == "stopped":
                    events.append(CheckCleared("stopped", "condition"))
                    self.pending = None

        if self.off_since is not None and t - self.off_since > self.cfg.off_route_s and self._can_fire("off_route", t):
            self.pending = _Pending("off_route", t + self.cfg.check_s)
            events.append(CheckStarted("off_route", self.pending.deadline, round(off_m, 1)))
        elif self._stopped_for(t) > self.cfg.stationary_s and self._can_fire("stopped", t):
            self.pending = _Pending("stopped", t + self.cfg.check_s)
            events.append(CheckStarted("stopped", self.pending.deadline, round(self._stopped_for(t), 1)))

        events.extend(self.tick(t))
        return st, events

    def tick(self, t: float) -> list[Event]:
        """Call regularly (also without new fixes): fires a pending check whose deadline passed."""
        if self.pending is None or t < self.pending.deadline:
            return []
        reason = self.pending.reason
        self.pending = None
        self.armed[reason] = False  # re-arms when the condition clears
        return [AlertDue(reason, round(self.last_off_m, 1), round(self._stopped_for(t), 1))]

    def cancel_check(self, t: float) -> CheckCleared | None:
        """The user answered "I'm OK": drop the pending check and snooze that reason."""
        if self.pending is None:
            return None
        reason = self.pending.reason
        self.pending = None
        self.snoozed_until[reason] = t + self.cfg.snooze_s
        if reason == "off_route":
            self.off_since = t  # a fresh full window after the snooze
        else:
            if self.anchor is not None:
                self.anchor = (self.anchor[0], self.anchor[1], t)
        return CheckCleared(reason, "user")
