from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, status

from app.models import IncidentReport
from app.routers.deps import CurrentUser, DbSession
from app.schemas.safety import ReportIn, ReportOut
from app.services.incidents import decay_weight
from app.services.reports_store import recent_reports

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("", status_code=status.HTTP_201_CREATED)
def report(body: ReportIn, user: CurrentUser, db: DbSession) -> dict[str, Any]:
    """'Report unsafe spot': raises risk on streets within 150 m for the next 2 hours."""
    r = IncidentReport(user_id=user.id, **body.model_dump())
    db.add(r)
    db.commit()
    db.refresh(r)
    return ReportOut.model_validate(r).model_dump(mode="json")


@router.get("")
def active_reports(_: CurrentUser, db: DbSession) -> list[dict[str, Any]]:
    now = datetime.now(UTC)
    out = []
    for r in recent_reports(db, now):
        d = ReportOut.model_validate(r).model_dump(mode="json")
        d["weight"] = round(decay_weight(r.created_at, now), 3)
        if d["weight"] > 0:
            out.append(d)
    return out
