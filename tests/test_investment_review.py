"""실제 검증 시세로 복기 장부·가정·종료 공개 경계를 확인한다."""
import copy
import json
import sqlite3
import uuid
from datetime import datetime, timedelta
from decimal import Decimal as D

import pytest
from fastapi.testclient import TestClient

from backend.app import main, mentor
from backend.app.engine import Engine, fresh, INITIAL, SPAN
from backend.app.interest import RATES, rate_at
from backend.app.investment_review import build_review, create_recap
from backend.app.market import Market, START, END

PLAN = {"cash": 30, "A": 42, "B": 28, "C": 0, "D": 0}


@pytest.fixture(scope="module")
def market():
    return Market()


def advance_to(e, s, at):
    s["status"] = "running"
    e.advance(s, (at-e.now(s)).total_seconds()/SPAN*300+1e-8)


def completed_game(market):
    e = Engine(market)
    e.guard = lambda s: None  # 테스트에서만 경고를 건너뛴다. 시각·시세는 실제 데이터를 유지한다.
    s = fresh(guided=True)
    e.start(s, PLAN)
    advance_to(e, s, START+timedelta(days=20))
    s["status"] = "paused"
    s["chat"].append({"id": "talk-1", "at": s["now"], "question": "손실을 확인하고 싶어요", "paragraphs": ["보유분을 확인해 보세요"], "status": "기록"})
    e.order(s, "A", "sell", percent=25)
    sell = e.choice(s, "trade", summary="코인 A 매도 주문을 승인했습니다.")
    advance_to(e, s, START+timedelta(days=22))
    s["status"] = "paused"
    e.choice(s, "hold", summary="현재 구성 유지")
    advance_to(e, s, START+timedelta(days=40))
    s["status"] = "paused"
    e.rebalance(s, {"cash": 50, "A": 15, "B": 20, "C": 15, "D": 0})
    rebalance = e.choice(s, "rebalance", summary="비중 조정 승인")
    advance_to(e, s, START+timedelta(days=42))
    s["status"] = "paused"
    e.order(s, "B", "buy", amount=1000000)
    e.choice(s, "trade", summary="추가 매수 승인")
    advance_to(e, s, END)
    return e, s, sell["id"], rebalance["id"]


def test_review_reconciles_ledger_and_is_read_only(market):
    e, s, sell_id, rebalance_id = completed_game(market)
    before = copy.deepcopy(s)
    r = build_review(s, market)
    assert s == before
    assert D(r["final_nav"]) == e.nav(s)
    assert abs(D(r["net_profit"])-D(r["trading_profit"])-D(r["interest"])) < D("1e-16")
    assert abs(sum((D(a["total_pnl"]) for a in r["assets"]), D(0))-D(r["trading_profit"])) < D("1e-16")
    sell = next(d for d in r["decisions"] if d["id"] == sell_id)
    rebalance = next(d for d in r["decisions"] if d["id"] == rebalance_id)
    assert len(sell["fills"]) == 1 and sell["fills"][0]["side"] == "sell"
    assert len(sell["discussions"]) == 1
    assert D(sell["realized_pnl"]) == D(sell["fills"][0]["realized_pnl"])
    assert len(rebalance["fills"]) >= 3
    assert all(t["decision_id"] == rebalance_id for t in s["trades"] if t["reason"] == "rebalance")
    assert {f["id"] for d in r["decisions"] for f in d["fills"]} == {f"fill-{i}" for i in range(len(s["trades"]))}
    assert all(d["linkage"] == "recorded" for d in r["decisions"])
    # 선택 사이의 전체 변화는 합산 가능하지만, 선택별 가정 차이는 합산하지 않는다.
    assert abs(sum((D(d["period"]["change"]) for d in r["decisions"]), D(0))-D(r["net_profit"])) < D("1e-15")


def test_isolated_comparison_includes_cash_interest_fees_and_final_marks(market):
    _, s, _, _ = completed_game(market)
    r = build_review(s, market)
    for d in r["decisions"]:
        if not d["comparison"]:
            continue
        at = datetime.fromisoformat(d["comparison"]["at"])
        boundaries = [at]+[day for day, _ in RATES if at < day < END]+[END]
        interest_factor = sum((rate_at(a)/100*D(str((b-a).total_seconds()))/D(31536000)
                               for a, b in zip(boundaries, boundaries[1:])), D(0))
        cash_flow = sum((D(f["cash_flow"]) for f in d["fills"]), D(0))
        expected = cash_flow*(1+interest_factor)+sum((D(f["quantity"])*market.quote(f["asset"], END)*(1 if f["side"] == "buy" else -1)
                                                    for f in d["fills"]), D(0))
        assert abs(D(d["comparison"]["difference"])-expected) < D("1e-16")
        assert D(d["comparison"]["acted"])-D(d["comparison"]["unchanged"]) == D(d["comparison"]["difference"])


@pytest.mark.parametrize("plan", [PLAN, {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}])
def test_initial_hold_comparison_matches_real_ledger_with_interest(market, plan):
    e = Engine(market)
    e.guard = lambda s: None
    s = fresh(guided=True)
    e.start(s, plan)
    e.advance(s, 300)
    r = build_review(s, market)
    assert abs(D(r["baseline"]["difference"])) < D("1e-17")
    assert r["baseline"]["interest"] == s["interest"]
    assert r["baseline"]["fees"] == s["fees"]
    assert r["history"][-1]["value"] == float(e.nav(s))
    assert r["decisions"][0]["comparison"] is None


