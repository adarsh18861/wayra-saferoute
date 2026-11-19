from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: LatLng = Field(alias="from")
    to: LatLng
    depart_at: datetime | None = None
    night_mode: bool | Literal["auto"] = "auto"


class Segment(BaseModel):
    coords: list[list[float]]
    rel_risk: float
    length_m: float
    level: Literal["green", "amber", "red"]
    name: str | None = None  # OSM street name (or a label like "Footpath"); None without name data


class RiskMetres(BaseModel):
    green: float
    amber: float
    red: float


class Route(BaseModel):
    profile: Literal["fastest", "balanced", "safest"]
    label: str
    lambda_: float = Field(serialization_alias="lambda")
    geometry: list[list[float]]
    distance_m: float
    eta_min: float
    safety_score: int
    risk_m: RiskMetres
    segments: list[Segment]
    identical_to: list[str]


class SnappedPoint(BaseModel):
    lat: float
    lng: float
    distance_m: float


class RouteResponse(BaseModel):
    depart_at: datetime
    bucket: int
    night_mode: bool
    night_mode_source: Literal["auto", "override"]
    sunrise: datetime
    sunset: datetime
    identical_routes: bool
    routes: list[Route]
    snapped: dict[str, SnappedPoint]
    compute_ms: float
