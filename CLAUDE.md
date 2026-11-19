# WAYRA – SafeRoute (web prototype)

"Navigate Safely, Live Fearlessly." A women-safety navigation **web app** that finds the *safest* walking route, not just the fastest, using historical crime data plus environmental signals. It also includes SOS, live trip sharing and escape tools.

This file is the project spec. Read it fully before any task, follow the phase you are asked to do, and do not build features from later phases early.

## Scope and honest constraints
- **Demo city is Chicago.** The only crime dataset is Chicago's. The pitch deck names Indian cities as future phases; in the UI, say "Pilot: Chicago (data-available city)".
- **Do not hard-code marketing numbers** from the deck (94% accuracy, 40% reduction, 73% confidence). Show only metrics the model actually measures on held-out data.
- **Lighting and crowd density have no live feed.** Use the proxies below, and label them as estimates in the UI.
- **Messaging is simulated by default.** SOS and alert delivery go through a `Notifier` interface with `InAppNotifier` as the default and optional `TwilioNotifier` / `EmailNotifier` that switch on via env vars. Mock the police call with a `tel:911` link and a log entry. The app never auto-dials anyone.

## Tech stack
| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, React-Leaflet (OSM tiles), leaflet.heat, PWA (vite-plugin-pwa) |
| Backend | Python 3.11, FastAPI, SQLAlchemy, SQLite (Postgres-ready via `DATABASE_URL`), WebSockets for live tracking/alerts, JWT auth |
| Data/ML | pandas, pyarrow, h3, osmnx, networkx, scikit-learn, lightgbm, astral (sunset times) |
| Infra | npm scripts (root `package.json`, `concurrently`) + PowerShell scripts, `.env.example`. docker-compose/Makefile deferred (see Conventions) |

## Repo layout
```
wayra/
  CLAUDE.md
  README.md
  package.json       # npm scripts: setup, dev, dev:backend, dev:frontend, test
  scripts/           # PowerShell helpers (setup.ps1)
  .env.example
  data/              # gitignored: raw/, processed/, graph/
  ml/
    01_download.py   # crime CSV (Socrata, filtered) + police stations + OSM POIs/lit
    02_clean.py
    03_features.py
    04_train.py      # LightGBM + metrics report -> ml/reports/metrics.json, data/processed/cell_risk.parquet
    05_score_edges.py# risk per street edge per time bucket -> data/processed/edge_risk.npy, edge_rel_risk.npy, edge_index.parquet
    config.yaml
  backend/
    app/
      main.py
      core/ (config, security, db)
      models/ schemas/
      routers/ (auth, geocode, routing, risk, heatmap, contacts, sos, trips, reports, ws)
      services/ (geocode.py, router_engine.py, risk_service.py, notifier.py, deviation.py, night_mode.py)
    tests/
  frontend/
    src/
      pages/ (Home/Map, TripShare viewer, Contacts, SOS log, Login, Register, About/Model card)
      components/ (Header, AuthLayout, SearchPanel, PlaceInput, RouteCompare, SafetyLegend, Heatmap, SOSButton, VoiceSOS, FakeCall, NightModeBadge, ReportIncident)
      hooks/ (useGeolocation, useWebSocket, useOnlineStatus)
      lib/ (api.ts, auth.tsx, validation.ts)
```

## Data
**Source.** Kaggle's `chicago/chicago-crime` is a BigQuery dataset with no CSV download. The same data is the City of Chicago portal dataset **"Crimes – 2001 to Present"** (Socrata id `ijzp-q8t2`). Download a filtered subset through the Socrata API instead of the full ~2 GB file:
```
https://data.cityofchicago.org/resource/ijzp-q8t2.csv?$where=date >= '2022-01-01T00:00:00'&$limit=2000000
```
Columns used: `date, primary_type, description, location_description, domestic, arrest, latitude, longitude, community_area, district`.

