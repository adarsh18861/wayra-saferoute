"""Place search via OpenStreetMap Nominatim, restricted to the City of Chicago.

Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/) requires an
identifying User-Agent and at most 1 request per second. Browsers cannot set User-Agent, so the
frontend calls this backend proxy instead of Nominatim directly.
"""

import asyncio
import time
from collections import OrderedDict

import httpx

from app.core.config import settings

# City of Chicago bounding box: west, north, east, south (Nominatim `viewbox` order).
CHICAGO_BBOX = (-87.9401, 42.0230, -87.5240, 41.6445)

_CACHE_SIZE = 500
_cache: OrderedDict[str, list[dict[str, object]]] = OrderedDict()
_lock = asyncio.Lock()
_last_request = 0.0


def in_chicago(lat: float, lon: float) -> bool:
    west, north, east, south = CHICAGO_BBOX
    return south <= lat <= north and west <= lon <= east


def _parse(raw: list[dict[str, object]]) -> list[dict[str, object]]:
    places = []
    for item in raw:
        try:
            lat, lon = float(str(item["lat"])), float(str(item["lon"]))
        except (KeyError, ValueError):
            continue
        if in_chicago(lat, lon):
            places.append({"name": str(item.get("display_name", "")), "lat": lat, "lon": lon})
    return places


async def _fetch(query: str, limit: int) -> list[dict[str, object]]:
    global _last_request
    west, north, east, south = CHICAGO_BBOX
    params: dict[str, str | int] = {
        "q": query,
        "format": "jsonv2",
        "limit": limit,
        "countrycodes": "us",
        "viewbox": f"{west},{north},{east},{south}",
        "bounded": 1,
    }
    async with _lock:  # serialise calls to respect the 1 req/s limit
        wait = 1.0 - (time.monotonic() - _last_request)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(
                    f"{settings.nominatim_url}/search",
                    params=params,
                    headers={"User-Agent": settings.nominatim_user_agent, "Accept-Language": "en"},
                )
        finally:
            _last_request = time.monotonic()
    r.raise_for_status()
    return r.json()


async def search_places(query: str, limit: int = 6) -> list[dict[str, object]]:
    key = f"{limit}|{query.strip().lower()}"
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    places = _parse(await _fetch(query.strip(), limit))
    _cache[key] = places
    if len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return places
