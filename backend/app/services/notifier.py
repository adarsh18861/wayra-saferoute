"""Alert delivery to trusted contacts.

Trusted contacts are not app users. Each has a personal secret watch link (/watch/:token); the
default InAppNotifier pushes the alert to that page live over WebSocket (or it shows up in the
page's feed the next time the contact opens it). TwilioNotifier (SMS) and EmailNotifier are
minimal stubs that switch on only when their env vars are set, and only for urgent alerts. They
have not been exercised against the live services.
"""
from __future__ import annotations

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Any, Protocol

import requests

from app.core.config import Settings
from app.services.live_hub import LiveHub

logger = logging.getLogger("wayra.notifier")

# Kinds worth an SMS/email; the rest (trip started/ended) stay in-app only.
URGENT_KINDS = {"sos", "off_route", "stopped", "arrived", "safe", "sos_resolved"}


@dataclass(frozen=True)
class Recipient:
    contact_id: int
    name: str
    phone: str | None
    email: str | None
    watch_url: str


@dataclass(frozen=True)
class Message:
    kind: str
    text: str
    payload: dict[str, Any]  # the alert as JSON (what the watch page renders)


@dataclass(frozen=True)
class DeliveryResult:
    channel: str
    status: str  # live | queued | sent | failed
    detail: str | None = None


class Notifier(Protocol):
    channel: str

    def send(self, to: Recipient, msg: Message) -> DeliveryResult | None:
        """Deliver msg to one contact. None = this notifier doesn't handle it (skipped)."""
        ...


class InAppNotifier:
    channel = "in_app"

    def __init__(self, hub: LiveHub) -> None:
        self.hub = hub

    def send(self, to: Recipient, msg: Message) -> DeliveryResult:
        listening = self.hub.publish(f"contact:{to.contact_id}", {"type": "alert", "alert": msg.payload})
        if listening:
            return DeliveryResult(self.channel, "live", "Shown live on the watch page")
        return DeliveryResult(self.channel, "queued", "Waiting in the watch-page feed")


class TwilioNotifier:
    channel = "sms"

    def __init__(self, sid: str, token: str, from_number: str) -> None:
        self.sid, self.token, self.from_number = sid, token, from_number

    def send(self, to: Recipient, msg: Message) -> DeliveryResult | None:
        if msg.kind not in URGENT_KINDS or not to.phone:
            return None
        body = f"WAYRA: {msg.text} Live: {to.watch_url}"
        try:
            r = requests.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json",
                data={"To": to.phone, "From": self.from_number, "Body": body[:1500]},
                auth=(self.sid, self.token), timeout=8,
            )
            r.raise_for_status()
            return DeliveryResult(self.channel, "sent")
        except requests.RequestException as exc:
            logger.warning("Twilio send failed: %s", exc)
            return DeliveryResult(self.channel, "failed", str(exc)[:300])


class EmailNotifier:
    channel = "email"

    def __init__(self, host: str, port: int, user: str, password: str, sender: str) -> None:
        self.host, self.port, self.user, self.password, self.sender = host, port, user, password, sender

    def send(self, to: Recipient, msg: Message) -> DeliveryResult | None:
        if msg.kind not in URGENT_KINDS or not to.email:
            return None
        em = EmailMessage()
        em["From"], em["To"] = self.sender, to.email
        em["Subject"] = "WAYRA SOS" if msg.kind == "sos" else "WAYRA trip alert"
        em.set_content(f"{msg.text}\n\nFollow live: {to.watch_url}\n\nSent by WAYRA – SafeRoute.")
        try:
            with smtplib.SMTP(self.host, self.port, timeout=8) as s:
                s.starttls()
                if self.user:
                    s.login(self.user, self.password)
                s.send_message(em)
            return DeliveryResult(self.channel, "sent")
        except (OSError, smtplib.SMTPException) as exc:
            logger.warning("Email send failed: %s", exc)
            return DeliveryResult(self.channel, "failed", str(exc)[:300])


def build_notifiers(settings: Settings, hub: LiveHub) -> list[Notifier]:
    """InAppNotifier always; Twilio / Email only when fully configured in .env."""
    out: list[Notifier] = [InAppNotifier(hub)]
    if settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number:
        out.append(TwilioNotifier(settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_from_number))
    if settings.smtp_host and settings.email_from:
        out.append(EmailNotifier(settings.smtp_host, settings.smtp_port, settings.smtp_user,
                                 settings.smtp_password, settings.email_from))
    return out
