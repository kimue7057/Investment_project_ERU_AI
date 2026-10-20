"""모의투자: 실제 과거 데이터로 수동 주문·공개 경계·종료를 검증한다."""
import json
import sqlite3
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.engine import Engine, fresh, INITIAL, FEE, SPAN
from backend.app.market import Market, START


@pytest.fixture(scope="module")
def engine():
    return Engine(Market())


def test_cash_start_and_no_system_pauses(engine, monkeypatch):
    s = fresh(paper=True)
    engine.play(s)
    assert s["pending"] is None and s["trades"] == [] and D(s["cash"]) == INITIAL
    monkeypatch.setattr(engine, "guard", lambda s: pytest.fail("모의투자에서 자동 신호를 실행하면 안 됩니다."))
    engine.advance(s, 300)
    assert s["status"] == "finished" and s["elapsed"] == 300
    assert s["alerts"] == [] and s["choices"] == []
    assert D(s["cash"]) == INITIAL
    assert engine.public(s)["identities"]


def test_exact_next_open_quantity_sell_and_fee(engine):
    s = fresh(paper=True)
    engine.play(s)
    s["status"] = "paused"
    engine.order(s, "A", "buy", amount="10000000")
    at = engine.market.next_open(START)
    assert not s["trades"] and s["pending"]["at"] == at.isoformat()
    s["status"] = "running"
    engine.advance(s, (at - START).total_seconds() / SPAN * 300 + 1e-7)
    assert len(s["trades"]) == 1 and D(s["cash"]) == INITIAL - D("10000000")
    trade = s["trades"][0]
    assert D(trade["price"]) == engine.market.open_price("A", at)
    assert abs(D(trade["gross"]) + D(trade["fee"]) - D("10000000")) < D("0.000001")
    held = D(s["holdings"]["A"])
    s["status"] = "paused"
    engine.order(s, "A", "sell", quantity=str(held / 4))
    assert D(s["pending"]["quantity"]) == held / 4
    second = engine.market.next_open(engine.now(s))
    s["status"] = "running"
    engine.advance(s, (second - engine.now(s)).total_seconds() / SPAN * 300 + 1e-7)
    assert D(s["holdings"]["A"]) == held * D(".75")
    sell = s["trades"][-1]
    assert D(sell["fee"]) == D(sell["gross"]) * FEE


@pytest.mark.parametrize("quantity", ["NaN", "Infinity", "-1", "0", "1000000000000"])
def test_invalid_sell_quantity_cannot_change_ledger(engine, quantity):
    s = fresh(paper=True)
    engine.play(s)
    s["status"] = "paused"
    with pytest.raises(ValueError):
        engine.order(s, "A", "sell", quantity=quantity)
    assert s["pending"] is None and s["trades"] == [] and D(s["cash"]) == INITIAL


def test_paper_public_boundary_and_manual_pause(engine):
    s = fresh(paper=True)
    engine.play(s)
    engine.advance(s, 30)
    assert s["status"] == "running"
    p = engine.public(s)
    assert p["mode"] == "paper"
    assert not set(p) & {"research", "alerts", "choices", "targets", "guard", "identities"}
    text = json.dumps(p).lower()
    assert not any(v in text for v in ["bitcoin", "ethereum", "solana", "dogecoin", "source_url", "available_at"])
    s["status"] = "paused"
    before = s["now"]
    engine.advance(s, 100)
    assert s["now"] == before


def test_paper_api_and_catalog(tmp_path, monkeypatch):
    db = sqlite3.connect(tmp_path / "paper.sqlite3", check_same_thread=False)
    db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "anchors", {})
    with TestClient(main.app) as c:
        catalog = c.get("/api/catalog").json()
        assert [a["alias"] for a in catalog["assets"]] == list("ABCD")
        assert not catalog["research"]
        g = c.post("/api/paper-sessions", json={}).json()
        url = f"/api/sessions/{g['id']}"
        assert g["mode"] == "paper" and g["cash"] == 100000000
        assert c.post(url + "/play", json={}).json()["pending"] is None
        assert c.post(url + "/pause", json={}).json()["status"] == "paused"
        r = c.post(url + "/orders", json={"asset": "B", "side": "buy", "amount": 1000000})
        assert r.status_code == 200 and r.json()["pending"]["asset"] == "B"
        assert c.post(url + "/cancel", json={}).json()["pending"] is None
        assert c.post(url + "/orders", json={"asset": "B", "side": "sell", "quantity": "NaN"}).status_code == 400
        assert c.get(url + "?asset=B").json()["chart_asset"] == "B"
    db.close()
