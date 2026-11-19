"""Startup checklist printed by the backend (graph, edge risk, model card, heatmap, DB, frontend).

Each check is (label, ok, detail). Missing items never stop the app: the affected endpoints return
503 with the reason, and the checklist says which npm command fixes it.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI
from sqlalchemy import text

from app.core.config import settings
from app.core.db import engine


@dataclass
class Check:
    label: str
    ok: bool
    detail: str


def _marks() -> tuple[str, str]:
    """✓/✗ where the console can print them (Windows code pages may not)."""
    enc = getattr(sys.stderr, "encoding", None) or "ascii"
    try:
        "✓✗×".encode(enc)
        return "✓", "✗"
    except (UnicodeEncodeError, LookupError):
        return "OK", "!!"


def run_checks(app: FastAPI) -> list[Check]:
    data = settings.data_dir
    engine_ = getattr(app.state, "router_engine", None)
    err = getattr(app.state, "router_error", None)
    checks: list[Check] = []

    graph_files = [data / "graph" / "walk_nodes.parquet", data / "graph" / "walk_geom.npz"]
    missing_graph = [p.name for p in graph_files if not p.exists()]
    if engine_ is not None:
        names = "with street names" if engine_.has_names else "no street names (directions off: run `npm run score`)"
        checks.append(Check("Walk graph", True, f"{engine_.n_nodes:,} nodes, {engine_.n_edges:,} edges, {names}"))
    else:
        checks.append(Check("Walk graph", False, f"missing {', '.join(missing_graph)}: run `npm run score`"
                            if missing_graph else (err or "not loaded")))

    risk_files = [data / "processed" / "edge_index.parquet", data / "processed" / "edge_rel_risk.npy"]
    missing_risk = [p.name for p in risk_files if not p.exists()]
    if engine_ is not None:
        checks.append(Check("Edge risk", True, f"{engine_.rel_risk.shape[0]:,} edges x {engine_.rel_risk.shape[1]} time buckets"))
    else:
        checks.append(Check("Edge risk", False, f"missing {', '.join(missing_risk)}: run `npm run score`"
                            if missing_risk else (err or "not loaded")))

    metrics = Path(app.state.metrics_path)
    checks.append(Check("Model card", metrics.exists(),
                        metrics.name if metrics.exists() else f"{metrics} missing: run `npm run train`"))

    heat = getattr(app.state, "risk_service", None) is not None
    checks.append(Check("Heatmap", heat, "cell_risk.parquet" if heat else "cell_risk.parquet missing: run `npm run train`"))

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            users = conn.execute(text("SELECT COUNT(*) FROM users")).scalar_one()
        checks.append(Check("Database", True, f"{engine.url.render_as_string(hide_password=True)} ({users} users)"))
    except Exception as exc:  # noqa: BLE001 - any DB failure is reported, not raised
        checks.append(Check("Database", False, f"{type(exc).__name__}: {exc}"))

    if settings.serve_frontend:
        index = settings.frontend_dist / "index.html"
        checks.append(Check("Frontend build", index.exists(),
                            str(settings.frontend_dist) if index.exists() else "frontend/dist missing: run `npm run demo`"))
    return checks


def format_checklist(checks: list[Check]) -> str:
    ok_mark, bad_mark = _marks()
    width = max(len(c.label) for c in checks)
    lines = ["", "WAYRA startup check"]
    for c in checks:
        lines.append(f"  [{ok_mark if c.ok else bad_mark}] {c.label:<{width}}  {c.detail}")
    bad = [c.label for c in checks if not c.ok]
    lines.append("  All systems ready." if not bad else f"  WARNING: {', '.join(bad)} not ready; related features are disabled.")
    lines.append("")
    return "\n".join(lines)
