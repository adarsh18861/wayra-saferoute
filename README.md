# WAYRA – SafeRoute

*Navigate Safely, Live Fearlessly.* A women-safety navigation web app that finds the **safest** walking route, not just the fastest, using historical crime data plus environmental signals.

**Pilot: Chicago (data-available city).** See [CLAUDE.md](CLAUDE.md) for the full project spec.

> Status: **Phase 0 – scaffold.** FastAPI backend with a health check, plus a React/Vite frontend showing a full-screen map of Chicago.

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

Open http://localhost:5173. The Vite dev server proxies `/api/*` to the backend, so these should both return `{"status":"ok"}`:

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
- **Port already in use**: stop the other process on 8000/5173, or change `--port` in the root `package.json` and the proxy target in `frontend/vite.config.ts`.

## License

See [LICENSE](LICENSE).
