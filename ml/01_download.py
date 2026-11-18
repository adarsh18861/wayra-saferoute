"""Phase 1, step 1: download raw data.

- Chicago crimes (Socrata ijzp-q8t2), filtered server-side -> data/raw/crimes.csv
- Chicago police stations (Socrata z8bn-74gv)               -> data/raw/police_stations.csv
- OSM POIs and street lamps for the City of Chicago          -> data/raw/osm_pois.parquet, osm_lamps.parquet

Existing output files are skipped unless --force is given. The crime download is
paginated ($limit/$offset, $order=id); each page is saved to data/raw/_crimes_parts/
as it arrives, so an interrupted run resumes from the last finished page.

Optional SOCRATA_APP_TOKEN (env var or .env) raises Socrata's rate limits.

Usage: python ml/01_download.py [--force] [--only crimes|stations|osm ...]
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from common import CACHE_DIR, RAW_DIR, env_value, load_config

USER_AGENT = "WAYRA-SafeRoute-data-pipeline/0.1"
MAX_RETRIES = 6
TIMEOUT = (30, 300)  # connect, read seconds


# ---------------------------------------------------------------- Socrata helpers
def _session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    token = env_value("SOCRATA_APP_TOKEN")
    if token:
        s.headers["X-App-Token"] = token
    return s


def get_with_retry(session: requests.Session, url: str, params: dict[str, Any]) -> requests.Response:
    """GET with exponential backoff on network errors, 429 and 5xx."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = session.get(url, params=params, timeout=TIMEOUT)
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}: {r.text[:200]}", response=r)
            r.raise_for_status()
            return r
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status is not None and 400 <= status < 500 and status != 429:
                raise  # bad query: retrying will not help
            if attempt == MAX_RETRIES:
                raise
            wait = min(2 ** attempt, 60)
            print(f"  ! {e.__class__.__name__}: {str(e)[:120]} -- retry {attempt}/{MAX_RETRIES - 1} in {wait}s",
                  flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def soql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def crimes_where(cfg: dict[str, Any]) -> str:
    c = cfg["crimes"]
    parts = [f"date >= '{c['start_date']}T00:00:00'"]
    if c.get("end_date"):
        parts.append(f"date < '{c['end_date']}T00:00:00'")
    parts.append("primary_type IN (" + ", ".join(soql_quote(t) for t in c["primary_types"]) + ")")
    parts.append("domestic = false")
    return " AND ".join(parts)


# ---------------------------------------------------------------- crimes
def download_crimes(cfg: dict[str, Any], force: bool) -> None:
    out = RAW_DIR / "crimes.csv"
    if out.exists() and not force:
        print(f"[crimes] {out} exists, skipping (use --force to re-download)")
        return

    c = cfg["crimes"]
    url = f"{c['base_url']}/{c['dataset']}.csv"
    where = crimes_where(cfg)
    select = ",".join(c["columns"])
    page_size = int(c["page_size"])

    parts_dir = RAW_DIR / "_crimes_parts"
    query_id = hashlib.sha1(f"{where}|{select}|{page_size}".encode()).hexdigest()[:12]
    meta_path = parts_dir / "query.json"
    if force and parts_dir.exists():
        shutil.rmtree(parts_dir)
    if parts_dir.exists():
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        if meta.get("query_id") != query_id:
            print("[crimes] query changed since the partial download; starting over")
            shutil.rmtree(parts_dir)
    parts_dir.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps({"query_id": query_id, "where": where, "select": select}))

    session = _session()
    print(f"[crimes] WHERE {where}")
    total = int(get_with_retry(session, f"{c['base_url']}/{c['dataset']}.json",
                               {"$select": "count(*) AS n", "$where": where}).json()[0]["n"])
    n_pages = max(1, -(-total // page_size))
    print(f"[crimes] {total:,} rows to fetch in {n_pages} pages of {page_size:,}")

    page, fetched = 0, 0
    while True:
        part = parts_dir / f"page_{page:05d}.csv"
        if part.exists():
            rows = sum(1 for _ in open(part, encoding="utf-8")) - 1
            fetched += rows
            print(f"[crimes] page {page + 1}/{n_pages}: {rows:,} rows (already downloaded)  "
                  f"total {fetched:,}/{total:,}", flush=True)
        else:
            t0 = time.time()
            r = get_with_retry(session, url, {
                "$select": select, "$where": where, "$order": "id",
                "$limit": page_size, "$offset": page * page_size,
            })
            df = pd.read_csv(io.StringIO(r.text), dtype=str, keep_default_na=False)
            rows = len(df)
            tmp = part.with_suffix(".tmp")
            df.to_csv(tmp, index=False)
            tmp.replace(part)  # atomic: a page file is either complete or absent
            fetched += rows
            print(f"[crimes] page {page + 1}/{n_pages}: {rows:,} rows in {time.time() - t0:.1f}s  "
                  f"total {fetched:,}/{total:,} ({100 * fetched / max(total, 1):.0f}%)", flush=True)
        if rows < page_size:
            break
        page += 1

    parts = sorted(parts_dir.glob("page_*.csv"))
    combined = pd.concat((pd.read_csv(p, dtype=str, keep_default_na=False) for p in parts), ignore_index=True)
    combined = combined.drop_duplicates(subset="id")
    tmp = out.with_suffix(".tmp")
    combined.to_csv(tmp, index=False)
    tmp.replace(out)
    shutil.rmtree(parts_dir)
    print(f"[crimes] saved {len(combined):,} rows -> {out}")


# ---------------------------------------------------------------- police stations
def download_stations(cfg: dict[str, Any], force: bool) -> None:
    out = RAW_DIR / "police_stations.csv"
    if out.exists() and not force:
        print(f"[stations] {out} exists, skipping")
        return
    p = cfg["police_stations"]
    url = f"{cfg['crimes']['base_url']}/{p['dataset']}.csv"
    r = get_with_retry(_session(), url, {"$select": ",".join(p["columns"]), "$limit": 1000})
    df = pd.read_csv(io.StringIO(r.text))
    df.to_csv(out, index=False)
    print(f"[stations] saved {len(df)} stations -> {out}")


# ---------------------------------------------------------------- OSM
def _poi_category(row: pd.Series, poi_tags: dict[str, Any]) -> str | None:
    """First matching (key, value) from config order -> category label."""
    for key, values in poi_tags.items():
        val = row.get(key)
        if not isinstance(val, str) or not val:
            continue
        if values is True:
            return key  # e.g. "shop"
        if val in values:
            if key in ("railway", "public_transport") or (key == "highway" and val == "bus_stop"):
                return "transit"
            return val  # amenity value: hospital, restaurant, cafe, bar ...
    return None


def _to_points(gdf: Any, keep_cols: list[str]) -> pd.DataFrame:
    """GeoDataFrame of any geometry -> plain DataFrame with lat/lon (polygon centroids in a metric CRS)."""
    gdf = gdf.reset_index()
    pts = gdf.geometry
    if not (pts.geom_type == "Point").all():
        pts = gdf.geometry.to_crs(26916).centroid.to_crs(4326)  # UTM 16N, metres
    df = pd.DataFrame({
        "osm_type": gdf["element"].astype(str) if "element" in gdf else gdf.get("element_type"),
        "osm_id": gdf["id"].astype("int64") if "id" in gdf else gdf.get("osmid"),
        "lat": pts.y.to_numpy(),
        "lon": pts.x.to_numpy(),
    })
    for col in keep_cols:
        df[col] = gdf[col].astype("string").to_numpy() if col in gdf else pd.NA
    return df


OVERPASS_ENDPOINTS = ["https://overpass-api.de/api", "https://maps.mail.ru/osm/tools/overpass/api"]


def _city_polygons(ox: Any, place: str) -> tuple[Any, Any]:
    """(exact boundary, simplified query polygon). The exact Chicago boundary has thousands of
    vertices, which makes the Overpass request body too large (HTTP 413), so queries use a
    slightly buffered, simplified outline and results are clipped to the exact boundary."""
    boundary = ox.geocode_to_gdf(place).to_crs(26916).geometry.union_all()  # UTM 16N, metres
    query = boundary.buffer(200).simplify(150)
    import geopandas as gpd
    exact, simple = gpd.GeoSeries([boundary, query], crs=26916).to_crs(4326)
    return exact, simple


def _features_with_retry(ox: Any, place: str, tags: dict[str, Any]) -> Any:
    """Query Overpass one tag key at a time (smaller responses), retrying with backoff and
    rotating endpoints. Successful responses are cached by osmnx, so retries are cheap."""
    import geopandas as gpd

    exact, query_poly = _city_polygons(ox, place)
    frames = []
    for key, values in tags.items():
        for attempt in range(1, MAX_RETRIES + 1):
            ox.settings.overpass_url = OVERPASS_ENDPOINTS[(attempt - 1) % len(OVERPASS_ENDPOINTS)]
            try:
                print(f"[osm]   {key}={values} via {ox.settings.overpass_url}", flush=True)
                g = ox.features_from_polygon(query_poly, tags={key: values})
                frames.append(g[g.intersects(exact)])
                break
            except ox._errors.InsufficientResponseError:
                print(f"[osm]   no features for {key}", flush=True)
                break
            except Exception as e:  # network/SSL/Overpass errors
                if attempt == MAX_RETRIES:
                    raise
                wait = min(10 * 2 ** (attempt - 1), 120)
                print(f"[osm]   ! {e.__class__.__name__}: {str(e)[:120]} -- retry {attempt}/{MAX_RETRIES - 1} "
                      f"in {wait}s", flush=True)
                time.sleep(wait)
    if not frames:
        raise ox._errors.InsufficientResponseError("no OSM features returned")
    gdf = pd.concat(frames)
    gdf = gdf[~gdf.index.duplicated(keep="first")]
    return gpd.GeoDataFrame(gdf, geometry="geometry", crs=frames[0].crs)


def download_osm(cfg: dict[str, Any], force: bool) -> None:
    pois_out, lamps_out = RAW_DIR / "osm_pois.parquet", RAW_DIR / "osm_lamps.parquet"
    if pois_out.exists() and lamps_out.exists() and not force:
        print("[osm] POI and lamp files exist, skipping")
        return

    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.cache_folder = str(CACHE_DIR / "osmnx")
    ox.settings.requests_timeout = 600
    ox.settings.http_user_agent = USER_AGENT
    place = cfg["city"]["osm_place"]
    o = cfg["osm"]

    if force or not pois_out.exists():
        print(f"[osm] fetching POIs for {place} (Overpass, may take a few minutes) ...", flush=True)
        poi_tags = o["poi_tags"]
        gdf = _features_with_retry(ox, place, poi_tags)
        df = _to_points(gdf, ["name", "amenity", "shop", "highway", "railway", "public_transport", "opening_hours"])
        df["category"] = df.apply(lambda r: _poi_category(r, poi_tags), axis=1)
        df = df.dropna(subset=["category"]).drop_duplicates(subset=["osm_type", "osm_id"])
        df.to_parquet(pois_out, index=False)
        print(f"[osm] saved {len(df):,} POIs -> {pois_out}")
        print(df["category"].value_counts().to_string())

    if force or not lamps_out.exists():
        print(f"[osm] fetching street lamps for {place} ...", flush=True)
        try:
            gdf = _features_with_retry(ox, place, o["lamp_tags"])
            df = _to_points(gdf, ["highway", "lamp_type", "lamp_mount"])
        except ox._errors.InsufficientResponseError:
            df = pd.DataFrame(columns=["osm_type", "osm_id", "lat", "lon", "highway", "lamp_type", "lamp_mount"])
        df.to_parquet(lamps_out, index=False)
        print(f"[osm] saved {len(df):,} street lamps -> {lamps_out}")


# ---------------------------------------------------------------- main
STEPS = {"crimes": download_crimes, "stations": download_stations, "osm": download_osm}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="re-download even if output files exist")
    ap.add_argument("--only", nargs="+", choices=list(STEPS), help="run only these steps")
    args = ap.parse_args(argv)

    cfg = load_config()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name in args.only or list(STEPS):
        STEPS[name](cfg, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
