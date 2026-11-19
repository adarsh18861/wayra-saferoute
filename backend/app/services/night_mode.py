"""Night-safe mode: Chicago local time, 2-hour risk buckets and astral sunset/sunrise."""
from __future__ import annotations

from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from astral import LocationInfo
from astral.sun import sun

CHICAGO_TZ = ZoneInfo("America/Chicago")
CHICAGO = LocationInfo("Chicago", "USA", "America/Chicago", 41.8781, -87.6298)

NightSetting = bool | Literal["auto"] | None


def to_local(dt: datetime | None) -> datetime:
    """Request time -> Chicago local time. None = now; naive times are taken as Chicago local."""
    if dt is None:
        return datetime.now(CHICAGO_TZ)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=CHICAGO_TZ)
    return dt.astimezone(CHICAGO_TZ)


def time_bucket(local: datetime) -> int:
    """2-hour bucket 0..11 (bucket b = hours 2b..2b+1), same as the risk model."""
    return local.hour // 2


def sun_times(local: datetime) -> tuple[datetime, datetime]:
    """(sunrise, sunset) in Chicago local time for the local date."""
    s = sun(CHICAGO.observer, date=local.date(), tzinfo=CHICAGO_TZ)
    return s["sunrise"], s["sunset"]


def is_dark(local: datetime) -> bool:
    sunrise, sunset = sun_times(local)
    return local < sunrise or local >= sunset


def resolve_night_mode(setting: NightSetting, local: datetime) -> tuple[bool, str]:
    """Return (night_mode_on, source) where source is 'auto' or 'override'."""
    if isinstance(setting, bool):
        return setting, "override"
    return is_dark(local), "auto"
