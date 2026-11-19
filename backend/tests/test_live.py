"""Trips, SOS, notifier, watch/track pages and the WebSockets."""
from __future__ import annotations

import math
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services.live_hub import LiveHub
from app.services.notifier import (
    EmailNotifier,
    InAppNotifier,
    Message,
    Recipient,
    TwilioNotifier,
    build_notifiers,
)
from tests.test_contacts import MOM, auth

LAT0, LNG0 = 41.88, -87.63
M_LAT = 111_320.0
M_LNG = M_LAT * math.cos(math.radians(LAT0))


def pt(east_m: float, north_m: float) -> list[float]:
    return [LAT0 + north_m / M_LAT, LNG0 + east_m / M_LNG]


ROUTE = [pt(0, 0), pt(500, 0), pt(1000, 0)]
TRIP: dict[str, Any] = {"profile": "safest", "from_name": "Union Station", "to_name": "Navy Pier",
                        "geometry": ROUTE, "distance_m": 1000, "eta_min": 12, "safety_score": 81}


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


@pytest.fixture()
def clock() -> Clock:
    c = Clock()
    app.state.live.clock = c
    return c


def setup_user(client: TestClient) -> tuple[dict[str, str], str, dict[str, Any]]:
    h = auth(client)
    c = client.post("/api/contacts", json=MOM, headers=h).json()
    return h, h["Authorization"].split()[1], c


def move(ws: Any, east: float, north: float) -> dict[str, Any]:
    """Send a fix and wait until the server has processed it (before the test moves the clock)."""
    lat, lng = pt(east, north)
    ws.send_json({"type": "loc", "lat": lat, "lng": lng})
    return recv_until(ws, "progress")


def recv_until(ws: Any, kind: str, limit: int = 20) -> dict[str, Any]:
    for _ in range(limit):
        m = ws.receive_json()
        if m.get("type") == kind:
            return m
    raise AssertionError(f"no {kind} message")


# ---------------------------------------------------------------- notifier
def test_inapp_notifier_live_vs_queued() -> None:
    import asyncio

    hub = LiveHub()
    n = InAppNotifier(hub)
    to = Recipient(7, "Mom", None, None, "http://x/watch/t")
    msg = Message("sos", "SOS", {"id": 1})
    assert n.send(to, msg).status == "queued"

    async def listen() -> dict[str, Any]:
        sub = hub.subscribe("contact:7")
        assert n.send(to, msg).status == "live"
        return await asyncio.wait_for(sub.queue.get(), 1)

    assert asyncio.run(listen()) == {"type": "alert", "alert": {"id": 1}}


def test_external_notifiers_only_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    hub = LiveHub()
    assert [n.channel for n in build_notifiers(settings, hub)] == ["in_app"]
    s = settings.model_copy(update={"twilio_account_sid": "AC1", "twilio_auth_token": "t",
                                    "twilio_from_number": "+1", "smtp_host": "smtp.x", "email_from": "a@x"})
    assert [n.channel for n in build_notifiers(s, hub)] == ["in_app", "sms", "email"]


