# WAYRA – SafeRoute

*Navigate Safely, Live Fearlessly.* A women-safety navigation web app that finds the **safest** walking route, not just the fastest, using historical crime data plus environmental signals.

**Pilot: Chicago (data-available city).** See [CLAUDE.md](CLAUDE.md) for the full project spec.

> Status: **Phase 4 (spec "Phase 3b"): routing API + basic route display.** Users can register and sign in (JWT). The map page needs sign-in and has a From/To search panel with Chicago-only place autocomplete, "Use my location" and map markers. `npm run data` downloads and cleans the Chicago crime data plus OSM and police-station context. `npm run train` trains a calibrated LightGBM risk model per H3 cell × 2-hour bucket. `npm run score` turns that into a risk score for every walkable street segment in Chicago. **"Find safe route"** now returns Fastest / Balanced / Safest walking routes, drawn on the map with a card for each (distance, ETA, safety score). Night-safe mode switches on automatically after sunset. Full route styling, the heatmap UI and the model card page come next.

## Features so far

- **Accounts:** `POST /api/auth/register`, `POST /api/auth/login` (both return a JWT), and `GET /api/auth/me`. Users are stored in SQLite (`backend/wayra.db`, gitignored) through SQLAlchemy, with bcrypt-hashed passwords.
- **Login and Register pages** with client-side validation and the server's error messages (duplicate email, wrong password, and so on). The token is kept in `localStorage`, and the header shows your name with a **Log out** button.
- **Safe routing:** `POST /api/route` returns three walking routes (Fastest, Balanced, Safest) with geometry, distance, ETA at 5 km/h, a 0–100 safety score, metres of green/amber/red street, and per-segment relative risk for colouring. "Find safe route" draws them on the map (Safest bold purple, Balanced dashed teal, Fastest dashed grey) with a card for each. See [Routing](#routing).
- **Heatmap and model card data:** `GET /api/heatmap?bucket=0..11` (H3 cell polygons as GeoJSON with relative risk) and `GET /api/model-card` (the held-out metrics). Both need sign-in; the UI for them comes in the next phase.
- **Place search:** `GET /api/geocode/search?q=…` (sign-in required) proxies OpenStreetMap Nominatim with an identifying User-Agent. Results are limited to the City of Chicago bounding box, calls are throttled to 1 per second, and results are cached. The frontend waits 400 ms after typing stops before it searches.

## Configuration

`.env` (created by `npm run setup` from [.env.example](.env.example)):

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Key that signs login tokens. `setup` generates a random one. If you create `.env` by hand, set a long random string: `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `JWT_EXPIRE_MINUTES` | Token lifetime (default 1440 = 24 h) |
| `DATABASE_URL` | Defaults to SQLite `sqlite:///./wayra.db`, relative to `backend/` |
| `NOMINATIM_USER_AGENT` | User-Agent sent to Nominatim. Add contact details before deploying publicly. |
| `SOCRATA_APP_TOKEN` | Optional. A free [City of Chicago app token](https://data.cityofchicago.org/profile/edit/developer_settings) raises the API rate limit for `npm run data`. |

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

## Data pipeline

```powershell
npm run data                        # download + clean (same as npm run ml:data)
npm run data:download               # step 1 only; skips files that already exist
npm run data:download -- --force    # re-download everything
npm run data:download -- --only osm # just one step: crimes | stations | osm
npm run data:clean                  # step 2 only
```

Settings (date range, crime types, public location list, severity weights, bounding box, H3 resolution) live in [ml/config.yaml](ml/config.yaml).

| Step | Output (in `data/`, gitignored) |
|---|---|
| [ml/01_download.py](ml/01_download.py) | `raw/crimes.csv`: City of Chicago "Crimes – 2001 to Present" (Socrata `ijzp-q8t2`) since 2022-01-01, filtered on the server to the relevant crime types and `domestic = false`. It is fetched in pages of 50,000 with retries, and an interrupted download resumes from the last finished page. |
| | `raw/police_stations.csv`: police stations (Socrata `z8bn-74gv`) |
| | `raw/osm_pois.parquet`: OSM shops, restaurants, cafes, bars, transit stops/stations and hospitals in the City of Chicago (as points, with a `category`). `raw/osm_lamps.parquet`: OSM `highway=street_lamp` |
| [ml/02_clean.py](ml/02_clean.py) | `processed/incidents.parquet`: keeps theft only when it is from a person (pocket-picking, purse-snatching) and keeps only public locations. Drops rows without coordinates or outside the Chicago bounding box. Adds `severity`, `hour`, `weekday` (Mon = 0), `month`, `after_dark` (astral sunset/sunrise for Chicago) and `h3` (resolution 9). Prints a summary. |

The first full run takes several minutes; most of that is the crime download and the OSM Overpass queries.

## Risk model and street safety scores

```powershell
npm run train    # 03_features.py + 04_train.py (~1.5 min)
npm run score    # 05_score_edges.py; first run ~4 min (downloads the walk graph, parses it in ~25 s), reruns <1 min
```

| Step | Output |
|---|---|
| [ml/03_features.py](ml/03_features.py) | `data/processed/panel.parquet`: one row per (H3 res-9 cell, month, 2-hour bucket) with lagged counts and severity sums (1/3/12 months) for the cell and its neighbours, cell totals, month-of-year and after-dark share. `cells.parquet`: per-cell street-lamp, POI and night-POI counts and distance to the nearest police station |
| [ml/04_train.py](ml/04_train.py) | LightGBM with early stopping, isotonic calibration on the validation months. `data/models/risk_model.joblib`, `data/processed/cell_risk.parquet` (risk 0–1 per cell × 12 buckets for the next month), [ml/reports/metrics.json](ml/reports/metrics.json) and [ml/reports/feature_importance.png](ml/reports/feature_importance.png) |
| [ml/05_score_edges.py](ml/05_score_edges.py) | `data/graph/chicago_walk.graphml`, plus the caches the backend loads (`walk_edges.parquet`, `walk_nodes.parquet`, `walk_geom.npz`). `data/processed/edge_risk.npy` (raw risk, edges × 12, float32), `edge_rel_risk.npy` (relative risk 0–1, same shape) and `edge_index.parquet` (row i = edge i: `u, v, key, length, unlit, …`) |

The split is temporal: train 2023-01 to 2025-06, validate 2025-07 to 2025-12, test 2026-01 onward. Test-set results (the latest run is in [metrics.json](ml/reports/metrics.json)):

| Metric | Model | Baseline (previous 12-month frequency) |
|---|---|---|
| ROC-AUC | 0.838 | 0.719 |
| PR-AUC | 0.178 | 0.123 |
| Hit rate @ top 10% of cells | 47.2% | 40.0% |

The street score starts from the risk of the cell containing the edge's midpoint. At night (20:00–06:00) it adds a penalty for unlit streets, and it is slightly lower for busier streets (POIs within 100 m). An edge counts as lit if it has an OSM `lit=yes` tag or a mapped street lamp within 40 m. OSM has lighting data for only ~3% of Chicago's edges, so the rest fall back to road class: trunk/primary/secondary/tertiary roads count as lit, and residential streets, service roads/alleys, footways and paths count as unlit. Lighting and crowd levels are **estimates from OpenStreetMap**, not live data.

Calibrated risks are small probabilities, so the map and the router use **relative risk**: the percentile rank of each edge's risk, ranked across all edges and all 12 buckets together, so night streets rank as riskier than day streets. Colours: green < 0.33, amber < 0.66, red above that.

Latest run, 1.1 M directed edges (92% count as unlit):

| Buckets | Raw risk mean | Median | p99 | Green | Amber | Red |
|---|---|---|---|---|---|---|
| Day (06:00–20:00) | 0.035 | 0.019 | 0.225 | 53.9% | 40.2% | 5.9% |
| Night (20:00–06:00) | 0.125 | 0.115 | 0.325 | 4.0% | 22.8% | 73.2% |

All parameters are in `ml/config.yaml` (`model`, `edges`).

## Routing

The backend builds the routing graph at startup from the parquet/npz files above (it never parses the graphml). That takes about 1 s for 327 k nodes and 1.1 M edges. If the files are missing, the server still starts, logs a warning, and `/api/route` returns 503 with a message telling you to run `npm run score`.

- **Edge cost** = length × (1 + λ × relative risk for the departure's 2-hour bucket). λ = 0 for **Fastest**, 3 for **Balanced**, 8 for **Safest**.
- **Night-safe mode** turns on automatically between sunset and sunrise in Chicago (astral). It multiplies λ by 1.5 and adds 0.2 to the relative risk of unlit edges, so Balanced and Safest prefer lit streets. Fastest is always the plain shortest path. Send `night_mode: true` or `false` to override, or `"auto"` (the default).
- **Safety score** = round(100 × (1 − length-weighted mean relative risk)), on the plain relative risk.
- Start and end snap to the nearest graph node (up to 1.5 km away; further returns 422). Each profile runs Dijkstra (scipy) on the area around the trip (the start/end box plus 2 km). A request takes about 0.1–0.2 s. Routes that come out identical are still returned, with `identical_to` filled in and `identical_routes: true`.

```http
POST /api/route
{"from": {"lat": 41.8786, "lng": -87.6403}, "to": {"lat": 41.8917, "lng": -87.6086},
 "depart_at": "2026-11-19T23:00:00", "night_mode": "auto"}
```

`depart_at` is optional (default: now). A time without a zone is read as Chicago local time.

`npm run verify:routes` runs two demo trips at 14:00 and 23:00 on the real data (latest run, 2026-11-19):

| Trip | Time | Route | Distance | ETA | Safety score |
|---|---|---|---|---|---|
| Union Station → Navy Pier | 14:00 | Fastest | 3.88 km | 47 min | 25 |
| | | Balanced | 4.31 km | 52 min | 48 |
| | | Safest | 4.31 km | 52 min | 48 |
| | 23:00 (night) | Fastest | 3.88 km | 47 min | 12 |
| | | Balanced | 4.27 km | 51 min | 32 |
| | | Safest | 4.29 km | 52 min | 33 |
| University of Chicago → 63rd St (Green Line) | 14:00 | Fastest | 2.31 km | 28 min | 43 |
| | | Balanced | 2.34 km | 28 min | 56 |
| | | Safest | 2.34 km | 28 min | 56 |
| | 23:00 (night) | Fastest | 2.31 km | 28 min | 19 |
| | | Balanced | 2.37 km | 28 min | 50 |
| | | Safest | 2.37 km | 28 min | 50 |

Safest beats Fastest in all four cases, for 1–11% more walking. Balanced often matches Safest, because λ = 3 is already enough to reach the safer streets.

## Test

```powershell
npm test               # backend pytest + ml pytest + frontend TypeScript typecheck
npm run test:backend   # auth, geocode, routing cost/safety score/night mode, /api/route on a tiny fake graph
npm run test:ml        # data cleaning, panel/lag, edge risk, lighting fallback, relative risk, graphml parser (no network)
npm run test:frontend
```

## Repo layout

```
backend/    FastAPI app (app/), pytest tests (tests/), requirements.txt, .venv (gitignored)
frontend/   React + Vite + TypeScript + Tailwind + React-Leaflet
ml/         data + model pipeline (config.yaml, 01_download … 05_score_edges, reports/, tests/)
data/       downloaded and processed data (gitignored)
scripts/    PowerShell helper scripts
```

## Troubleshooting

- **`running scripts is disabled on this system`** when activating the venv: you don't need to activate it, because the npm scripts call `backend\.venv\Scripts\python.exe` directly. If you do want to activate it, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **"Use my location" says you're outside the pilot area**: routing only covers Chicago. Type a Chicago address instead.
- **Port already in use**: if Vite says `Port 5173 is in use, trying another one...`, an earlier `npm run dev` is probably still running. Close that terminal, or use the port Vite prints. Otherwise stop the other process on 8000/5173, or change `--port` in the root `package.json` and the proxy target in `frontend/vite.config.ts`.

## License

See [LICENSE](LICENSE).
