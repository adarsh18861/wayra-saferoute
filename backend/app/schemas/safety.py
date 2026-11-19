from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


def _as_utc(v: datetime | None) -> datetime | None:
    """SQLite drops the zone; everything is stored in UTC, so re-attach it before serialising."""
    if v is not None and v.tzinfo is None:
        return v.replace(tzinfo=UTC)
    return v


UtcDatetime = Annotated[datetime, AfterValidator(_as_utc)]
OptUtcDatetime = Annotated[datetime | None, AfterValidator(_as_utc)]

PHONE_RE = re.compile(r"^\+?[0-9][0-9 ()\-.]{5,22}$")
MAX_CONTACTS = 5


# ---------------------------------------------------------------- contacts
def _blank_to_none(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return v or None


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    relation: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("relation", mode="before")
    @classmethod
    def _rel(cls, v: str | None) -> str | None:
        return _blank_to_none(v)

    @field_validator("email", mode="before")
    @classmethod
    def _email(cls, v: str | None) -> str | None:
        return _blank_to_none(v)

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        v = _blank_to_none(v)
        if v is not None and not PHONE_RE.match(v):
            raise ValueError("Enter a phone number with digits only, e.g. +1 312 555 0100")
        return v

    @model_validator(mode="after")
    def _reachable(self) -> ContactIn:
        if not self.phone and not self.email:
            raise ValueError("Add a phone number or an email so this contact can get your watch link")
        return self


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    relation: str | None
    phone: str | None
    email: str | None
    watch_token: str
    created_at: UtcDatetime


# ---------------------------------------------------------------- trips
class TripStart(BaseModel):
    profile: Literal["fastest", "balanced", "safest"] = "safest"
    from_name: str = Field(default="", max_length=200)
    to_name: str = Field(default="", max_length=200)
    geometry: list[list[float]] = Field(min_length=2, max_length=20_000)
    distance_m: float = Field(ge=0)
    eta_min: float = Field(ge=0)
    safety_score: int | None = Field(default=None, ge=0, le=100)
    demo: bool = False

    @field_validator("geometry")
    @classmethod
    def _geom(cls, v: list[list[float]]) -> list[list[float]]:
        for p in v:
            if len(p) != 2 or not (-90 <= p[0] <= 90) or not (-180 <= p[1] <= 180):
                raise ValueError("geometry must be [[lat, lng], ...]")
        return v


class TripReroute(BaseModel):
    profile: Literal["fastest", "balanced", "safest"] | None = None
    geometry: list[list[float]] = Field(min_length=2, max_length=20_000)
    distance_m: float = Field(ge=0)
    eta_min: float = Field(ge=0)
    safety_score: int | None = Field(default=None, ge=0, le=100)


class TripDemo(BaseModel):
    demo: bool


class TripOut(BaseModel):
    id: int
    share_token: str
    status: str
    profile: str
    from_name: str
    to_name: str
    geometry: list[list[float]]
    distance_m: float
    eta_min: float
    safety_score: int | None
    demo: bool
    started_at: UtcDatetime
    ended_at: OptUtcDatetime


class LatLngIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


# ---------------------------------------------------------------- alerts / SOS
class AlertOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int | None
    kind: str
    message: str
    source: str | None
    lat: float | None
    lng: float | None
    created_at: UtcDatetime
    resolved_at: OptUtcDatetime


class DeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    contact_name: str
    channel: str
    status: str
    detail: str | None


class SOSIn(BaseModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    source: Literal["button", "voice", "offline"] = "button"


class SOSOut(AlertOut):
    deliveries: list[DeliveryOut] = []
    duration_s: float | None = None


# ---------------------------------------------------------------- reports
REPORT_CATEGORIES = ("harassment", "poor_lighting", "suspicious", "unsafe_crowd", "followed", "other")


class ReportIn(BaseModel):
    category: Literal["harassment", "poor_lighting", "suspicious", "unsafe_crowd", "followed", "other"]
    note: str = Field(default="", max_length=300)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    note: str
    lat: float
    lng: float
    created_at: UtcDatetime
    weight: float = 1.0  # current decay factor 0..1