def test_twilio_skips_non_urgent_and_missing_phone(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    class Resp:
        def raise_for_status(self) -> None: ...

    monkeypatch.setattr("app.services.notifier.requests.post", lambda url, **kw: calls.append(kw) or Resp())
    tw = TwilioNotifier("AC1", "tok", "+15550000")
    with_phone = Recipient(1, "Mom", "+13125550100", None, "http://x/watch/t")
    assert tw.send(with_phone, Message("trip_started", "x", {})) is None
    assert tw.send(Recipient(1, "Mom", None, None, "u"), Message("sos", "x", {})) is None
    res = tw.send(with_phone, Message("sos", "SOS from Asha!", {}))
    assert res is not None and res.status == "sent"
    assert calls[0]["data"]["To"] == "+13125550100" and "http://x/watch/t" in calls[0]["data"]["Body"]
    assert EmailNotifier("h", 587, "", "", "a@x").send(with_phone, Message("sos", "x", {})) is None  # no email


# ---------------------------------------------------------------- trips
def test_trip_start_active_end(client: TestClient) -> None:
    h, _, c = setup_user(client)
    assert client.get("/api/trips/active", headers=h).json() is None
    t = client.post("/api/trips", json=TRIP, headers=h).json()
    assert t["status"] == "active" and t["geometry"] == ROUTE and len(t["share_token"]) >= 20
    assert client.get("/api/trips/active", headers=h).json()["id"] == t["id"]

    w = client.get(f"/api/watch/{c['watch_token']}").json()
    assert w["trip"]["id"] == t["id"] and w["user"] == {"first_name": "Asha"}
    assert w["alerts"][0]["kind"] == "trip_started" and "Union Station → Navy Pier" in w["alerts"][0]["message"]
    assert "Asha Rao" not in str(w)  # only the first name is public

    tr = client.get(f"/api/track/{t['share_token']}").json()
    assert tr["trip"]["status"] == "active"

    assert client.post(f"/api/trips/{t['id']}/end", headers=h).json()["status"] == "ended"
    assert client.get("/api/trips/active", headers=h).json() is None
    assert client.post(f"/api/trips/{t['id']}/end", headers=h).status_code == 409
    tr = client.get(f"/api/track/{t['share_token']}").json()
    assert tr["trip"]["status"] == "ended" and tr["last"] is None and tr["trail"] == []


def test_new_trip_ends_previous(client: TestClient) -> None:
    h, _, _ = setup_user(client)
    a = client.post("/api/trips", json=TRIP, headers=h).json()
    b = client.post("/api/trips", json=TRIP, headers=h).json()
    assert client.get(f"/api/track/{a['share_token']}").json()["trip"]["status"] == "ended"
    assert client.get("/api/trips/active", headers=h).json()["id"] == b["id"]


def test_trip_validation_and_ownership(client: TestClient) -> None:
    h, _, _ = setup_user(client)
    assert client.post("/api/trips", json={**TRIP, "geometry": [[1, 2]]}, headers=h).status_code == 422
    assert client.post("/api/trips", json={**TRIP, "geometry": [[100, 2], [1, 2]]}, headers=h).status_code == 422
    t = client.post("/api/trips", json=TRIP, headers=h).json()
    other = auth(client, "bea@example.com", "Bea")
    assert client.post(f"/api/trips/{t['id']}/end", headers=other).status_code == 404
    assert client.get("/api/track/not-a-token").status_code == 404
    assert client.get("/api/watch/not-a-token").status_code == 404


def test_im_safe_sends_reassurance(client: TestClient) -> None:
    h, _, c = setup_user(client)
    t = client.post("/api/trips", json=TRIP, headers=h).json()
    assert client.post(f"/api/trips/{t['id']}/safe", headers=h).json()["ok"]
    feed = client.get(f"/api/watch/{c['watch_token']}").json()["alerts"]
    assert feed[0]["kind"] == "safe" and feed[0]["message"] == "Asha says: I'm safe."


# ---------------------------------------------------------------- SOS
def test_sos_flow_and_history(client: TestClient) -> None:
    h, _, c = setup_user(client)
    r = client.post("/api/sos", json={"lat": LAT0, "lng": LNG0, "source": "voice"}, headers=h)
    assert r.status_code == 201
    sos = r.json()
    assert sos["kind"] == "sos" and sos["lat"] == LAT0 and sos["source"] == "voice"
    chans = {(d["contact_name"], d["channel"], d["status"]) for d in sos["deliveries"]}
    assert ("Mom", "in_app", "queued") in chans
    assert ("Authorities (911)", "authorities", "simulated") in chans

    # A second trigger returns the open SOS instead of spamming contacts.
    assert client.post("/api/sos", json={}, headers=h).json()["id"] == sos["id"]

    w = client.get(f"/api/watch/{c['watch_token']}").json()
    assert w["sos"]["id"] == sos["id"] and w["last"]["lat"] == LAT0

    res = client.post(f"/api/sos/{sos['id']}/resolve", headers=h).json()
    assert res["resolved_at"] is not None and res["duration_s"] is not None
    w = client.get(f"/api/watch/{c['watch_token']}").json()
    assert w["sos"] is None and w["last"] is None  # location stops being shared
    assert w["alerts"][0]["kind"] == "sos_resolved"

    hist = client.get("/api/sos", headers=h).json()
    assert len(hist) == 1 and hist[0]["id"] == sos["id"] and hist[0]["deliveries"]
    other = auth(client, "bea@example.com", "Bea")
    assert client.get("/api/sos", headers=other).json() == []
    assert client.post(f"/api/sos/{sos['id']}/resolve", headers=other).status_code == 404


def test_sos_without_contacts_still_logs(client: TestClient) -> None:
    h = auth(client)
    sos = client.post("/api/sos", json={"lat": LAT0, "lng": LNG0}, headers=h).json()
    assert [d["channel"] for d in sos["deliveries"]] == ["authorities"]


# ---------------------------------------------------------------- WebSockets
def test_ws_rejects_bad_tokens(client: TestClient) -> None:
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/ws/user?token=bad") as ws:
        ws.receive_json()
    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/ws/watch/nope") as ws:
        ws.receive_json()


def test_location_not_shared_without_trip_or_sos(client: TestClient) -> None:
    h, tok, c = setup_user(client)
    with client.websocket_connect(f"/api/ws/user?token={tok}") as me:
        me.send_json({"type": "loc", "lat": LAT0, "lng": LNG0})
        me.send_json({"type": "ping"})
        assert recv_until(me, "pong")
    assert client.get(f"/api/watch/{c['watch_token']}").json()["last"] is None


def test_live_trip_watch_deviation_check_and_alert(client: TestClient, clock: Clock) -> None:
    h, tok, c = setup_user(client)
    t = client.post("/api/trips", json=TRIP, headers=h).json()
    with client.websocket_connect(f"/api/ws/watch/{c['watch_token']}") as watch, \
            client.websocket_connect(f"/api/ws/user?token={tok}") as me:
        snap = watch.receive_json()
        assert snap["type"] == "snapshot" and snap["trip"]["id"] == t["id"]

        assert move(me, 100, 0)["remaining_m"] == pytest.approx(900, abs=2)
        loc = recv_until(watch, "loc")
        assert loc["trip_id"] == t["id"] and loc["on_route"] and loc["remaining_m"] == pytest.approx(900, abs=2)

        # 150 m off route for > 30 s -> check-in on the user's phone, "checking in" on the watch page
        move(me, 200, 150)
        clock.t += 31
        move(me, 210, 150)
        check = recv_until(me, "check")
        assert check["reason"] == "off_route" and check["seconds"] == 15
        assert recv_until(watch, "check")["reason"] == "off_route"

        # no answer within 15 s -> contacts alerted
        clock.t += 16
        move(me, 215, 150)
        alert = recv_until(watch, "alert")["alert"]
        assert alert["kind"] == "off_route" and "off the planned route" in alert["message"]
        mine = recv_until(me, "alert")
        assert mine["alert"]["kind"] == "off_route" and mine["contacts"] == 1

    tr = client.get(f"/api/track/{t['share_token']}").json()
    assert len(tr["trail"]) == 4 and tr["progress"]["on_route"] is False


def test_check_cancelled_by_user(client: TestClient, clock: Clock) -> None:
    h, tok, c = setup_user(client)
    client.post("/api/trips", json=TRIP, headers=h)
    with client.websocket_connect(f"/api/ws/user?token={tok}") as me:
        move(me, 300, 0)
        clock.t += 181
        move(me, 302, 0)
        assert recv_until(me, "check")["reason"] == "stopped"
        me.send_json({"type": "ok"})
        cleared = recv_until(me, "check_cleared")
        assert cleared["by"] == "user"
        clock.t += 20
        move(me, 302, 0)
        me.send_json({"type": "ping"})
        recv_until(me, "pong")
    kinds = [a["kind"] for a in client.get(f"/api/watch/{c['watch_token']}").json()["alerts"]]
    assert "stopped" not in kinds


def test_arrival_ends_trip_with_message(client: TestClient, clock: Clock) -> None:
    h, tok, c = setup_user(client)
    t = client.post("/api/trips", json=TRIP, headers=h).json()
    with client.websocket_connect(f"/api/ws/track/{t['share_token']}") as viewer, \
            client.websocket_connect(f"/api/ws/user?token={tok}") as me:
        assert viewer.receive_json()["type"] == "snapshot"
        move(me, 990, 5)
        alert = recv_until(viewer, "alert")["alert"]
        assert alert["kind"] == "arrived" and alert["message"] == "Asha arrived safely at Navy Pier."
        assert recv_until(viewer, "trip")["trip"]["status"] == "arrived"
    assert client.get("/api/trips/active", headers=h).json() is None


def test_sos_reaches_open_watch_page_live(client: TestClient) -> None:
    h, tok, c = setup_user(client)
    with client.websocket_connect(f"/api/ws/watch/{c['watch_token']}") as watch:
        watch.receive_json()
        sos = client.post("/api/sos", json={"lat": LAT0, "lng": LNG0}, headers=h).json()
        assert recv_until(watch, "alert")["alert"]["kind"] == "sos"
        assert any(d["status"] == "live" for d in sos["deliveries"])
        with client.websocket_connect(f"/api/ws/user?token={tok}") as me:
            me.send_json({"type": "loc", "lat": LAT0 + 0.001, "lng": LNG0})
            loc = recv_until(watch, "loc")
            assert loc["trip_id"] is None and loc["lat"] == pytest.approx(LAT0 + 0.001)


def test_demo_toggle_switches_timers(client: TestClient, clock: Clock) -> None:
    h, tok, _ = setup_user(client)
    t = client.post("/api/trips", json=TRIP, headers=h).json()
    assert client.patch(f"/api/trips/{t['id']}/demo", json={"demo": True}, headers=h).json()["demo"] is True
    with client.websocket_connect(f"/api/ws/user?token={tok}") as me:
        move(me, 200, 200)
        clock.t += 11
        move(me, 220, 200)
        assert recv_until(me, "check")["reason"] == "off_route"


def test_reroute_replaces_geometry(client: TestClient) -> None:
    h, _, _ = setup_user(client)
    t = client.post("/api/trips", json=TRIP, headers=h).json()
    new = [pt(0, 0), pt(0, 300), pt(1000, 300)]
    r = client.post(f"/api/trips/{t['id']}/reroute", json={"geometry": new, "distance_m": 1300, "eta_min": 16},
                    headers=h).json()
    assert r["geometry"] == new and r["distance_m"] == 1300
