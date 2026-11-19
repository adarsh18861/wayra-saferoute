"""Phase 4 check on the real Chicago data: load time + Fastest/Balanced/Safest for demo trips.

Usage (from backend/): .venv\\Scripts\\python.exe scripts\\verify_routes.py
"""
from __future__ import annotations

import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.services import night_mode as nm  # noqa: E402
from app.services.router_engine import RouterEngine  # noqa: E402

TRIPS = [
    ("Union Station -> Navy Pier", (41.8786, -87.6403), (41.8917, -87.6086)),
    ("UChicago -> 63rd St (Green)", (41.7886, -87.5987), (41.7804, -87.6162)),
]
TIMES = ["14:00", "23:00"]


def main() -> int:
    t0 = time.perf_counter()
    engine = RouterEngine.from_data_dir(settings.data_dir)
    print(f"Graph load: {time.perf_counter() - t0:.1f}s ({engine.n_nodes:,} nodes, {engine.n_edges:,} edges)\n")
    date = datetime.now(nm.CHICAGO_TZ).date()
    print(f"{'trip':<29} {'time':<6} {'night':<6} {'route':<9} {'dist m':>7} {'ETA min':>8} {'score':>6} "
          f"{'red m':>6} {'ms':>6}")
    ok = True
    for name, a, b in TRIPS:
        for hhmm in TIMES:
            h, m = map(int, hhmm.split(":"))
            local = datetime(date.year, date.month, date.day, h, m, tzinfo=nm.CHICAGO_TZ)
            night, _ = nm.resolve_night_mode("auto", local)
            out = engine.route(a, b, nm.time_bucket(local), night)
            for r in out["routes"]:
                same = f" (= {', '.join(r.identical_to)})" if r.identical_to else ""
                print(f"{name:<29} {hhmm:<6} {str(night):<6} {r.label:<9} {r.distance_m:7.0f} {r.eta_min:8.1f} "
                      f"{r.safety_score:6d} {r.risk_m['red']:6.0f} {out['compute_ms']:6.0f}{same}")
            fast, safe = out["routes"][0], out["routes"][2]
            if night and safe.safety_score <= fast.safety_score:
                ok = False
                print("  !! Safest is not safer than Fastest at night")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
