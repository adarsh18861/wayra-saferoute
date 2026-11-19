"""WebSockets.

/api/ws/user?token=<JWT>   the signed-in user's app: sends {type:"loc", lat, lng, acc?, sim?} and
                           {type:"ok"} (answers a check-in); receives progress / check / alert / trip.
/api/ws/watch/{token}      a trusted contact's watch page (receive only).
/api/ws/track/{token}      a one-off trip link viewer (receive only).

The first message to a viewer is {type:"snapshot", ...} with the same body as GET /api/watch|track.
"""
from __future__ import annotations

import asyncio
import contextlib
import math
from collections.abc import Coroutine
from typing import Annotated, Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.db import get_session_factory
from app.core.security import decode_access_token
from app.models import Contact, Trip, User
from app.services.live_hub import Subscription
from app.services.live_service import LiveService
from app.services.snapshots import track_snapshot, watch_snapshot

router = APIRouter(tags=["ws"])

Factory = Annotated[sessionmaker[Session], Depends(get_session_factory)]
UNAUTHORIZED = 4401
NOT_FOUND = 4404


def _live(ws: WebSocket) -> LiveService:
    return ws.app.state.live


async def _pump(ws: WebSocket, sub: Subscription) -> None:
    while True:
        await ws.send_json(await sub.queue.get())


async def _drain(ws: WebSocket) -> None:
    while True:
        await ws.receive_text()  # viewers only send keep-alive pings


async def _run(*coros: Coroutine[Any, Any, None]) -> None:
    """Run until the first coroutine finishes (usually a disconnect), then cancel the rest."""
    tasks = [asyncio.ensure_future(c) for c in coros]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(BaseException):
                await t


def _num(v: Any, lo: float, hi: float) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float) or not math.isfinite(v) or not lo <= v <= hi:
        return None
    return float(v)


@router.websocket("/ws/user")
async def ws_user(ws: WebSocket, factory: Factory, token: str = "") -> None:
    sub_id = decode_access_token(token)
    if sub_id is None or not sub_id.isdigit():
        await ws.close(code=UNAUTHORIZED)
        return
    user_id = int(sub_id)
    with factory() as db:
        if db.get(User, user_id) is None:
            await ws.close(code=UNAUTHORIZED)
            return
    await ws.accept()
    live = _live(ws)
    live.ensure_ticker(factory)
    sub = live.hub.subscribe(f"self:{user_id}")

    async def receive() -> None:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            kind = msg.get("type")
            with factory() as db:
                user = db.get(User, user_id)
                if user is None:
                    return
                if kind == "loc":
                    lat, lng = _num(msg.get("lat"), -90, 90), _num(msg.get("lng"), -180, 180)
                    if lat is None or lng is None:
                        continue
                    acc = _num(msg.get("acc"), 0, 100_000)
                    live.handle_location(db, user, lat, lng, acc, bool(msg.get("sim")))
                elif kind == "ok":
                    live.cancel_check(db, user)
                elif kind == "ping":
                    await ws.send_json({"type": "pong"})
            live.tick_all()

    try:
        await _run(receive(), _pump(ws, sub))
    except WebSocketDisconnect:
        pass
    finally:
        live.hub.unsubscribe(sub)


@router.websocket("/ws/watch/{token}")
async def ws_watch(ws: WebSocket, token: str, factory: Factory) -> None:
    live = _live(ws)
    with factory() as db:
        c = db.scalar(select(Contact).where(Contact.watch_token == token))
        if c is None:
            await ws.close(code=NOT_FOUND)
            return
        await ws.accept()
        sub = live.hub.subscribe(f"user:{c.user_id}", f"contact:{c.id}")
        snap = watch_snapshot(db, live, c)
    try:
        await ws.send_json({"type": "snapshot", **snap})
        await _run(_pump(ws, sub), _drain(ws))
    except WebSocketDisconnect:
        pass
    finally:
        live.hub.unsubscribe(sub)


@router.websocket("/ws/track/{token}")
async def ws_track(ws: WebSocket, token: str, factory: Factory) -> None:
    live = _live(ws)
    with factory() as db:
        t = db.scalar(select(Trip).where(Trip.share_token == token))
        if t is None:
            await ws.close(code=NOT_FOUND)
            return
        await ws.accept()
        sub = live.hub.subscribe(f"trip:{t.share_token}")
        snap = track_snapshot(db, live, t)
    try:
        await ws.send_json({"type": "snapshot", **snap})
        await _run(_pump(ws, sub), _drain(ws))
    except WebSocketDisconnect:
        pass
    finally:
        live.hub.unsubscribe(sub)
