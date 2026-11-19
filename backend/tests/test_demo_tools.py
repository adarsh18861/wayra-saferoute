"""Phase 8 demo tooling: demo seed, startup checklist, production frontend serving."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import main as main_mod
from app import models  # noqa: F401
from app.core.config import settings
from app.core.db import Base
from app.core.security import hash_password, verify_password
from app.core.startup_check import Check, format_checklist, run_checks
from app.models.safety import Alert, Contact, IncidentReport, Trip
from app.models.user import User
from app.services.demo_seed import DEMO_EMAIL, DEMO_PASSWORD, seed_demo


@pytest.fixture()
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine, expire_on_commit=False)()
    yield s
    s.close()
    engine.dispose()


def test_seed_creates_then_resets_idempotently(session) -> None:
    first = seed_demo(session)
    assert first.created and first.user.email == DEMO_EMAIL
    assert [c.name for c in first.contacts] == ["Mom", "Priya – friend"]
    tokens = [c.watch_token for c in first.contacts]

    # Simulate a used demo: changed password, extra contact, active trip, SOS, report.
    u = first.user
    u.hashed_password = hash_password("something-else")
    session.add_all([
        Contact(user_id=u.id, name="Old contact", phone="+1 555 000 0000"),
        Trip(user_id=u.id, geometry_json="[]", status="active"),
        Alert(user_id=u.id, kind="sos", message="SOS"),
        IncidentReport(user_id=u.id, category="followed", lat=41.88, lng=-87.63),
    ])
    session.commit()

    second = seed_demo(session)
    assert not second.created
    assert [c.watch_token for c in second.contacts] == tokens  # links stay valid
    assert session.scalar(select(func.count()).select_from(User)) == 1
    assert session.scalar(select(func.count()).select_from(Contact)) == 2
    assert session.scalar(select(func.count()).select_from(Alert)) == 0
    assert session.scalar(select(func.count()).select_from(IncidentReport)) == 0
    assert session.scalar(select(Trip.status)) == "ended"
    assert verify_password(DEMO_PASSWORD, second.user.hashed_password)


def test_startup_checklist_reports_missing_data(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    app = FastAPI()
    app.state.router_engine = None
    app.state.router_error = "missing files"
    app.state.risk_service = None
    app.state.metrics_path = tmp_path / "metrics.json"
    checks = {c.label: c for c in run_checks(app)}
    assert not checks["Walk graph"].ok and "npm run score" in checks["Walk graph"].detail
    assert not checks["Edge risk"].ok and not checks["Model card"].ok
    assert checks["Database"].ok
    text = format_checklist(list(checks.values()))
    assert "WARNING" in text and "Walk graph" in text
    assert "All systems ready" in format_checklist([Check("Database", True, "ok")])


def test_frontend_serving_spa_fallback(tmp_path, monkeypatch) -> None:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (tmp_path / "sw.js").write_text("// sw", encoding="utf-8")
    (tmp_path / "assets" / "a.js").write_text("x", encoding="utf-8")
    monkeypatch.setattr(settings, "frontend_dist", tmp_path)
    assert Path(main_mod._serve_frontend("sw.js").path).name == "sw.js"
    assert main_mod._serve_frontend("sw.js").headers["cache-control"] == "no-cache"
    assert "immutable" in main_mod._serve_frontend("assets/a.js").headers["cache-control"]
    for client_route in ("", "app", "watch/abc123", "../../etc/passwd"):
        assert Path(main_mod._serve_frontend(client_route).path).name == "index.html"
    with pytest.raises(HTTPException) as exc:
        main_mod._serve_frontend("api/unknown")
    assert exc.value.status_code == 404
