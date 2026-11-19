from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import IncidentReport
from app.services.incidents import DECAY_S


def recent_reports(db: Session, now: datetime | None = None) -> list[IncidentReport]:
    """Reports still inside the 2 h decay window."""
    now = now or datetime.now(UTC)
    since = now - timedelta(seconds=DECAY_S)
    return list(db.scalars(select(IncidentReport).where(IncidentReport.created_at >= since)
                           .order_by(IncidentReport.created_at.desc()).limit(500)))
