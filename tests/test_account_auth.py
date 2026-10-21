"""인증/소유권 경계는 우회 없이 테스트한다. 메일 공급자의 HTTP만 대체한다."""
import base64
import copy
import json
import sqlite3
import time
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.account_auth import AccountAuth, ACCESS_COOKIE, REFRESH_COOKIE
from backend.app.supabase_store import SupabaseREST, SupabaseSessions
from backend.app.blob_store import StorageConflict
from backend.app.engine import Engine, fresh
from backend.app.market import START, END

ALICE = "11111111-1111-4111-8111-111111111111"
BOB = "22222222-2222-4222-8222-222222222222"


def jwt(label, expired=False):
    payload = base64.urlsafe_b64encode(json.dumps({"exp": time.time()+(-60 if expired else 3600), "test": label}).encode()).decode().rstrip("=")
    return "header."+payload+".signature"


class AuthProvider:
    def __init__(self):
        self.tokens = {}
        self.refreshes = {}
        self.calls = []

    def issue(self, email):
        token = jwt(email+str(len(self.tokens)))
        refresh = "refresh-"+str(len(self.tokens))
        user = {"id": ALICE if email.startswith("alice") else BOB, "email": email,
                "email_confirmed_at": "2026-10-21T00:00:00Z", "is_anonymous": False}
        self.tokens[token] = user
        self.refreshes[refresh] = email
        return {"access_token": token, "refresh_token": refresh, "expires_in": 3600}

    def handler(self, request):
        path = request.url.path
        body = json.loads(request.content or "{}")
        self.calls.append(path)
        assert request.headers["apikey"] == "sb_secret_test"
        if path.endswith("/otp"):
            assert body["create_user"] is True
            return httpx.Response(200, json={})
        if path.endswith("/verify"):
            if body["token"] != "123456":
                return httpx.Response(403, json={"code": "otp_expired", "message": "PRIVATE provider text"})
            return httpx.Response(200, json=self.issue(body["email"]))
        if path.endswith("/token"):
            email = self.refreshes.pop(body.get("refresh_token"), None)
            return httpx.Response(200, json=self.issue(email)) if email else httpx.Response(401, json={"code": "invalid_token"})
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if path.endswith("/user"):
            return httpx.Response(200, json=self.tokens[token]) if token in self.tokens else httpx.Response(401, json={"code": "invalid_token"})
        if path.endswith("/logout"):
            return httpx.Response(204)
        raise AssertionError(path)


@pytest.fixture
def auth_app(monkeypatch, tmp_path):
    db = sqlite3.connect(tmp_path/"accounts.sqlite3", check_same_thread=False)
    db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
    provider = AuthProvider()
    service = AccountAuth(SupabaseREST(url="https://auth.example.test", key="sb_secret_test", client=httpx.Client(transport=httpx.MockTransport(provider.handler))))
    monkeypatch.setattr(main, "auth_service", service)
    monkeypatch.setattr(main, "IS_CLOUD", False)
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "anchors", {})
    with TestClient(main.app) as client:
        yield client, provider, service
    db.close()


def login(client, email="alice@example.test"):
    r = client.post("/api/auth/verify", json={"email": email, "code": "123456"})
    assert r.status_code == 200
    return r


def create(client):
    r = client.post("/api/guided-sessions", json={})
    assert r.status_code == 200
    return r.json()


def test_all_game_routes_require_email_authentication(auth_app):
    c, _, _ = auth_app
    assert c.get("/api/auth/session").json()["user"] is None
    sid = "33333333-3333-4333-8333-333333333333"
    for method, path in [("POST", "/api/guided-sessions"), ("POST", "/api/sessions"), ("POST", "/api/paper-sessions"),
                         ("GET", "/api/account/games"), ("GET", f"/api/sessions/{sid}"),
                         ("GET", f"/api/sessions/{sid}/review"), ("POST", f"/api/sessions/{sid}/review/recap")]:
        assert c.request(method, path, json={} if method == "POST" else None).status_code == 401
    assert c.get("/api/catalog").status_code == 200


