from typing import Any

from fastapi.testclient import TestClient


def auth(client: TestClient, email: str = "asha@example.com", name: str = "Asha Rao") -> dict[str, str]:
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": "s3cure-pass"})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


MOM: dict[str, Any] = {"name": "Mom", "relation": "Mother", "phone": "+1 312 555 0100", "email": "mom@example.com"}


def test_contacts_need_auth(client: TestClient) -> None:
    assert client.get("/api/contacts").status_code == 401
    assert client.post("/api/contacts", json=MOM).status_code == 401


def test_add_list_edit_delete(client: TestClient) -> None:
    h = auth(client)
    r = client.post("/api/contacts", json=MOM, headers=h)
    assert r.status_code == 201
    c = r.json()
    assert c["name"] == "Mom" and c["relation"] == "Mother" and len(c["watch_token"]) >= 20
    assert [x["id"] for x in client.get("/api/contacts", headers=h).json()] == [c["id"]]

    r = client.put(f"/api/contacts/{c['id']}", json={**MOM, "name": "Mum", "email": ""}, headers=h)
    assert r.status_code == 200
    assert r.json()["name"] == "Mum" and r.json()["email"] is None
    assert r.json()["watch_token"] == c["watch_token"]  # editing keeps the link

    assert client.delete(f"/api/contacts/{c['id']}", headers=h).status_code == 204
    assert client.get("/api/contacts", headers=h).json() == []


def test_validation(client: TestClient) -> None:
    h = auth(client)
    assert client.post("/api/contacts", json={"name": "  "}, headers=h).status_code == 422
    assert client.post("/api/contacts", json={"name": "X"}, headers=h).status_code == 422  # no phone/email
    assert client.post("/api/contacts", json={"name": "X", "phone": "call me"}, headers=h).status_code == 422
    assert client.post("/api/contacts", json={"name": "X", "email": "nope"}, headers=h).status_code == 422
    assert client.post("/api/contacts", json={"name": "X", "phone": "+91 98765 43210"}, headers=h).status_code == 201
    assert client.post("/api/contacts", json={"name": "Y", "email": "y@example.com"}, headers=h).status_code == 201


def test_max_five_contacts(client: TestClient) -> None:
    h = auth(client)
    for i in range(5):
        assert client.post("/api/contacts", json={"name": f"C{i}", "phone": f"+1312555010{i}"}, headers=h).status_code == 201
    r = client.post("/api/contacts", json={"name": "C6", "phone": "+13125550109"}, headers=h)
    assert r.status_code == 409 and "5" in r.json()["detail"]


def test_users_cannot_touch_each_others_contacts(client: TestClient) -> None:
    a, b = auth(client), auth(client, "bea@example.com", "Bea")
    c = client.post("/api/contacts", json=MOM, headers=a).json()
    assert client.get("/api/contacts", headers=b).json() == []
    assert client.put(f"/api/contacts/{c['id']}", json=MOM, headers=b).status_code == 404
    assert client.delete(f"/api/contacts/{c['id']}", headers=b).status_code == 404
    assert client.post(f"/api/contacts/{c['id']}/reset-link", headers=b).status_code == 404


def test_reset_link_invalidates_old_watch_link(client: TestClient) -> None:
    h = auth(client)
    c = client.post("/api/contacts", json=MOM, headers=h).json()
    assert client.get(f"/api/watch/{c['watch_token']}").status_code == 200
    new = client.post(f"/api/contacts/{c['id']}/reset-link", headers=h).json()
    assert new["watch_token"] != c["watch_token"]
    assert client.get(f"/api/watch/{c['watch_token']}").status_code == 404
    assert client.get(f"/api/watch/{new['watch_token']}").status_code == 200
