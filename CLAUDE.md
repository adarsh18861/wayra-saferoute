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
    04_train.py      # LightGBM + metrics report -> ml/reports/metrics.json
    05_score_edges.py# risk per street edge per time bucket -> data/processed/edge_risk.parquet
    config.yaml
  backend/
    app/
      main.py
      core/ (config, security, db)
      models/ schemas/
      routers/ (auth, routing, risk, heatmap, contacts, sos, trips, reports, ws)
      services/ (router_engine.py, risk_service.py, notifier.py, deviation.py, night_mode.py)
    tests/
  frontend/
    src/
      pages/ (Home/Map, TripShare viewer, Contacts, SOS log, Login, About/Model card)
      components/ (RouteCompare, SafetyLegend, Heatmap, SOSButton, VoiceSOS, FakeCall, NightModeBadge, ReportIncident)
      hooks/ (useGeolocation, useWebSocket, useOnlineStatus)
      lib/api.ts
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

**Severity weights** (configurable): homicide 10, criminal sexual assault 9, kidnapping 8, robbery 7, sex offense 6, aggravated assault/battery 6, stalking 5, weapons 5, simple assault/battery 3, theft-from-person 2, other 1.

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

## Routing
- Graph: OSMnx `network_type="walk"` for the City of Chicago, cached to `data/graph/chicago_walk.graphml`.
- Edge risk rₑ,ₕ: the max-pooled risk of the hexes the edge crosses at time bucket h, adjusted by lighting (darker → higher at night) and crowd (busier → lower), clipped to [0, 1].
- Edge cost:

  costₑ = Lₑ · (1 + λ · rₑ,ₕ)

  Lₑ is the edge length in metres and λ is the safety weight. Use λ = 0 for **Fastest**, λ = 3 for **Balanced**, and λ = 8 for **Safest**.
- **Night-safe mode** turns on automatically between sunset and sunrise (astral, Chicago coordinates; the user can override). It uses λ × 1.5 and adds a lighting penalty for unlit edges.
- API `POST /api/route {origin, destination, mode, depart_at}` returns all three routes. Each route has its geometry, distance, ETA, a safety score, and per-segment risk so the frontend can colour each segment: green < 0.33, amber < 0.66, red otherwise.
- Route safety score: 100 · (1 − length-weighted mean rₑ), rounded.
- **Live updates:** user-submitted incident reports (`POST /api/reports`) temporarily raise risk on nearby edges with a decay over 2 h. An active trip re-requests its route every 60 s, and the UI shows a toast when a safer route appears.
- Precompute edge risk for 12 time buckets as a numpy array keyed by edge index so a route request finishes in under 1 s.

## Features checklist (from the pitch deck)
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
13. Trusted contacts CRUD, plus auth (register/login)
14. **Demo mode:** simulated GPS that walks along the chosen route at a set speed, with a button to trigger a deviation. This lets the whole flow be demoed from India on Chicago data.

## Conventions
- **Dev environment is Windows + PowerShell.** Do not rely on `make` or Docker for now; use npm scripts and PowerShell scripts (`scripts/*.ps1`).
- Python is the official CPython 3.11 (not MSYS2/MinGW Python) in `backend/.venv`; npm scripts call `backend\.venv\Scripts\python.exe` directly, so no activation is needed.
- Setup: `npm install && npm run setup`. Run the app: `npm run dev` (backend on :8000 + Vite on :5173, which proxies `/api`), or `npm run dev:backend` / `npm run dev:frontend`. Tests: `npm test`.
- ML pipeline (later phases): expose each step as an npm script that runs the `ml/` scripts with the backend venv's Python (e.g. `npm run ml:data`, `npm run ml:train`, `npm run ml:score`).
- Docker/Makefile are deferred: add `docker-compose.yml` and a `Makefile` later only if asked; they are not part of the Windows workflow.
- No secrets in git; keep keys in `.env` (see `.env.example`). `data/` is gitignored.
- Backend: type hints, pydantic schemas, pytest tests for routing cost, deviation logic and notifier. Frontend: TypeScript strict mode.
- Mobile-first responsive UI. Brand: deep purple/teal, a calm and trustworthy tone, accessible contrast, and a large SOS button that is always visible.
- After each phase: run the tests, update the README, and commit with a clear message.
