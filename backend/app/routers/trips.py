import json
from datetime import UTC, datetime
from typing import Any

import numpy as np

from fastapi import APIRouter, HTTPException, Request, status

from app.models import Trip
from app.routers.deps import CurrentUser, DbSession
from app.routers.live_deps import Live
from app.schemas.safety import LatLngIn, TripDemo, TripReroute, TripStart
from app.services import night_mode as nm
from app.services.deviation import RouteGeometry
from app.services.incidents import edge_boost, reports_near_route
from app.services.live_service import first_name, trip_json
from app.services.reports_store import recent_reports
from app.services.router_engine import RoutingError

router = APIRouter(prefix="/trips", tags=["trips"])


def _own_active(db: DbSession, user_id: int, trip_id: int) -> Trip:
    t = db.get(Trip, trip_id)
    if t is None or t.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    if t.status != "active":
        raise HTTPException(status.HTTP_409_CONFLICT, "This trip has already ended")
    return t


@router.post("", status_code=status.HTTP_201_CREATED)
def start_trip(body: TripStart, user: CurrentUser, db: DbSession, live: Live) -> dict[str, Any]:
    """Start sharing a walk. Any earlier active trip is ended first (one trip at a time)."""
    old = live.active_trip(db, user.id)
    if old is not None:
        live.finish(db, old, "ended")
    trip = Trip(user_id=user.id, profile=body.profile, from_name=body.from_name, to_name=body.to_name,
                geometry_json=json.dumps(body.geometry), distance_m=body.distance_m, eta_min=body.eta_min,
                safety_score=body.safety_score, demo=body.demo)
    db.add(trip)
    db.commit()
    db.refresh(trip)
    live.runtime(trip)
    tj = trip_json(trip)
    live.to_watchers(user.id, trip, {"type": "trip", "trip": tj})
    where = f": {body.from_name} → {body.to_name}" if body.from_name and body.to_name else ""
    live.dispatch(db, user, "trip_started",
                  f"{first_name(user)} started a walk{where} (about {round(body.eta_min)} min).", trip=trip)
    return tj


@router.get("/active")
def active_trip(user: CurrentUser, db: DbSession, live: Live) -> dict[str, Any] | None:
    t = live.active_trip(db, user.id)
    return trip_json(t) if t else None


@router.post("/{trip_id}/end")
def end_trip(trip_id: int, user: CurrentUser, db: DbSession, live: Live) -> dict[str, Any]:
    t = _own_active(db, user.id, trip_id)
    live.dispatch(db, user, "trip_ended", f"{first_name(user)} ended the trip.", trip=t)
    live.finish(db, t, "ended")
    return trip_json(t)


@router.post("/{trip_id}/safe")
def im_safe(trip_id: int, user: CurrentUser, db: DbSession, live: Live) -> dict[str, Any]:
    """'I'm safe' reassurance to every contact; also answers a pending check-in."""
    t = _own_active(db, user.id, trip_id)
    live.cancel_check(db, user)
    a = live.dispatch(db, user, "safe", f"{first_name(user)} says: I'm safe.", trip=t, source="button")
    return {"ok": True, "alert_id": a.id}


@router.post("/{trip_id}/ok")
def answer_check(trip_id: int, user: CurrentUser, db: DbSession, live: Live) -> dict[str, bool]:
    """'I'm OK' on a check-in prompt (REST fallback for the WebSocket 'ok' message)."""
    _own_active(db, user.id, trip_id)
    return {"cancelled": live.cancel_check(db, user)}


@router.patch("/{trip_id}/demo")
def set_demo(trip_id: int, body: TripDemo, user: CurrentUser, db: DbSession, live: Live) -> dict[str, Any]:
    t = _own_active(db, user.id, trip_id)
    t.demo = body.demo
    db.commit()
    live.set_demo(t)
    tj = trip_json(t)
    live.to_watchers(user.id, t, {"type": "trip", "trip": tj})
    return tj


@router.post("/{trip_id}/reroute")
def reroute(trip_id: int, body: TripReroute, user: CurrentUser, db: DbSession, live: Live) -> dict[str, Any]:
    t = _own_active(db, user.id, trip_id)
    t.geometry_json = json.dumps(body.geometry)
    t.distance_m, t.eta_min, t.safety_score = body.distance_m, body.eta_min, body.safety_score
    if body.profile:
        t.profile = body.profile
    db.commit()
    live.reroute(t)
    return trip_json(t)


@router.post("/{trip_id}/recheck")
def recheck(trip_id: int, body: LatLngIn, request: Request, user: CurrentUser, db: DbSession) -> dict[str, Any]:
    """Re-plan from the current position (called every 60 s during a trip). Suggests a new route
    only when a fresh incident report lies ahead on the current one and the new route avoids it."""
    t = _own_active(db, user.id, trip_id)
    engine = getattr(request.app.state, "router_engine", None)
    if engine is None:
        return {"safer": None, "reason": "routing unavailable"}
    now = datetime.now(UTC)
    reports = recent_reports(db, now)
    geom = json.loads(t.geometry_json)
    route_geo = RouteGeometry(np.asarray(geom))
    _, along = route_geo.locate(body.lat, body.lng)
    ahead = reports_near_route(geom, reports, now, along)
    if not ahead:
        return {"safer": None, "reason": "no new reports on your route"}
    local = nm.to_local(None)
    night, _ = nm.resolve_night_mode("auto", local)
    dest = geom[-1]
    try:
        out = engine.route((body.lat, body.lng), (dest[0], dest[1]), nm.time_bucket(local), night,
                           edge_boost(engine, reports, now))
    except RoutingError:
        return {"safer": None, "reason": "no route from here"}
    best = next(r for r in out["routes"] if r.profile == "safest")
    still = reports_near_route(best.geometry, ahead, now)
    if len(still) >= len(ahead):
        return {"safer": None, "reason": "no route avoids the report"}
    remaining_min = max(0.0, (route_geo.length_m - along) / (5000 / 60))
    return {
        "safer": {
            "profile": "safest", "geometry": best.geometry, "distance_m": best.distance_m,
            "eta_min": best.eta_min, "safety_score": best.safety_score, "segments": best.segments,
        },
        "avoided": len(ahead) - len(still),
        "extra_min": round(best.eta_min - remaining_min, 1),
    }
