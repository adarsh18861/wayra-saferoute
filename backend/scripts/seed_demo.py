"""Create or reset the demo account and print the contacts' watch links.

Usage (from backend/): .venv\\Scripts\\python.exe scripts\\seed_demo.py [--base-url http://localhost:8080]
npm: `npm run seed:demo`. The default base URL is the `npm run demo` server; use
--base-url http://localhost:5173 with `npm run dev`.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.core.db import SessionLocal, init_db  # noqa: E402
from app.models.safety import Contact  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.demo_seed import DEMO_EMAIL, DEMO_PASSWORD, seed_demo  # noqa: E402

DEMO_BASE_URL = "http://localhost:8080"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base-url", default=DEMO_BASE_URL, help=f"web app URL for the links (default {DEMO_BASE_URL})")
    ap.add_argument("--print-only", action="store_true", help="only print the existing demo links (no reset)")
    args = ap.parse_args(argv)
    base = args.base_url.rstrip("/")
    init_db()
    if args.print_only:
        with SessionLocal() as db:
            user = db.scalar(select(User).where(User.email == DEMO_EMAIL))
            if user is None:
                print("  Demo account: not created yet. Stop this (Ctrl+C), run `npm run seed:demo`, then `npm run demo` again.")
                return 0
            print(f"  Demo login:    {DEMO_EMAIL} / {DEMO_PASSWORD}")
            for c in db.scalars(select(Contact).where(Contact.user_id == user.id).order_by(Contact.id)):
                print(f"  Watch link:    {c.name:<16} {base}/watch/{c.watch_token}")
        return 0
    with SessionLocal() as db:
        res = seed_demo(db)
        print(f"\nDemo account {'created' if res.created else 'reset'}:")
        print(f"  Sign in at {base}/login")
        print(f"  Email     {DEMO_EMAIL}")
        print(f"  Password  {DEMO_PASSWORD}")
        print("\nTrusted contacts' private watch links (open in the right-hand window):")
        for c in res.contacts:
            print(f"  {c.name:<16} {base}/watch/{c.watch_token}")
        print("\nLinks stay the same on every rerun. Restart the backend if it was running.\n")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # "Priya – friend" on Windows consoles
    raise SystemExit(main())