def test_email_code_cookie_login_and_no_token_in_body(auth_app):
    c, provider, _ = auth_app
    assert c.post("/api/auth/send-code", json={"email": " Alice@example.test "}).status_code == 200
    assert c.post("/api/auth/verify", json={"email": "alice@example.test", "code": "000000"}).status_code == 400
    r = login(c)
    assert r.json()["user"]["id"] == ALICE
    assert set(r.json()) == {"user"}
    cookies = r.headers.get_list("set-cookie")
    assert len(cookies) == 2 and all("HttpOnly" in s and "SameSite=lax" in s for s in cookies)
    assert c.get("/api/auth/session").json()["user"]["email"] == "alice@example.test"
    assert len([p for p in provider.calls if p.endswith("/user")]) == 1
    assert "PRIVATE" not in c.post("/api/auth/verify", json={"email": "alice@example.test", "code": "000000"}).text


def test_ownership_before_clock_and_private_results(auth_app):
    c, _, _ = auth_app
    login(c)
    game = create(c)
    sid = game["id"]
    assert "owner_id" not in json.dumps(game)
    c.post(f"/api/sessions/{sid}/start", json={"weights": {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}})
    before = main.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()[0]
    login(c, "bob@example.test")
    for method, suffix, body in [("GET", "", None), ("GET", "/review", None), ("POST", "/pause", {}),
                                ("POST", "/leave", {}), ("POST", "/approved-order", {"kind": "hold"}),
                                ("POST", "/review/recap", {}), ("POST", "/chat", {"request_id": "11111111-1111-4111-8111-111111111111", "question": "안녕", "asset": "A", "draft": {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}})]:
        assert c.request(method, f"/api/sessions/{sid}"+suffix, json=body).status_code == 404
    assert main.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()[0] == before
    assert not c.get("/api/account/games").json()["games"]
    login(c)
    records = c.get("/api/account/games").json()
    assert records["games"][0]["id"] == sid
    assert not any(k in records["games"][0] for k in ("owner_id", "trades", "chat", "identities", "history"))


def test_owner_is_never_accepted_from_client_and_old_games_remain_private(auth_app):
    c, _, _ = auth_app
    login(c)
    assert c.post("/api/guided-sessions", json={"owner_id": BOB}).status_code == 422
    old = "33333333-3333-4333-8333-333333333333"
    main.save(old, fresh(guided=True))
    assert c.get(f"/api/sessions/{old}").status_code == 404
    assert c.get("/api/account/games").json()["games"] == []


def test_refresh_logout_and_pause_preserve_orders(auth_app):
    c, provider, service = auth_app
    login(c)
    g = create(c)
    sid = g["id"]
    c.post(f"/api/sessions/{sid}/start", json={"weights": {"cash": 30, "A": 70, "B": 0, "C": 0, "D": 0}})
    c.cookies.delete(ACCESS_COOKIE)
    r = c.get("/api/auth/session")
    assert r.status_code == 200 and r.json()["user"]["id"] == ALICE
    assert any(p.endswith("/token") for p in provider.calls)
    before = json.loads(main.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()[0])
    assert c.post("/api/auth/logout", json={"session_id": sid}).status_code == 200
    after = json.loads(main.db.execute("SELECT state FROM sessions WHERE id=?", (sid,)).fetchone()[0])
    assert after["status"] == "paused" and after["pending"] == before["pending"]
    assert ACCESS_COOKIE not in c.cookies and REFRESH_COOKIE not in c.cookies
    assert c.get(f"/api/sessions/{sid}").status_code == 401
    login(c)
    assert c.get(f"/api/sessions/{sid}").json()["status"] == "paused"


def test_leave_and_new_game_do_not_delete_history(auth_app):
    c, _, _ = auth_app
    login(c)
    first = create(c)
    c.post(f"/api/sessions/{first['id']}/start", json={"weights": {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}})
    second = c.post("/api/guided-sessions", json={"previous_id": first["id"]}).json()
    assert second["id"] != first["id"]
    assert c.get(f"/api/sessions/{first['id']}").json()["status"] == "paused"
    assert len(c.get("/api/account/games").json()["games"]) == 2
    assert c.post(f"/api/sessions/{second['id']}/leave", json={}).status_code == 200


