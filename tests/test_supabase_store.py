"""Supabase 연결 경계와 동시 수정 손실 방지 검증. 실제 DB 검증은 별도로 수행한다."""
import json
import uuid

import httpx
import pytest

from backend.app import main
from backend.app.blob_store import StorageConflict
from backend.app.supabase_store import SupabaseREST, SupabaseSessions


SID = str(uuid.uuid4())


def make_store(handler, environment="production"):
    rest = SupabaseREST(url="https://example.supabase.co", key="sb_secret_test_only",
                        client=httpx.Client(transport=httpx.MockTransport(handler)))
    return SupabaseSessions(rest=rest, environment=environment)


def test_secret_header_and_private_environment_scoped_read():
    def handler(request):
        assert request.headers["apikey"] == "sb_secret_test_only"
        assert "authorization" not in request.headers
        assert request.url.path == "/rest/v1/eru_game_sessions"
        assert request.url.params["environment"] == "eq.production"
        assert request.url.params["id"] == "eq." + SID
        assert request.url.params["select"] == "state,last_seen,revision"
        return httpx.Response(200, json=[{"state": {"cash": "100000000.00000001"},
                                        "last_seen": 1234.5, "revision": 8}])
    envelope, revision = make_store(handler).read(SID)
    assert envelope == {"state": {"cash": "100000000.00000001"}, "last_seen": 1234.5}
    assert revision == "8"


def test_revision_update_conflict_cannot_overwrite_newer_state():
    writes = []
    def handler(request):
        assert request.method == "PATCH"
        assert request.headers["prefer"] == "return=representation"
        assert request.url.params["revision"] == "eq.8"
        assert request.url.params["select"] == "revision"
        assert json.loads(request.content) == {"state": {"cash": "42.12"},
                                              "last_seen": 555, "revision": 9}
        writes.append(request)
        return httpx.Response(200, json=[{"revision": 9}] if len(writes) == 1 else [])
    store = make_store(handler)
    store.write(SID, {"cash": "42.12"}, 555, "8")
    with pytest.raises(StorageConflict):
        store.write(SID, {"cash": "42.12"}, 555, "8")


def test_create_is_insert_only_and_duplicate_id_is_conflict():
    def handler(request):
        assert request.method == "POST" and "prefer" not in request.headers
        assert not request.url.query
        assert json.loads(request.content) == {"id": SID, "environment": "preview",
            "state": {"status": "ready"}, "last_seen": 1000, "revision": 1}
        return httpx.Response(409, json={"code": "23505"})
    with pytest.raises(StorageConflict):
        make_store(handler, "preview").write(SID, {"status": "ready"}, 1000)


def test_missing_session_is_distinct_from_provider_failure():
    assert make_store(lambda _: httpx.Response(200, json=[])).read(SID) is None
    with pytest.raises(httpx.HTTPStatusError):
        make_store(lambda _: httpx.Response(403, json={"code": "42501"})).read(SID)
    with pytest.raises(httpx.HTTPStatusError):
        make_store(lambda _: httpx.Response(404, json={"code": "PGRST205"})).read(SID)


def test_probe_reads_only_one_id_and_never_writes():
    def handler(request):
        assert request.method == "GET"
        assert dict(request.url.params) == {"select": "id", "environment": "eq.production", "limit": "1"}
        return httpx.Response(200, json=[])
    make_store(handler).probe()


def test_account_list_is_owner_and_environment_scoped():
    owner = str(uuid.uuid4())
    def handler(request):
        assert request.url.params["environment"] == "eq.production"
        assert request.url.params["state->>owner_id"] == "eq."+owner
        assert request.url.params["state->>mode"] == "eq.guided"
        assert request.url.params["offset"] == "20" and request.url.params["limit"] == "21"
        return httpx.Response(200, json=[])
    store = make_store(handler)
    assert store.list_owned(owner, 20) == []
    with pytest.raises(ValueError):
        store.list_owned(owner+",state.gt.0")


def test_rejects_filter_injection_and_public_keys():
    store = make_store(lambda _: pytest.fail("Invalid identifiers must not be sent"))
    for sid in ("../../eru_market_bundles", SID + ",id.gt.0", ""):
        with pytest.raises(ValueError):
            store.read(sid)
    for revision in ("0", "-1", "8,revision.gt.0"):
        with pytest.raises(ValueError):
            store.write(SID, {}, 1000, revision)
    for key in ("sb_publishable_test", "anon", "sb_secret_a\nb"):
        with pytest.raises(ValueError):
            SupabaseREST(url="https://example.supabase.co", key=key)
    for url in ("http://example.supabase.co", "https://a:b@example.supabase.co", "https://example.supabase.co/path"):
        with pytest.raises(ValueError):
            SupabaseREST(url=url, key="sb_secret_test")


def test_partial_supabase_configuration_cannot_fall_back_to_blob(monkeypatch):
    monkeypatch.setattr(main, "IS_CLOUD", True)
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_testid_test")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    assert main.configure_cloud_store() is None
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "sb_secret_test")
    store = main.configure_cloud_store()
    assert isinstance(store, SupabaseSessions)
    monkeypatch.setattr(main, "cloud_store", None)
    assert main.health().status_code == 503
