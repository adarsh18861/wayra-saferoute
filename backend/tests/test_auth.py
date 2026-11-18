from typing import Any

from fastapi.testclient import TestClient
from httpx import Response

USER = {"name": "Asha", "email": "asha@example.com", "password": "s3cure-pass"}


def register(client: TestClient, **overrides: Any) -> Response:
    return client.post("/api/auth/register", json={**USER, **overrides})


def login(client: TestClient, email: str, password: str) -> Response:
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_register_returns_token_and_user(client: TestClient) -> None:
    r = register(client)
    assert r.status_code == 201
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["name"] == "Asha"
    assert body["user"]["email"] == "asha@example.com"
    assert "password" not in body["user"] and "hashed_password" not in body["user"]


def test_register_validates_input(client: TestClient) -> None:
    assert register(client, email="not-an-email").status_code == 422
    assert register(client, password="short").status_code == 422
    assert register(client, name="   ").status_code == 422


def test_register_duplicate_email(client: TestClient) -> None:
    assert register(client).status_code == 201
    r = register(client, email="ASHA@example.com", name="Someone else")
    assert r.status_code == 409
    assert r.json()["detail"] == "An account with this email already exists"


def test_login_success(client: TestClient) -> None:
    register(client)
    r = login(client, "Asha@Example.com", USER["password"])
    assert r.status_code == 200
    assert r.json()["access_token"]
    assert r.json()["user"]["email"] == "asha@example.com"


def test_login_wrong_password(client: TestClient) -> None:
    register(client)
    r = login(client, USER["email"], "wrong-password")
    assert r.status_code == 401
    assert r.json()["detail"] == "Incorrect email or password"


def test_login_unknown_email(client: TestClient) -> None:
    r = login(client, "nobody@example.com", "whatever-123")
    assert r.status_code == 401
    assert r.json()["detail"] == "Incorrect email or password"


def test_me_with_token(client: TestClient) -> None:
    token = register(client).json()["access_token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json() == {"id": 1, "name": "Asha", "email": "asha@example.com"}


def test_me_rejects_missing_or_bad_token(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401
