import logging
import sys
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.core.config import settings
from app.core.db import init_db
from app.core.startup_check import format_checklist, run_checks
from app.routers import auth, contacts, geocode, health, public_live, reports, routing, sos, trips, ws
from app.services.live_service import LiveService
from app.services.risk_service import RiskService
from app.services.router_engine import RouterEngine


logger = logging.getLogger("wayra")
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")


def load_routing_data(app: FastAPI) -> None:
    """Load the walk graph + edge risk and the cell heatmap. Missing data only disables those endpoints."""
    t0 = time.perf_counter()
    try:
        engine = RouterEngine.from_data_dir(settings.data_dir)
        engine.edge_mid_tree()  # built now so the first incident-aware route request stays fast
        app.state.router_engine = engine
        logger.info("Routing graph loaded: %s nodes, %s edges in %.1fs",
                    f"{engine.n_nodes:,}", f"{engine.n_edges:,}", time.perf_counter() - t0)
    except (FileNotFoundError, ValueError) as exc:
        app.state.router_error = str(exc)
        logger.warning("Routing disabled: %s", exc)
    cell_risk = settings.data_dir / "processed" / "cell_risk.parquet"
    if cell_risk.exists():
        app.state.risk_service = RiskService.from_file(cell_risk)
    else:
        logger.warning("Heatmap disabled: %s missing (run `npm run train`)", cell_risk)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if settings.jwt_secret.startswith("change-me"):
        logger.warning("JWT_SECRET is a placeholder; set a long random value in .env")
    init_db()
    if settings.load_routing_data:
        load_routing_data(app)
    checks = run_checks(app)
    print(format_checklist(checks), file=sys.stderr, flush=True)
    if not all(c.ok for c in checks):
        logger.warning("Startup check: %s not ready", ", ".join(c.label for c in checks if not c.ok))
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.state.router_engine = None
app.state.router_error = None
app.state.risk_service = None
app.state.metrics_path = settings.metrics_path
app.state.live = LiveService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(geocode.router, prefix="/api")
app.include_router(routing.router, prefix="/api")
for r in (contacts.router, trips.router, sos.router, reports.router, public_live.router, ws.router):
    app.include_router(r, prefix="/api")


# ---------------------------------------------------------------- production frontend (npm run demo)
# Registered after the API routers so /api/* always wins. Real files are served from frontend/dist;
# every other path gets index.html (client-side routes such as /app or /watch/:token).
NO_CACHE = {"index.html", "sw.js", "registerSW.js", "manifest.webmanifest"}


def _serve_frontend(path: str) -> FileResponse:
    dist = settings.frontend_dist.resolve()
    if path.startswith("api/") or path == "api":
        raise HTTPException(status_code=404, detail="Not Found")
    target = (dist / path).resolve() if path else dist / "index.html"
    if not target.is_file() or not target.is_relative_to(dist):
        target = dist / "index.html"
    if not target.is_file():
        raise HTTPException(status_code=503, detail="Frontend build missing: run `npm run demo`")
    name = Path(target).name
    headers = {"Cache-Control": "no-cache"} if name in NO_CACHE else (
        {"Cache-Control": "public, max-age=31536000, immutable"} if "/assets/" in target.as_posix() else {})
    return FileResponse(target, headers=headers)


if settings.serve_frontend:
    app.add_api_route("/{path:path}", _serve_frontend, methods=["GET", "HEAD"], include_in_schema=False)
