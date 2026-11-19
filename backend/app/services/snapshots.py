"""Initial state for the public watch (/watch/:token) and track (/track/:token) pages."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Alert, Contact, Trip, User
from app.services.live_service import LiveService, alert_json, first_name, trip_json

FEED_HOURS = 24
WALK_SPEED_M_PER_MIN = 5000.0 / 60.0


def _position(live: LiveService, user_id: int, trip: Trip | None) -> tuple[dict | None, list, dict | None]:
    """(last fix, trail, progress). Only called while the user is sharing (trip or SOS)."""
    lp = live.last_pos.get(user_id)
    last = {"lat": lp.lat, "lng": lp.lng, "t": lp.at.isoformat(), "sim": lp.sim} if lp else None
    if last is None and trip is not None and trip.last_lat is not None:
        at = trip.last_at
        if at is not None and at.tzinfo is None:
            at = at.replace(tzinfo=UTC)
        last = {"lat": trip.last_lat, "lng": trip.last_lng, "t": at.isoformat() if at else None, "sim": False}
    trail: list = []
    progress = None
    if trip is not None and (rt := live.runtimes.get(trip.id)) is not None:
        trail = [list(p) for p in rt.trail]
        if (st := rt.monitor.last) is not None:
            progress = {"remaining_m": st.remaining_m, "off_route_m": st.off_route_m, "on_route": st.on_route,
                        "eta_min": round(st.remaining_m / WALK_SPEED_M_PER_MIN, 1)}
    if not trail and last is not None:
        trail = [[last["lat"], last["lng"]]]
    return last, trail, progress


def watch_snapshot(db: Session, live: LiveService, contact: Contact) -> dict[str, Any]:
    user = db.get(User, contact.user_id)
    assert user is not None
    trip = live.active_trip(db, user.id)
    sos = live.active_sos(db, user.id)
    last, trail, progress = _position(live, user.id, trip) if (trip or sos) else (None, [], None)
    since = datetime.now(UTC) - timedelta(hours=FEED_HOURS)
    alerts = db.scalars(select(Alert).where(Alert.user_id == user.id, Alert.created_at >= since)
                        .order_by(Alert.id.desc()).limit(30)).all()
    return {
        "kind": "watch",
        "viewer": {"name": contact.name, "relation": contact.relation},
        "user": {"first_name": first_name(user)},
        "trip": trip_json(trip) if trip else None,
        "sos": alert_json(sos) if sos else None,
        "last": last, "trail": trail, "progress": progress,
        "alerts": [alert_json(a) for a in alerts],
        "channels": [n.channel for n in live.notifiers],
    }


def track_snapshot(db: Session, live: LiveService, trip: Trip) -> dict[str, Any]:
    user = db.get(User, trip.user_id)
    assert user is not None
    active = trip.status == "active"
    sos = live.active_sos(db, user.id) if active else None
    last, trail, progress = _position(live, user.id, trip) if active else (None, [], None)
    alerts = db.scalars(select(Alert).where(Alert.trip_id == trip.id).order_by(Alert.id.desc()).limit(30)).all()
    return {
        "kind": "track",
        "viewer": None,
        "user": {"first_name": first_name(user)},
        "trip": trip_json(trip),
        "sos": alert_json(sos) if sos else None,
        "last": last, "trail": trail, "progress": progress,
        "alerts": [alert_json(a) for a in alerts],
        "channels": [n.channel for n in live.notifiers],
    }
