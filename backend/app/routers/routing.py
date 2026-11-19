from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.routers.deps import CurrentUser
from app.schemas.routing import RouteRequest, RouteResponse
from app.services import night_mode as nm
from app.services.risk_service import RiskService, load_model_card
from app.services.router_engine import NIGHT_LAMBDA_FACTOR, RouterEngine, RoutingError

router = APIRouter(tags=["routing"])


def get_router_engine(request: Request) -> RouterEngine:
    engine = getattr(request.app.state, "router_engine", None)
    if engine is None:
        reason = getattr(request.app.state, "router_error", None) or "routing data not loaded"
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"Routing is unavailable: {reason}")
    return engine


def get_risk_service(request: Request) -> RiskService:
    svc = getattr(request.app.state, "risk_service", None)
    if svc is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Heatmap is unavailable: data/processed/cell_risk.parquet not loaded (run `npm run train`)")
    return svc


@router.get("/status")
def map_status(request: Request, at: datetime | None = None) -> dict[str, Any]:
    """Public map status: Chicago time, 2-hour bucket, auto night mode, and data readiness.

    The frontend uses it for the night-safe badge before any route is planned and to show a
    friendly "not ready" message instead of a raw 503."""
    local = nm.to_local(at)
    sunrise, sunset = nm.sun_times(local)
    return {
        "now": local, "bucket": nm.time_bucket(local), "night_mode": nm.is_dark(local),
        "sunrise": sunrise, "sunset": sunset,
        "routing_ready": getattr(request.app.state, "router_engine", None) is not None,
        "heatmap_ready": getattr(request.app.state, "risk_service", None) is not None,
        "model_card_ready": request.app.state.metrics_path.exists(),
    }


@router.post("/route", response_model=RouteResponse, response_model_by_alias=True)
def plan_route(
    body: RouteRequest,
    _: CurrentUser,
    engine: Annotated[RouterEngine, Depends(get_router_engine)],
) -> dict[str, Any]:
    """Fastest / Balanced / Safest walking routes for the request's 2-hour risk bucket."""
    local = nm.to_local(body.depart_at)
    bucket = nm.time_bucket(local)
    night, source = nm.resolve_night_mode(body.night_mode, local)
    sunrise, sunset = nm.sun_times(local)
    try:
        out = engine.route((body.from_.lat, body.from_.lng), (body.to.lat, body.to.lng), bucket, night)
    except RoutingError as exc:
        raise HTTPException(422, str(exc)) from None
    routes = [
        {
            "profile": r.profile, "label": r.label,
            "lambda_": r.lam * (NIGHT_LAMBDA_FACTOR if night else 1.0),
            "geometry": r.geometry, "distance_m": r.distance_m, "eta_min": r.eta_min,
            "safety_score": r.safety_score, "risk_m": r.risk_m, "segments": r.segments,
            "identical_to": r.identical_to,
        }
        for r in out["routes"]
    ]
    return {
        "depart_at": local, "bucket": bucket, "night_mode": night, "night_mode_source": source,
        "sunrise": sunrise, "sunset": sunset,
        "identical_routes": any(r["identical_to"] for r in routes),
        "routes": routes, "snapped": out["snapped"], "compute_ms": out["compute_ms"],
    }


@router.get("/heatmap")
def heatmap(
    _: CurrentUser,
    svc: Annotated[RiskService, Depends(get_risk_service)],
    bucket: int | None = Query(default=None, ge=0, le=11),
) -> dict[str, Any]:
    """H3 cell polygons (GeoJSON) with relative risk for one 2-hour bucket (default: now)."""
    if bucket is None:
        bucket = nm.time_bucket(nm.to_local(None))
    return svc.heatmap(bucket)


@router.get("/public/model-summary")
def public_model_summary(request: Request) -> dict[str, Any]:
    """Headline held-out metrics only, for the public landing page (no auth, no details)."""
    card = load_model_card(request.app.state.metrics_path)
    if card is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Model summary unavailable (run `npm run train`)")
    test = card.get("test", {})
    model, base = test.get("model", {}), test.get("baseline", {})
    split = card.get("split", {})
    return {
        "roc_auc": model.get("roc_auc"), "roc_auc_baseline": base.get("roc_auc"),
        "hit_rate_top10pct": model.get("hit_rate_top10pct"),
        "hit_rate_top10pct_baseline": base.get("hit_rate_top10pct"),
        "pr_auc": model.get("pr_auc"), "pr_auc_baseline": base.get("pr_auc"),
        "test_months": split.get("test"), "n_cells": card.get("n_cells"),
    }


@router.get("/model-card")
def model_card(_: CurrentUser, request: Request) -> dict[str, Any]:
    """Held-out metrics of the risk model (ml/reports/metrics.json)."""
    card = load_model_card(request.app.state.metrics_path)
    if card is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Model card unavailable: ml/reports/metrics.json not found (run `npm run train`)")
    return card