def test_old_sessions_are_not_falsely_linked(market):
    _, s, _, _ = completed_game(market)
    for c in s["choices"]:
        for k in ("id", "snapshot", "order", "chat_ids"):
            c.pop(k, None)
    for t in s["trades"]:
        t.pop("decision_id", None)
    r = build_review(s, market)
    assert all(not d["fills"] and not d["discussions"] and d["nav"] is None for d in r["decisions"] if d["linkage"] == "legacy")
    assert sum(len(d["fills"]) for d in r["decisions"] if d["linkage"] == "fills_only") == len(s["trades"])
    s["initial_plan"] = None
    assert build_review(s, market)["baseline"] is None


@pytest.fixture
def client(monkeypatch, tmp_path):
    db = sqlite3.connect(tmp_path/"review.sqlite3", check_same_thread=False)
    db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "anchors", {})
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with TestClient(main.app) as c:
        yield c
    db.close()


def test_finished_only_api_recap_cache_and_public_allowlist(client, market, monkeypatch):
    g = client.post("/api/guided-sessions").json()
    url = f"/api/sessions/{g['id']}"
    for state in (fresh(guided=True), {**fresh(guided=True), "status": "paused"}):
        main.save(g["id"], state)
        assert client.get(url+"/review").status_code == 400
        assert client.post(url+"/review/recap").status_code == 400
    _, s, _, _ = completed_game(market)
    s["trades"][0]["PRIVATE_SENTINEL"] = "never expose"
    s["choices"][0]["PRIVATE_SENTINEL"] = "never expose"
    main.save(g["id"], s)
    public = client.get(url).json()
    assert "snapshot" not in public["choices"][0]
    assert "PRIVATE_SENTINEL" not in json.dumps(public)
    before = main.db.execute("SELECT state FROM sessions WHERE id=?", (g["id"],)).fetchone()[0]
    r = client.get(url+"/review")
    assert r.status_code == 200 and "PRIVATE_SENTINEL" not in r.text
    assert main.db.execute("SELECT state FROM sessions WHERE id=?", (g["id"],)).fetchone()[0] == before
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-token")
    calls = []
    def generate(*args, **kwargs):
        calls.append(1)
        return {"fact_ids": ["total", "baseline"], "question_ids": ["process"]}
    monkeypatch.setattr(mentor, "generate", generate)
    a = client.post(url+"/review/recap").json()
    b = client.post(url+"/review/recap").json()
    assert a == b and a["source"] == "ai" and len(calls) == 1
    assert client.get(url+"/review").json()["recap"] == a
    saved = main.load(g["id"])
    assert all(saved[k] == s[k] for k in ("now", "elapsed", "trades", "cash", "holdings", "fees", "interest", "choices"))


def test_recap_does_not_publish_invented_facts(market, monkeypatch):
    _, s, _, _ = completed_game(market)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-token")
    monkeypatch.setattr(mentor, "generate", lambda *a, **kw: {"fact_ids": ["total", "invented_profit"], "question_ids": ["process"]})
    recap = create_recap(build_review(s, market))
    assert recap["source"] == "records" and "invented_profit" not in json.dumps(recap)


def test_cancelled_initial_order_stays_unfilled_and_baseline_remains_plan(client, market):
    g = client.post("/api/guided-sessions").json()
    sid = g["id"]
    e = Engine(market)
    s = fresh(guided=True)
    e.start(s, PLAN)
    s["status"] = "paused"
    main.save(sid, s)
    r = client.post(f"/api/sessions/{sid}/cancel")
    assert r.status_code == 200 and r.json()["choices"][0]["cancelled"]
    s = main.load(sid)
    e.guard = lambda s: None
    advance_to(e, s, END)
    review = build_review(s, market)
    assert review["decisions"][0]["cancelled"] and not review["decisions"][0]["fills"]
    assert review["baseline"] and D(review["fees"]) == 0


def test_approved_order_links_next_open_and_excludes_internal_snapshots(client, market):
    g = client.post("/api/guided-sessions").json()
    sid = g["id"]
    e = Engine(market)
    e.guard = lambda s: None
    s = fresh(guided=True)
    e.start(s, PLAN)
    advance_to(e, s, START+timedelta(days=10))
    s["status"] = "paused"
    main.save(sid, s)
    response = client.post(f"/api/sessions/{sid}/approved-order", json={"kind": "trade", "asset": "A", "side": "sell", "percent": 20})
    assert response.status_code == 200
    public = response.json()
    assert "snapshot" not in json.dumps(public)
    saved = main.load(sid)
    choice = saved["choices"][-1]
    assert saved["pending"]["decision_id"] == choice["id"]
    assert datetime.fromisoformat(saved["pending"]["at"]) > datetime.fromisoformat(choice["at"])
    assert choice["snapshot"]["holdings"] == saved["holdings"]
    advance_to(e, saved, END)
    review = build_review(saved, market)
    detail = next(d for d in review["decisions"] if d["id"] == choice["id"])
    assert len(detail["fills"]) == 1
    fill = detail["fills"][0]
    assert D(fill["price"]) == market.open_price("A", datetime.fromisoformat(fill["at"]))


def test_discussion_links_do_not_repeat_or_claim_legacy_history(market):
    e = Engine(market)
    s = fresh(guided=True)
    e.start(s, {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0})
    s["chat"] = [{"id": "first", "at": s["now"]}]
    first = e.choice(s, "hold")
    assert first["chat_ids"] == ["first"]
    s["chat"].append({"id": "second", "at": s["now"]})
    assert e.choice(s, "hold")["chat_ids"] == ["second"]
    assert e.choice(s, "hold")["chat_ids"] == []
    s["choices"] = [{"at": s["now"], "action": "hold"}]
    assert e.choice(s, "hold")["chat_ids"] == []
