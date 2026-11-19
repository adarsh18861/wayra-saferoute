"""Phase 6-7 safety tables: trusted contacts, trips, alerts (SOS + trip events), deliveries, reports."""
from __future__ import annotations

import secrets
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


def new_token() -> str:
    """Unguessable URL token (128 bits) for watch and track links."""
    return secrets.token_urlsafe(16)


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    relation: Mapped[str | None] = mapped_column(String(50), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    watch_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, default=new_token)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    share_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, default=new_token)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | ended | arrived
    profile: Mapped[str] = mapped_column(String(16), default="safest")
    from_name: Mapped[str] = mapped_column(String(200), default="")
    to_name: Mapped[str] = mapped_column(String(200), default="")
    geometry_json: Mapped[str] = mapped_column(Text)  # [[lat, lng], ...]
    distance_m: Mapped[float] = mapped_column(Float, default=0.0)
    eta_min: Mapped[float] = mapped_column(Float, default=0.0)
    safety_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    demo: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Alert(Base):
    """Everything contacts see in their feed: trip events, deviation alerts and SOS."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id", ondelete="SET NULL"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(24))
    message: Mapped[str] = mapped_column(String(500))
    source: Mapped[str | None] = mapped_column(String(24), nullable=True)  # button | voice | auto | offline
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Delivery(Base):
    """One notifier attempt for one alert and one contact (the SOS log shows these)."""

    __tablename__ = "deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    alert_id: Mapped[int] = mapped_column(ForeignKey("alerts.id", ondelete="CASCADE"), index=True)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"), nullable=True)
    contact_name: Mapped[str] = mapped_column(String(100), default="")
    channel: Mapped[str] = mapped_column(String(16))  # in_app | sms | email
    status: Mapped[str] = mapped_column(String(16))  # live | queued | sent | failed
    detail: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class IncidentReport(Base):
    __tablename__ = "incident_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(32))
    note: Mapped[str] = mapped_column(String(300), default="")
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
