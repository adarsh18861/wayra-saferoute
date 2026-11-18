from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.services import geocode


@pytest.fixture()
def auth_headers(client: TestClient) -> dict[str, str]:
    r = client.post(
        "/api/auth/register",
        json={"name": "Asha", "email": "asha@example.com", "password": "s3cure-pass"},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_geocode_requires_auth(client: TestClient) -> None:
    assert client.get("/api/geocode/search", params={"q": "Navy Pier"}).status_code == 401


def test_geocode_short_query_returns_empty(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.get("/api/geocode/search", params={"q": "ab"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == []


def test_geocode_keeps_only_chicago_results(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake_fetch(query: str, limit: int) -> list[dict[str, Any]]:
        return [
            {"display_name": "Navy Pier, Chicago", "lat": "41.8917", "lon": "-87.6086"},
            {"display_name": "Somewhere in Evanston", "lat": "42.0451", "lon": "-87.6877"},
        ]

    monkeypatch.setattr(geocode, "_fetch", fake_fetch)
    geocode._cache.clear()
    r = client.get("/api/geocode/search", params={"q": "pier test"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == [{"name": "Navy Pier, Chicago", "lat": 41.8917, "lon": -87.6086}]
