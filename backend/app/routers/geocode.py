import httpx
from fastapi import APIRouter, HTTPException, Query, status

from app.routers.deps import CurrentUser
from app.schemas.geocode import Place
from app.services.geocode import search_places

router = APIRouter(prefix="/geocode", tags=["geocode"])


@router.get("/search", response_model=list[Place])
async def search(
    _: CurrentUser,
    q: str = Query(max_length=200),
    limit: int = Query(default=6, ge=1, le=10),
) -> list[dict[str, object]]:
    """Autocomplete places inside the City of Chicago (the pilot area)."""
    if len(q.strip()) < 3:
        return []
    try:
        return await search_places(q, limit)
    except httpx.HTTPError:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Place search is unavailable right now. Try again shortly."
        ) from None