def test_draft_persists_without_orders_and_is_owner_scoped(auth_app):
    c, _, _ = auth_app
    login(c)
    g = create(c)
    sid = g["id"]
    draft = {"version": 2, "phase": "assets", "profile": "balanced", "cash": "30",
             "coins": ["A", "B"], "shares": {"A": "60", "B": "40", "C": "0", "D": "0"}}
    response = c.post(f"/api/sessions/{sid}/setup-draft", json=draft)
    assert response.status_code == 200 and response.json()["setup_draft"] == draft
    assert not response.json()["trades"] and response.json()["elapsed"] == 0
    assert response.json()["cash"] == 100000000
    assert c.get(f"/api/sessions/{sid}").json()["setup_draft"] == draft
    login(c, "bob@example.test")
    assert c.post(f"/api/sessions/{sid}/setup-draft", json=draft).status_code == 404
    login(c)
    assert c.post(f"/api/sessions/{sid}/setup-draft", json={**draft, "owner_id": BOB}).status_code == 422
    c.post(f"/api/sessions/{sid}/start", json={"weights": {"cash": 30, "A": 42, "B": 28, "C": 0, "D": 0}})
    assert c.post(f"/api/sessions/{sid}/setup-draft", json=draft).status_code == 400


def test_forged_or_unverified_identity_is_rejected(auth_app):
    c, provider, _ = auth_app
    c.cookies.set(ACCESS_COOKIE, jwt("forged"))
    assert c.post("/api/guided-sessions", json={}).status_code == 401
    tokens = provider.issue("alice@example.test")
    provider.tokens[tokens["access_token"]]["email_confirmed_at"] = None
    c.cookies.set(ACCESS_COOKIE, tokens["access_token"])
    assert c.post("/api/guided-sessions", json={}).status_code == 401
    assert c.get("/api/auth/session").json()["user"] is None


def test_auth_origin_validation_and_secure_cookies(auth_app):
    c, _, _ = auth_app
    assert c.post("/api/auth/send-code", headers={"Origin": "https://other.invalid"}, json={"email": "alice@example.test"}).status_code == 403
    with TestClient(main.app, base_url="https://testserver") as https:
        response = login(https)
        assert all("Secure" in s for s in response.headers.get_list("set-cookie"))


def test_provider_outage_is_not_treated_as_a_bad_code_or_expired_login(auth_app):
    c, provider, service = auth_app
    tokens = provider.issue("alice@example.test")
    c.cookies.set(ACCESS_COOKIE, tokens["access_token"])
    service.rest.client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(503, json={"message": "PRIVATE provider text"})))
    for method, path, body in [("GET", "/api/auth/session", None),
                               ("POST", "/api/auth/verify", {"email": "alice@example.test", "code": "123456"})]:
        response = c.request(method, path, json=body)
        assert response.status_code == 503 and "PRIVATE" not in response.text
    assert c.cookies.get(ACCESS_COOKIE) == tokens["access_token"]


class OwnedCloud(SupabaseSessions):
    def __init__(self):
        self.records = {}

    def probe(self):
        pass

    def write(self, sid, state, wall_time, etag=None):
        old = self.records.get(sid)
        if old and etag != old[1]:
            raise StorageConflict()
        self.records[sid] = ({"state": copy.deepcopy(state), "last_seen": wall_time}, str(int(old[1])+1 if old else 1))

    def read(self, sid):
        return copy.deepcopy(self.records.get(sid))

    def list_owned(self, owner, offset=0):
        rows = [{"id": sid, **copy.deepcopy(record[0])} for sid, record in self.records.items() if record[0]["state"].get("owner_id") == owner]
        return rows[offset:offset+21]


def test_cloud_owner_boundary_and_completed_review(auth_app, monkeypatch):
    c, _, _ = auth_app
    store = OwnedCloud()
    monkeypatch.setattr(main, "IS_CLOUD", True)
    monkeypatch.setattr(main, "cloud_store", store)
    # 실제 배포는 HTTPS 쿠키이므로 이 검증도 HTTPS를 사용한다.
    with TestClient(main.app, base_url="https://testserver") as client:
        login(client)
        g = create(client)
        sid = g["id"]
        raw, etag = store.read(sid)
        s = raw["state"]
        e = Engine(main.market)
        e.guard = lambda s: None
        e.start(s, {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0})
        e.advance(s, 300)
        store.write(sid, s, time.time(), etag)
        assert client.get(f"/api/sessions/{sid}/review").status_code == 200
        before = copy.deepcopy(store.records)
        login(client, "bob@example.test")
        assert client.get(f"/api/sessions/{sid}/review").status_code == 404
        assert store.records == before
        assert client.get("/api/account/games").json()["games"] == []
