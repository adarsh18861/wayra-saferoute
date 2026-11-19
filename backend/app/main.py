import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import init_db
from app.routers import auth, geocode, health, routing
from app.services.risk_service import RiskService
from app.services.router_engine import RouterEngine


logger = logging.getLogger("wayra")
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")


def load_routing_data(app: FastAPI) -> None:
    """Load the walk graph + edge risk and the cell heatmap. Missing data only disables those endpoints."""
    t0 = time.perf_counter()
    try:
        engine = RouterEngine.from_data_dir(settings.data_dir)
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
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.state.router_engine = None
app.state.router_error = None
app.state.risk_service = None
app.state.metrics_path = settings.metrics_path

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
