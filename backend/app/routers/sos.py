from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.models import Alert, Delivery
from app.routers.deps import CurrentUser, DbSession
from app.routers.live_deps import Live
from app.schemas.safety import AlertOut, DeliveryOut, SOSIn, SOSOut
from app.services.live_service import first_name

router = APIRouter(tags=["sos"])


def _sos_out(db: DbSession, a: Alert) -> dict[str, Any]:
    dels = db.scalars(select(Delivery).where(Delivery.alert_id == a.id).order_by(Delivery.id)).all()
    out = SOSOut.model_validate(a).model_dump(mode="json")
    out["deliveries"] = [DeliveryOut.model_validate(d).model_dump(mode="json") for d in dels]
    if a.resolved_at is not None:
        start = a.created_at if a.created_at.tzinfo else a.created_at.replace(tzinfo=UTC)
        end = a.resolved_at if a.resolved_at.tzinfo else a.resolved_at.replace(tzinfo=UTC)
        out["duration_s"] = round((end - start).total_seconds(), 1)
    return out


@router.post("/sos", status_code=status.HTTP_201_CREATED)
def trigger_sos(body: SOSIn, user: CurrentUser, db: DbSession, live: Live) -> dict[str, Any]:
    """Alert every trusted contact with the user's location. One open SOS at a time:
    a second trigger while one is open returns the open one (with a fresh location)."""
    if body.lat is not None and body.lng is not None:
        live.handle_location(db, user, body.lat, body.lng)
    open_sos = live.active_sos(db, user.id)
    if open_sos is not None:
        return _sos_out(db, open_sos)
    trip = live.active_trip(db, user.id)
    how = {"voice": " (voice-activated)", "offline": " (sent by SMS while offline)"}.get(body.source, "")
    text = f"SOS from {first_name(user)}{how}! Live location is on your WAYRA watch page. If you can't reach them, call 911."
    alert = live.dispatch(db, user, "sos", text, trip=trip, lat=body.lat, lng=body.lng, source=body.source)
    return _sos_out(db, alert)


@router.post("/sos/{alert_id}/resolve")
def resolve_sos(alert_id: int, user: CurrentUser, db: DbSession, live: Live) -> dict[str, Any]:
    a = db.get(Alert, alert_id)
    if a is None or a.user_id != user.id or a.kind != "sos":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "SOS not found")
    if a.resolved_at is None:
        a.resolved_at = datetime.now(UTC)
        db.commit()
        live.dispatch(db, user, "sos_resolved", f"{first_name(user)} is safe now and closed the SOS.",
                      trip=live.active_trip(db, user.id), source="button")
    return _sos_out(db, a)


@router.get("/sos")
def sos_history(user: CurrentUser, db: DbSession) -> list[dict[str, Any]]:
    rows = db.scalars(select(Alert).where(Alert.user_id == user.id, Alert.kind == "sos")
                      .order_by(Alert.id.desc()).limit(100)).all()
    return [_sos_out(db, a) for a in rows]


@router.get("/alerts", response_model=list[AlertOut])
def my_alerts(user: CurrentUser, db: DbSession) -> list[Alert]:
    """The user's own feed: what their contacts were sent recently."""
    return list(db.scalars(select(Alert).where(Alert.user_id == user.id).order_by(Alert.id.desc()).limit(50)))