**Relevance filter (street-safety focus):**
- Keep types: ASSAULT, BATTERY, ROBBERY, CRIM SEXUAL ASSAULT / CRIMINAL SEXUAL ASSAULT, SEX OFFENSE, STALKING, KIDNAPPING, HOMICIDE, INTIMIDATION, WEAPONS VIOLATION, PUBLIC PEACE VIOLATION, THEFT (only `description` containing "FROM PERSON" / "PURSE-SNATCHING" / "POCKET-PICKING").
- Drop `domestic == True` (in-home incidents don't describe street risk).
- Keep public `location_description` values: STREET, SIDEWALK, ALLEY, PARKING LOT*, CTA*, PARK PROPERTY, GAS STATION, VACANT LOT, BUS STOP, etc. Keep the mapping in `ml/config.yaml`.
- Drop rows with no coordinates.

**Severity weights** (configurable): homicide 10, criminal sexual assault 9, kidnapping 8, robbery 7, sex offense 6, aggravated assault/battery 6, stalking 5, weapons 2 (lowered from 5 in Phase 2: weapons violations mostly reflect police stops, not risk to pedestrians), simple assault/battery 3, theft-from-person 2, other 1.

**Environment proxies:**
- Lighting: OSM `lit=yes/no` on ways, plus street-light density from OSM `highway=street_lamp`. Fall back to road class (primary/secondary roads count as better lit).
- Crowd/foot traffic: density of OSM POIs (shops, restaurants, transit stops) within 200 m, weighted by an hour-of-day activity curve. Night-time POIs get a separate weight.
- Emergency proximity: distance to the nearest Chicago police station (City portal dataset `z8bn-74gv`) and hospital (OSM `amenity=hospital`).

## ML risk model
- Spatial unit: H3 hexagons, resolution 9 (~0.1 km²). Time unit: 2-hour window.
- Features per (hex, window): hour, weekday, month, weekend flag, counts and severity sums in the same hex over the past 7/30/90/365 days, the same for its k=1 neighbours, lighting score, POI density, distance to police station, after-sunset flag.
- Target: at least one relevant incident in the hex in that window.
- Model: LightGBM classifier with class-imbalance handling. Baseline to beat: historical-frequency heuristic.
- Split: **temporal** (train ≤ 2024-06, validate the next 6 months, test the most recent months). No random split.
- Report in `ml/reports/metrics.json` and on the frontend "Model card" page: ROC-AUC, PR-AUC, and hit rate @ top 10% of hexes (share of test incidents falling in the 10% of hexes ranked riskiest), each compared with the baseline.
- Output: `risk[hex][time_bucket]`, a 0–1 score calibrated with isotonic regression.

**As built in Phase 2** (these choices override the bullets above where they differ):
- **Monthly panel** so it fits in laptop memory: unit = (H3 res-9 cell, calendar month, 2-hour bucket 0–11), target = ≥1 incident in that cell/bucket/month. Cell universe = cells with any incident since 2022 plus their k=1 ring (~6k cells, ~3.4M rows).
- Features: counts and severity sums for the same cell+bucket over the previous 1/3/12 months, the same summed over the k=1 ring, cell totals (all buckets), bucket, month-of-year, after-dark share of the cell's last-12-month incidents, and static per-cell environment (OSM street-lamp count, POI count, night-time POI count = bar/pub/nightclub/restaurant/fast_food, distance to the nearest police station). Weekday/7-day lags are dropped because the unit is a month.
- Split: train 2023-01..2025-06 (2022 only feeds the 12-month lags), validate 2025-07..2025-12, test 2026-01..last complete month. The partial current month is ignored.
- LightGBM (≤400 trees, early stopping on validation PR-AUC), no class weighting: ranking metrics don't need it and isotonic calibration (fitted on validation) fixes the probabilities. Early stopping and calibration share the validation months; the test months stay untouched.
- Baseline = the cell+bucket incident count over the previous 12 months / 12. Hit rate @ top 10% ranks cells separately within each (month, bucket).
- `cell_risk.parquet` = calibrated risk for the month after the last complete month (columns `h3, forecast_month, risk_00..risk_11`). Model bundle in `data/models/risk_model.joblib`.
- Calibrated risks are real probabilities, so they are small (median ≈ 0.01, max ≈ 0.85). With the fixed 0.33/0.66 colour thresholds nearly every street is green. **Resolved in Phase 4:** routing and colours use the percentile rank (`edge_rel_risk.npy`, see Routing); the raw probability is kept in `edge_risk.npy`.

## Routing
- Graph: OSMnx `network_type="walk"` for the City of Chicago, cached to `data/graph/chicago_walk.graphml`.
- Edge risk rₑ,ₕ: the max-pooled risk of the hexes the edge crosses at time bucket h, adjusted by lighting (darker → higher at night) and crowd (busier → lower), clipped to [0, 1].
  **As built (Phase 3, `ml/05_score_edges.py`):** simplified to the risk of the H3 cell containing the edge midpoint (midpoint of the two end nodes). Night buckets (fixed 0,1,2,10,11 = 20:00–06:00) add +0.10 when there is no OSM street lamp within 40 m of the midpoint and no `lit=yes`-type tag; edges with POIs within 100 m get up to 15 % lower risk (`risk *= 1 − 0.15·min(1, pois/10)`); then clip to [0, 1]. Edges in cells outside the model's cell universe get that bucket's minimum cell risk. All parameters are in `ml/config.yaml` under `edges`. Outputs: `data/processed/edge_risk.npy` (float32, edges × 12) and `edge_index.parquet` (row i ↔ edge i: `u, v, key, length, lit_tag, h3, lamp_near, poi_count`, in `G.edges(keys=True)` order of the cached graphml). OSM lighting data for Chicago is sparse: only 1.4 % of edges have a lit tag and 1.7 % have a mapped lamp within 40 m, so 97 % count as unlit and the night penalty acts almost as a flat +0.10. **Phase 4 changes:** (1) *Lighting fallback:* a lit=yes-type tag or a lamp within 40 m = lit; an explicit `lit=no` = unlit; with neither a lit tag nor a lamp, road class decides: `trunk/primary/secondary/tertiary` (+ `_link`, any part of a merged edge) = lit, everything else (residential, service/alley, footway, path, steps, ...) = unlit. Result: 92 % unlit, and the night penalty now varies by street. (2) *Relative risk:* `edge_rel_risk.npy` (float32, edges × 12) = percentile rank (average ranks for ties) of every edge-bucket risk, ranked jointly over all edges × all 12 buckets, so night ranks riskier than day (day 54 % green / 40 % amber / 6 % red, night 4 / 23 / 73). Routing cost, safety score and colours use rel_risk; raw `edge_risk.npy` stays for reference. (3) *Graph caches:* the graphml is parsed once with a streaming stdlib `iterparse` (~25 s instead of ~11 min with `ox.load_graphml`) into `data/graph/walk_edges.parquet` (`u, v, key, length, lit_tag, lit_known, highway, lat, lon` in file order = `G.edges(keys=True)` order), `walk_nodes.parquet` (`osmid, lat, lon`) and `walk_geom.npz` (`offsets` E+1, `coords` lat/lon; each edge's polyline oriented u → v, both ends included). `edge_index.parquet` now also has `lit_known, unlit`. The caches rebuild when missing, older than the graphml, or missing columns; `--force-download` re-downloads the graph.
- Edge cost:

  costₑ = Lₑ · (1 + λ · rₑ,ₕ)

  Lₑ is the edge length in metres and λ is the safety weight. Use λ = 0 for **Fastest**, λ = 3 for **Balanced**, and λ = 8 for **Safest**.
- **Night-safe mode** turns on automatically between sunset and sunrise (astral, Chicago coordinates; the user can override). It uses λ × 1.5 and adds a lighting penalty for unlit edges.
- **As built (Phase 4 = spec Phase 3b, `backend/app/services/router_engine.py`):** the backend never parses the graphml. At startup (`main.py` lifespan) `RouterEngine.from_data_dir` loads `walk_nodes.parquet`, `edge_index.parquet` (`u, v, length, unlit`), `edge_rel_risk.npy` and `walk_geom.npz` into numpy arrays plus a cKDTree over node coordinates (~1 s; whole startup ~4 s). Missing files → the app still starts, logs a warning, `/api/route` returns 503 with the reason; `cell_risk.parquet` missing → `/api/heatmap` 503. `settings.load_routing_data=False` skips loading (tests never run the lifespan; they set `app.state.router_engine` to a fake engine). Per request: snap both points to the nearest node (> 1.5 km → 422), take edges with both ends in the from/to bbox + 2 km, keep the cheapest of parallel edges, scipy `dijkstra` from the start (falls back to the whole graph if the bbox has no path); ~60–150 ms for 3 profiles. Cost uses **rel_risk** (the raw probabilities are too small to matter against length): costₑ = Lₑ·(1 + λ·rₑ) + 0.001. Night-safe mode: λ × 1.5 and rₑ ← min(1, rₑ + 0.2) on unlit edges (Fastest, λ = 0, stays the plain shortest path). Constants live at the top of `router_engine.py`. Night mode = astral sunrise/sunset for Chicago on the departure date (`services/night_mode.py`); the request's `night_mode` is `"auto"` (default) or `true`/`false` to override. `depart_at` without a zone = Chicago local time; default now. Bucket = local hour // 2. Safety score uses the plain rel_risk (no lighting penalty). λ = 0/3/8 kept: on the demo trips Safest beats Fastest by 13–31 score points day and night (see README table); Balanced often equals Safest.
- API `POST /api/route {from:{lat,lng}, to:{lat,lng}, depart_at?, night_mode?: true|false|"auto"}` returns `{depart_at, bucket, night_mode, night_mode_source, sunrise, sunset, identical_routes, routes[3], snapped, compute_ms}`; each route has `profile, label, lambda (effective), geometry [[lat,lng]], distance_m, eta_min (5 km/h), safety_score, risk_m {green, amber, red}, segments [{coords, rel_risk, length_m, level}] (one per edge), identical_to [profiles with the same edge sequence]`. Also `GET /api/heatmap?bucket=0..11` (default: current bucket) → GeoJSON FeatureCollection of the ~6k model cells with `rel_risk` (percentile over cells × 12 buckets jointly) and raw `risk`; `GET /api/model-card` → `ml/reports/metrics.json`. All three need auth. `npm run verify:routes` (`backend/scripts/verify_routes.py`) prints the demo-trip table on real data.
- Original spec: API `POST /api/route {origin, destination, mode, depart_at}` returns all three routes. Each route has its geometry, distance, ETA, a safety score, and per-segment risk so the frontend can colour each segment: green < 0.33, amber < 0.66, red otherwise.
- Route safety score: 100 · (1 − length-weighted mean rₑ), rounded.
- **Live updates:** user-submitted incident reports (`POST /api/reports`) temporarily raise risk on nearby edges with a decay over 2 h. An active trip re-requests its route every 60 s, and the UI shows a toast when a safer route appears.
- Precompute edge risk for 12 time buckets as a numpy array keyed by edge index so a route request finishes in under 1 s.

## Phase order
Build one phase at a time, in this order. Each phase ends with tests, a README update and a commit.

| Phase | Scope | Status |
|---|---|---|
| 0 | Scaffold: FastAPI health check, React/Vite/Tailwind map of Chicago, npm + PowerShell scripts | ✅ done |
| **0.5** | **Auth + search UI** (moved earlier on purpose): SQLite/SQLAlchemy `User`, `POST /api/auth/register`, `POST /api/auth/login` (JWT), `GET /api/auth/me`; Login/Register pages; the map page needs sign-in; header shows the user's name and a logout button. The map has a From/To search panel with Nominatim autocomplete limited to the City of Chicago (backend proxy `GET /api/geocode/search` with an identifying User-Agent, debounced, 1 req/s), "Use my location", markers, and a placeholder "Find safe route" button (feature 15) | ✅ done |
| 1 | Data pipeline: `ml/01_download.py`, `02_clean.py`, `config.yaml`, `npm run data` (alias `ml:data`) | ✅ done |
| 2 | Features + LightGBM risk model + metrics report (`03_features.py`, `04_train.py`, `npm run train`) | ✅ done |
| 3 | Walk graph + street safety scores per edge × 12 buckets (`05_score_edges.py`, `npm run score`) | ✅ done |
| 3b | `POST /api/route` with Fastest/Balanced/Safest on the precomputed edge risk; wire up "Find safe route" (features 1–3). Split out of Phase 3 so the ML work could land first. **Built together with the backend half of Phase 4** (committed as "Phase 4: routing API + basic route display"): lighting fallback + relative risk in `05_score_edges.py`, fast graph caches, `/api/route` with night-safe mode, `/api/heatmap`, `/api/model-card`, and a basic route display (3 polylines: Safest bold purple, Balanced dashed teal, Fastest dashed grey; one card each with distance, ETA, safety score in `components/RouteCompare.tsx`) | ✅ done |
| 4 | Night-safe mode, risk heatmap with time slider, Model card page (features 4, 6). Backend (night mode, heatmap/model-card endpoints) done in 3b; **left:** full route styling (green/amber/red segment colouring from `segments`, legend, route selection), night-mode badge/toggle, heatmap layer with time slider, Model card page | next |
| 5 | Trusted contacts CRUD, `Notifier`, SOS with log and `tel:911` (features 7, 13) | |
| 6 | Live trip sharing over WebSocket, deviation alerts, incident reports with live recalculation (features 5, 8, 9) | |
| 7 | Voice SOS, fake call, PWA offline alerts, demo mode (features 10, 11, 12, 14) | |

## Features checklist (from the pitch deck)
0. ✅ Auth: register / login / logout with JWT; the map page needs sign-in (Phase 0.5)
1. Safest-route navigation with Fastest / Balanced / Safest comparison
2. AI safety score per segment and per route
3. Colour-coded routes (green/amber/red) with a legend
4. Night-safe mode (auto after sunset)
5. Real-time recalculation from live incident reports
6. AI risk heatmap with a time slider (hour of day) and "next 2 hours" prediction
7. One-tap SOS: sends GPS to trusted contacts and the authorities (simulated), with a 5 s cancel countdown, an SOS log, and a `tel:911` button
8. Live tracking: a shareable trip link (`/track/:token`) where contacts watch movement in real time over WebSocket
9. Deviation alerts: alert contacts if the user moves >100 m off the route for >30 s, or stays stationary for >3 min mid-trip
10. Voice-activated SOS: Web Speech API listens for the phrase "help help" or "wayra help" when enabled (Chrome; show a fallback message elsewhere)
11. Fake call generator: a full-screen incoming-call UI with ringtone, caller name, a configurable delay, and accept/decline
12. Offline emergency alerts: a PWA service worker caches the app shell. When `navigator.onLine` is false, SOS opens an `sms:` URI pre-filled with a Google/OSM maps link to the last known location and sends it to the trusted contacts.
13. Trusted contacts CRUD (auth itself moved to item 0 / Phase 0.5)
14. **Demo mode:** simulated GPS that walks along the chosen route at a set speed, with a button to trigger a deviation. This lets the whole flow be demoed from India on Chicago data.
15. ✅ Place search: From/To autocomplete (Nominatim, Chicago only), "Use my location", markers on the map (Phase 0.5; routing itself is Phase 3)

## Conventions
- **Dev environment is Windows + PowerShell.** Do not rely on `make` or Docker for now; use npm scripts and PowerShell scripts (`scripts/*.ps1`).
- Python is the official CPython 3.11 (not MSYS2/MinGW Python) in `backend/.venv`; npm scripts call `backend\.venv\Scripts\python.exe` directly, so no activation is needed.
- Setup: `npm install && npm run setup`. Run the app: `npm run dev` (backend on :8000 + Vite on :5173, which proxies `/api`), or `npm run dev:backend` / `npm run dev:frontend`. Tests: `npm test`.
- ML pipeline: each step is an npm script that runs the `ml/` scripts with the backend venv's Python: `npm run data` (alias `ml:data`), `npm run train` (features + model, alias `ml:train`, ~1.5 min), `npm run score` (walk graph + edge risk, alias `ml:score`; the first run takes ~4 min to download the graph, reruns <1 min), `npm run verify:routes` (demo-trip table on real data).
- Docker/Makefile are deferred: add `docker-compose.yml` and a `Makefile` later only if asked; they are not part of the Windows workflow.
- No secrets in git; keep keys in `.env` (see `.env.example`). `data/` is gitignored. `npm run setup` writes a random `JWT_SECRET` into a new `.env`.
- Auth: passwords hashed with `bcrypt` (8–72 chars), JWTs via `PyJWT` (HS256, `JWT_SECRET`, `JWT_EXPIRE_MINUTES`). Protect endpoints with the `CurrentUser` dependency from `app/routers/deps.py`. The frontend keeps the token in `localStorage` and guards routes with `RequireAuth` in `App.tsx`.
- External APIs called from the browser that need a User-Agent (e.g. Nominatim) go through a backend proxy, because browsers can't set that header.
- Backend: type hints, pydantic schemas, pytest tests for routing cost, deviation logic and notifier. Frontend: TypeScript strict mode.
- Mobile-first responsive UI. Brand: deep purple/teal, a calm and trustworthy tone, accessible contrast, and a large SOS button that is always visible.
- After each phase: run the tests, update the README, and commit with a clear message.
