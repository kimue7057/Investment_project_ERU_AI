import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from backend.app import main


@pytest.fixture
def client(monkeypatch, tmp_path):
    db = sqlite3.connect(tmp_path / "test.sqlite3", check_same_thread=False)
    db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "anchors", {})
    with TestClient(main.app) as c:
        yield c
    db.close()


def test_api_only_accepts_aliases_and_server_owned_time(client):
    s = client.post("/api/sessions").json()
    url = f"/api/sessions/{s['id']}"
    assert s["cash"] == 100000000
    assert client.get(url + "?asset=BTC").status_code == 400
    assert client.get(url + "?now=2026-08-05").json()["now"] == s["now"]
    assert client.post(url + "/start", json={"weights": {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}, "now": "2026-08-05"}).status_code == 422
    assert client.post(url + "/start", json={"weights": {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}}).status_code == 200
    assert client.post(url + "/pause", json={}).json()["status"] == "paused"
    paused = client.get(url).json()
    assert client.get(url).json()["now"] == paused["now"]
    assert client.post(url + "/start", json={"weights": {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}}).status_code == 400


def test_targets_do_not_trade_or_add_cash(client):
    s = client.post("/api/sessions").json()
    r = client.post(f"/api/sessions/{s['id']}/targets", json={"weights": {"cash": 0, "A": 100, "B": 0, "C": 0, "D": 0}}).json()
    assert r["cash"] == s["cash"] and r["trades"] == [] and r["pending"] is None


def test_no_static_private_file_routes(client):
    for path in ["/data/normalized/A_upbit_ohlcv_daily.csv", "/data/sources/source_events_PRIVATE.json", "/archive/ERU_AI_Investment_Simulator_V2/config/asset_map_PRIVATE.json"]:
        assert client.get(path).status_code == 404
    assert "private_source_url" not in json.dumps(client.get("/api/catalog").json())


def test_cross_origin_and_host_are_rejected(client):
    assert client.post("/api/sessions", headers={"Origin": "https://attacker.example"}).status_code == 403
    assert client.get("/api/catalog", headers={"Host": "attacker.example"}).status_code == 403


def test_restart_pauses_and_sessions_persist(client):
    s = client.post("/api/sessions").json()
    url = f"/api/sessions/{s['id']}"
    client.post(url + "/start", json={"weights": {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}})
    main.anchors.clear()
    assert client.get(url).json()["status"] == "paused"
    assert client.get(url).json()["cash"] == 100000000
