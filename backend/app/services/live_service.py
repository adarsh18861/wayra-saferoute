"""Live safety state: alert dispatch, active-trip monitors, location fan-out, check-in timers.

One LiveService per process (app.state.live). DB work happens in short sessions; the in-memory
part (trip monitors, trails, last positions) is rebuilt lazily from the DB after a restart, so a
restart only loses the trail drawn so far and any check-in that was pending.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.models import Alert, Contact, Delivery, Trip, User
from app.schemas.safety import AlertOut, TripOut
from app.services import deviation as dv
from app.services.live_hub import LiveHub
from app.services.notifier import Message, Notifier, Recipient, build_notifiers

logger = logging.getLogger("wayra.live")

WALK_SPEED_M_PER_MIN = 5000.0 / 60.0
TRAIL_MAX = 800
DB_WRITE_EVERY_S = 10.0


def first_name(user: User) -> str:
    return (user.name.strip().split() or ["Your contact"])[0]


def now_utc() -> datetime:
    return datetime.now(UTC)


def trip_json(trip: Trip) -> dict[str, Any]:
    return TripOut(
        id=trip.id, share_token=trip.share_token, status=trip.status, profile=trip.profile,
        from_name=trip.from_name, to_name=trip.to_name, geometry=json.loads(trip.geometry_json),
        distance_m=trip.distance_m, eta_min=trip.eta_min, safety_score=trip.safety_score, demo=trip.demo,
        started_at=trip.started_at, ended_at=trip.ended_at,
    ).model_dump(mode="json")


def alert_json(alert: Alert) -> dict[str, Any]:
    return AlertOut.model_validate(alert).model_dump(mode="json")


def watch_url(contact: Contact) -> str:
    return f"{settings.public_base_url.rstrip('/')}/watch/{contact.watch_token}"


def track_url(trip: Trip) -> str:
    return f"{settings.public_base_url.rstrip('/')}/track/{trip.share_token}"


@dataclass
class TripRuntime:
    trip_id: int
    user_id: int
    share_token: str
    monitor: dv.DeviationMonitor
    trail: deque[list[float]] = field(default_factory=lambda: deque(maxlen=TRAIL_MAX))
    last_db_write: float = 0.0


@dataclass
class LastPos:
    lat: float
    lng: float
    at: datetime
    sim: bool = False


class LiveService:
    def __init__(self, hub: LiveHub | None = None) -> None:
        self.hub = hub or LiveHub()
        self.notifiers: list[Notifier] = build_notifiers(settings, self.hub)
        self.runtimes: dict[int, TripRuntime] = {}
        self.last_pos: dict[int, LastPos] = {}
        self.clock: Callable[[], float] = time.monotonic
        self.session_factory: sessionmaker[Session] | None = None
        self._ticker: asyncio.Task[None] | None = None

    def reset(self) -> None:
        """Forget all in-memory state (tests)."""
        self.hub.clear()
        self.runtimes.clear()
        self.last_pos.clear()
        self.clock = time.monotonic
        self.notifiers = build_notifiers(settings, self.hub)

    # ------------------------------------------------------------ publishing
    def to_watchers(self, user_id: int, trip: Trip | None, msg: dict[str, Any]) -> None:
        """Location/trip updates: contacts' watch pages and, for a trip, its /track viewers."""
        self.hub.publish(f"user:{user_id}", msg)
        if trip is not None:
            self.hub.publish(f"trip:{trip.share_token}", msg)

    def to_self(self, user_id: int, msg: dict[str, Any]) -> None:
        self.hub.publish(f"self:{user_id}", msg)

    # ------------------------------------------------------------ alerts
    def dispatch(self, db: Session, user: User, kind: str, message: str, *, trip: Trip | None = None,
                 lat: float | None = None, lng: float | None = None, source: str | None = None) -> Alert:
        """Store an alert and deliver it to every trusted contact through the notifiers."""
        if lat is None and (lp := self.last_pos.get(user.id)) is not None:
            lat, lng = lp.lat, lp.lng
        alert = Alert(user_id=user.id, trip_id=trip.id if trip else None, kind=kind, message=message,
                      source=source, lat=lat, lng=lng)
        db.add(alert)
        db.flush()
        payload = alert_json(alert)
        msg = Message(kind, message, payload)
        contacts = db.scalars(select(Contact).where(Contact.user_id == user.id).order_by(Contact.id)).all()
        for c in contacts:
            rcpt = Recipient(c.id, c.name, c.phone, c.email, watch_url(c))
            for n in self.notifiers:
                res = n.send(rcpt, msg)
                if res is not None:
                    db.add(Delivery(alert_id=alert.id, contact_id=c.id, contact_name=c.name,
                                    channel=res.channel, status=res.status, detail=res.detail))
        if kind == "sos":
            db.add(Delivery(alert_id=alert.id, contact_name="Authorities (911)", channel="authorities",
                            status="simulated",
                            detail="Simulated: no dispatcher was contacted. Use the Call 911 button to call."))
        db.commit()
        if trip is not None:
            self.hub.publish(f"trip:{trip.share_token}", {"type": "alert", "alert": payload})
        self.to_self(user.id, {"type": "alert", "alert": payload, "contacts": len(contacts)})
        logger.info("alert %s for user %s -> %d contacts", kind, user.id, len(contacts))
        return alert

    # ------------------------------------------------------------ trips
    def runtime(self, trip: Trip) -> TripRuntime:
        rt = self.runtimes.get(trip.id)
        if rt is None:
            cfg = dv.DEMO_CONFIG if trip.demo else dv.REAL_CONFIG
            rt = TripRuntime(trip.id, trip.user_id, trip.share_token,
                             dv.DeviationMonitor(json.loads(trip.geometry_json), cfg))
            if trip.last_lat is not None and trip.last_lng is not None:
                rt.trail.append([trip.last_lat, trip.last_lng])
            self.runtimes[trip.id] = rt
        return rt

    def set_demo(self, trip: Trip) -> None:
        rt = self.runtime(trip)
        rt.monitor.cfg = dv.DEMO_CONFIG if trip.demo else dv.REAL_CONFIG

    def reroute(self, trip: Trip) -> None:
        rt = self.runtime(trip)
        cfg = rt.monitor.cfg
        rt.monitor = dv.DeviationMonitor(json.loads(trip.geometry_json), cfg)
        self.to_watchers(trip.user_id, trip, {"type": "trip", "trip": trip_json(trip)})

    def finish(self, db: Session, trip: Trip, status: str) -> None:
        trip.status = status
        trip.ended_at = now_utc()
        db.commit()
        self.runtimes.pop(trip.id, None)
        msg = {"type": "trip", "trip": trip_json(trip)}
        self.to_watchers(trip.user_id, trip, msg)
        self.to_self(trip.user_id, msg)

    @staticmethod
    def active_trip(db: Session, user_id: int) -> Trip | None:
        return db.scalar(select(Trip).where(Trip.user_id == user_id, Trip.status == "active")
                         .order_by(Trip.id.desc()))

    @staticmethod
    def active_sos(db: Session, user_id: int) -> Alert | None:
        return db.scalar(select(Alert).where(Alert.user_id == user_id, Alert.kind == "sos",
                                             Alert.resolved_at.is_(None)).order_by(Alert.id.desc()))

    # ------------------------------------------------------------ location
    def handle_location(self, db: Session, user: User, lat: float, lng: float,
                        accuracy: float | None = None, sim: bool = False) -> dict[str, Any] | None:
        """One location fix from the user's app. Shared with watchers only during a trip or an SOS."""
        at = now_utc()
        self.last_pos[user.id] = LastPos(lat, lng, at, sim)
        trip = self.active_trip(db, user.id)
        sos = self.active_sos(db, user.id)
        if trip is None and sos is None:
            return None
        loc: dict[str, Any] = {"type": "loc", "lat": lat, "lng": lng, "t": at.isoformat(), "sim": sim,
                               "trip_id": trip.id if trip else None}
        if trip is None:
            self.to_watchers(user.id, None, loc)
            return loc

        rt = self.runtime(trip)
        rt.trail.append([lat, lng])
        t = self.clock()
        status, events = rt.monitor.update(lat, lng, t, accuracy)
        loc.update(remaining_m=status.remaining_m, off_route_m=status.off_route_m, on_route=status.on_route,
                   eta_min=round(status.remaining_m / WALK_SPEED_M_PER_MIN, 1))
        if t - rt.last_db_write >= DB_WRITE_EVERY_S:
            trip.last_lat, trip.last_lng, trip.last_at = lat, lng, at
            db.commit()
            rt.last_db_write = t
        self.to_watchers(user.id, trip, loc)
        self.to_self(user.id, {**loc, "type": "progress"})
        self._handle_events(db, user, trip, events)
        return loc

    def _handle_events(self, db: Session, user: User, trip: Trip, events: list[dv.Event]) -> None:
        name = first_name(user)
        for ev in events:
            if isinstance(ev, dv.CheckStarted):
                seconds = max(0, round(ev.deadline - self.clock()))
                self.to_self(user.id, {"type": "check", "reason": ev.reason, "seconds": seconds,
                                       "detail": ev.distance_m})
                self.to_watchers(user.id, trip, {"type": "check", "reason": ev.reason})
            elif isinstance(ev, dv.CheckCleared):
                msg = {"type": "check_cleared", "reason": ev.reason, "by": ev.by}
                self.to_self(user.id, msg)
                self.to_watchers(user.id, trip, msg)
            elif isinstance(ev, dv.AlertDue):
                if ev.reason == "off_route":
                    text = (f"{name} is about {round(ev.off_route_m)} m off the planned route"
                            f"{' to ' + trip.to_name if trip.to_name else ''} and didn't answer a check-in.")
                else:
                    mins = ev.stopped_s / 60
                    took = f"{mins:.0f} min" if mins >= 1 else f"{ev.stopped_s:.0f} s"
                    text = f"{name} hasn't moved for {took} during the trip and didn't answer a check-in."
                self.dispatch(db, user, ev.reason, text, trip=trip, source="auto")
            elif isinstance(ev, dv.Arrived):
                self.dispatch(db, user, "arrived",
                              f"{name} arrived safely{' at ' + trip.to_name if trip.to_name else ''}.",
                              trip=trip, source="auto")
                self.finish(db, trip, "arrived")

    def cancel_check(self, db: Session, user: User) -> bool:
        trip = self.active_trip(db, user.id)
        if trip is None or trip.id not in self.runtimes:
            return False
        ev = self.runtimes[trip.id].monitor.cancel_check(self.clock())
        if ev is None:
            return False
        self._handle_events(db, user, trip, [ev])
        return True

    # ------------------------------------------------------------ timers
    def tick_all(self) -> None:
        """Fire check-ins whose 15 s ran out, even if the user's app went quiet."""
        if self.session_factory is None:
            return
        t = self.clock()
        due = [rt for rt in list(self.runtimes.values())
               if rt.monitor.pending is not None and t >= rt.monitor.pending.deadline]
        if not due:
            return
        with self.session_factory() as db:
            for rt in due:
                trip, user = db.get(Trip, rt.trip_id), db.get(User, rt.user_id)
                if trip is None or user is None or trip.status != "active":
                    self.runtimes.pop(rt.trip_id, None)
                    continue
                self._handle_events(db, user, trip, list(rt.monitor.tick(t)))

    def ensure_ticker(self, session_factory: sessionmaker[Session]) -> None:
        self.session_factory = session_factory
        loop = asyncio.get_running_loop()
        if self._ticker is not None and not self._ticker.done() and self._ticker.get_loop() is loop:
            return
        self._ticker = loop.create_task(self._tick_loop())

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            with contextlib.suppress(Exception):
                self.tick_all()
