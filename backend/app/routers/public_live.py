"""Public, token-protected pages for people who are not app users (no login)."""
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.models import Contact, Trip
from app.routers.deps import DbSession
from app.routers.live_deps import Live
from app.services.snapshots import track_snapshot, watch_snapshot

router = APIRouter(tags=["public-live"])

NOT_FOUND = "This link is not valid any more. Ask for a new one."


@router.get("/watch/{token}")
def watch(token: str, db: DbSession, live: Live) -> dict[str, Any]:
    c = db.scalar(select(Contact).where(Contact.watch_token == token))
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return watch_snapshot(db, live, c)


@router.get("/track/{token}")
def track(token: str, db: DbSession, live: Live) -> dict[str, Any]:
    t = db.scalar(select(Trip).where(Trip.share_token == token))
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
    return track_snapshot(db, live, t)
