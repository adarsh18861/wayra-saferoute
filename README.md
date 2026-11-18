# WAYRA – SafeRoute

*Navigate Safely, Live Fearlessly.* A women-safety navigation web app that finds the **safest** walking route, not just the fastest, using historical crime data plus environmental signals.

**Pilot: Chicago (data-available city).** See [CLAUDE.md](CLAUDE.md) for the full project spec.

> Status: **Phase 0.5: auth and search UI.** Users can register and sign in (JWT). The map page needs sign-in and has a From/To search panel with Chicago-only place autocomplete, "Use my location" and map markers. "Find safe route" is a placeholder until the routing phase.

## Features so far

- **Accounts:** `POST /api/auth/register`, `POST /api/auth/login` (both return a JWT), and `GET /api/auth/me`. Users are stored in SQLite (`backend/wayra.db`, gitignored) through SQLAlchemy, with bcrypt-hashed passwords.
- **Login and Register pages** with client-side validation and the server's error messages (duplicate email, wrong password, and so on). The token is kept in `localStorage`, and the header shows your name with a **Log out** button.
- **Place search:** `GET /api/geocode/search?q=…` (sign-in required) proxies OpenStreetMap Nominatim with an identifying User-Agent. Results are limited to the City of Chicago bounding box, calls are throttled to 1 per second, and results are cached. The frontend waits 400 ms after typing stops before it searches.

## Configuration

`.env` (created by `npm run setup` from [.env.example](.env.example)):

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Key that signs login tokens. `setup` generates a random one. If you create `.env` by hand, set a long random string: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `JWT_EXPIRE_MINUTES` | Token lifetime (default 1440 = 24 h) |
| `DATABASE_URL` | Defaults to SQLite `sqlite:///./wayra.db`, relative to `backend/` |
| `NOMINATIM_USER_AGENT` | User-Agent sent to Nominatim. Add contact details before deploying publicly. |

## Prerequisites (Windows)

| Tool | Version | Install |
|---|---|---|
| Python | **3.11** (official python.org build) | `winget install -e --id Python.Python.3.11 --scope user` |
| Node.js | 20+ (tested on 22) | `winget install -e --id OpenJS.NodeJS.LTS` |
| Git | any recent | `winget install -e --id Git.Git` |

> ⚠️ Use the official CPython from python.org/winget. MSYS2/MinGW Python (e.g. `C:\msys64\ucrt64\bin\python.exe`) cannot install the pandas, pyarrow, lightgbm or h3 wheels.

## Setup

From the repo root in PowerShell:

```powershell
npm install        # installs concurrently (root dev tool)
npm run setup      # creates backend\.venv, installs Python + frontend deps, copies .env.example -> .env
```

`npm run setup` runs [scripts/setup.ps1](scripts/setup.ps1). To do it by hand instead:

```powershell
# Python 3.11 venv for the backend
& "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# Frontend
npm --prefix frontend install

# Environment
Copy-Item .env.example .env
```

## Run

```powershell
npm run dev            # backend (http://localhost:8000) + frontend (http://localhost:5173) together
npm run dev:backend    # FastAPI only, with auto-reload
npm run dev:frontend   # Vite only
```

Open http://localhost:5173. You'll see the sign-in page; create an account to reach the map. The Vite dev server proxies `/api/*` to the backend, so these should both return `{"status":"ok"}`:

```powershell
Invoke-RestMethod http://localhost:8000/api/health
Invoke-RestMethod http://localhost:5173/api/health
```

API docs: http://localhost:8000/docs

## Test

```powershell
npm test               # backend pytest + frontend TypeScript typecheck
npm run test:backend
npm run test:frontend
```

## Repo layout

```
backend/    FastAPI app (app/), pytest tests (tests/), requirements.txt, .venv (gitignored)
frontend/   React + Vite + TypeScript + Tailwind + React-Leaflet
ml/         data and ML pipeline scripts (added in later phases)
data/       downloaded and processed data (gitignored)
scripts/    PowerShell helper scripts
```

## Troubleshooting

- **`running scripts is disabled on this system`** when activating the venv: you don't need to activate it, because the npm scripts call `backend\.venv\Scripts\python.exe` directly. If you do want to activate it, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **"Use my location" says you're outside the pilot area**: routing only covers Chicago. Type a Chicago address instead.
- **Port already in use**: if Vite says `Port 5173 is in use, trying another one...`, an earlier `npm run dev` is probably still running. Close that terminal, or use the port Vite prints. Otherwise stop the other process on 8000/5173, or change `--port` in the root `package.json` and the proxy target in `frontend/vite.config.ts`.

## License

See [LICENSE](LICENSE).
