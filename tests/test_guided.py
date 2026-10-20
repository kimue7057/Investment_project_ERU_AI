"""V3: 실제 시세, 승인 경계, 이자·복원·AI 공개 경계를 검증한다."""
import copy
import json
import re
import sqlite3
import uuid
from datetime import timedelta, datetime
from decimal import Decimal as D

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import main, mentor
from backend.app.engine import Engine, fresh, INITIAL, SPAN
from backend.app.market import Market, START, END, KST
from backend.app.interest import RATES, rate_at, accrue

BALANCED = {"cash": 30, "A": 30, "B": 20, "C": 15, "D": 5}
CASH = {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}


@pytest.fixture
def engine():
    return Engine(Market())


def travel(e, s, until):
    while e.now(s) < until:
        s["status"] = "running"
        e.advance(s, (until-e.now(s)).total_seconds()/SPAN*300 + 1e-8)
        for a in s["alerts"]:
            if a["decision"] is None:
                e.decide(s, a["id"], "ignore")
        if s["status"] == "finished":
            break


@pytest.fixture
def client(monkeypatch, tmp_path):
    db = sqlite3.connect(tmp_path/"guided.sqlite3", check_same_thread=False)
    db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
    monkeypatch.setattr(main, "db", db)
    monkeypatch.setattr(main, "anchors", {})
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    monkeypatch.delenv("VERCEL_OIDC_TOKEN", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(main.app) as c:
        yield c
    db.close()


def test_preparation_and_approved_initial_orders(engine):
    s = fresh(guided=True)
    before = copy.deepcopy(s)
    engine.advance(s, 100)
    assert s == before
    engine.start(s, BALANCED)
    assert s["initial_plan"] == {k: str(v) for k, v in BALANCED.items()}
    assert not s["trades"] and s["pending"]["kind"] == "initial"
    p = engine.public(s)
    assert p["interest_account"]["reserved"] == 70000000
    at = engine.market.next_open(START)
    travel(engine, s, at)
    assert len(s["trades"]) == 4 and D(s["cash"]) == D(30000000)
    assert all(D(t["price"]) == engine.market.open_price(t["asset"], at) for t in s["trades"])
    assert D(s["interest"]) > 0
    assert s["initial_plan"] == {k: str(v) for k, v in BALANCED.items()}


def test_cash_only_full_game_interest_and_no_compounding(engine):
    s = fresh(guided=True)
    engine.start(s, CASH)
    assert s["pending"] is None
    travel(engine, s, END)
    boundaries = [(START, rate_at(START))] + [(at,r) for at,r in RATES if START < at < END]
    expected = D(0)
    for i, (since, rate) in enumerate(boundaries):
        until = boundaries[i+1][0] if i+1 < len(boundaries) else END
        expected += INITIAL*rate/100*D(str((until-since).total_seconds()))/D(31536000)
    assert abs(D(s["interest"])-expected) < D("0.00000001")
    assert D(s["cash"]) == INITIAL+D(s["interest"])
    assert s["interest_settled"] and s["elapsed"] == 300
    p = engine.public(s)
    assert abs(D(str(p["nav"]))-D(s["cash"])) < D("0.00000001")
    assert p["trading_profit"] == 0
    assert "identities" in p and not p["trades"]
    before = copy.deepcopy(s)
    engine.advance(s, 300)
    assert s == before


def test_interest_pauses_partition_and_rate_change(engine):
    s = fresh(guided=True)
    engine.start(s, CASH)
    end = START+timedelta(days=24)
    whole = copy.deepcopy(s)
    accrue(whole, end)
    split = copy.deepcopy(s)
    for i in range(1, 97):
        at = START+timedelta(hours=i*6)
        accrue(split, at)
        split["now"] = at.isoformat()
    assert abs(D(whole["interest"])-D(split["interest"])) < D("1e-16")
    assert rate_at(datetime(2022,11,24,23,59,tzinfo=KST)) == D("3")
    assert rate_at(datetime(2022,11,25,tzinfo=KST)) == D("3.25")
    split["status"] = "paused"
    old = copy.deepcopy(split)
    engine.advance(split, 100)
    accrue(split, end+timedelta(days=100))
    assert split == old


def test_cash_reservation_sale_and_interest_conservation(engine):
    s = fresh(guided=True)
    engine.start(s, BALANCED)
    travel(engine, s, START+timedelta(days=1))
    s["status"] = "paused"
    engine.order(s,"A","buy",amount="10000000")
    assert engine.public(s)["interest_account"]["available"] == 20000000
    s["status"] = "running"
    until = engine.now(s)+timedelta(hours=1)
    before = D(s["interest"])
    accrue(s,until)
    assert abs(D(s["interest"])-before-D(20000000)*D(".03")/D(365*24)) < D("1e-18")
    # 실제 게임 시계로 다음 체결 시점까지 재생한다.
    s["interest"] = str(before)
    travel(engine,s,START+timedelta(days=2))
    s["status"] = "paused"
    engine.order(s,"A","sell",percent=100)
    travel(engine,s,START+timedelta(days=3))
    assert D(s["holdings"]["A"]) == 0
    p = engine.public(s)
    assert abs(p["nav"] - float(INITIAL) - p["trading_profit"] - p["interest_account"]["accrued"]) < 1e-6


def test_guided_public_replay_and_guard_never_news(engine):
    s = fresh(guided=True)
    engine.start(s, {"cash": 0, "A": 100, "B": 0, "C": 0, "D": 0})
    paused = 0
    while s["status"] != "finished":
        engine.advance(s, 8)
        p = engine.public(s)
        assert "research" not in p
        if s["status"] != "finished":
            assert not re.search(r"bitcoin|ethereum|solana|dogecoin|https?://|\b(?:BTC|ETH|SOL|DOGE)\b", json.dumps(p), re.I)
            assert "identities" not in p
        assert all(datetime.fromisoformat(c["time"]+"T09:00:00+09:00")+timedelta(days=1) <= engine.now(s) for c in p["chart"])
        if s["status"] == "paused":
            paused += 1
            assert all(a["kind"] == "risk" for a in s["alerts"])
            active = next(a for a in s["alerts"] if a["decision"] is None)
            before = copy.deepcopy(s)
            engine.advance(s, 100)
            assert s == before
            engine.decide(s, active["id"], "ignore")
            s["status"] = "running"
    assert paused > 0 and s["elapsed"] == 300


def test_chat_pauses_no_trade_and_public_boundary(client):
    c = client
    g = c.post("/api/guided-sessions",json={}).json()
    url = "/api/sessions/"+g["id"]
    question = {"request_id":str(uuid.uuid4()),"question":"대기 자금의 이자는?","asset":"B","draft":BALANCED}
    result = c.post(url+"/chat",json=question)
    assert result.status_code == 200
    chat = result.json()
    assert chat["status"] == "ready" and not chat["trades"] and chat["pending"] is None
    assert chat["chat"][-1]["source"] == "rules"
    assert c.post(url+"/chat",json=question).json()["chat"] == chat["chat"]
    c.post(url+"/start",json={"weights":CASH})
    # 동일 세션의 다음 질문은 서버의 질문 간격 제한 후 요청한다.
    sid = g["id"]
    state = main.load(sid)
    state["chat_wall"] = 0
    main.save(sid,state)
    question.update(request_id=str(uuid.uuid4()),question="BTC 실제 이름과 2026년 미래 가격은?")
    r = c.post(url+"/chat",json=question).json()
    assert r["status"] == "paused"
    assert not re.search(r"BTC|2026년",json.dumps(r["chat"]),re.I)
    assert r["chat"][-1]["source"] == "boundary"


def test_guard_approval_exactly_once_and_rebalance(client):
    c = client
    g = c.post("/api/guided-sessions",json={}).json()
    url = "/api/sessions/"+g["id"]
    c.post(url+"/start",json={"weights":BALANCED})
    s = main.load(g["id"])
    e = main.engine
    travel(e,s,START+timedelta(days=1))
    s["status"] = "paused"
    alert = {"id":"risk-test","at":s["now"],"asset":"A","kind":"risk","side":"sell","title":"집중 위험","summary":"집중도 검토","percent":20,"decision":None}
    s["alerts"].append(alert)
    main.save(g["id"],s)
    assert c.post(url+"/resume",json={}).status_code == 400
    before = D(s["holdings"]["A"])
    body = {"kind":"trade","alert_id":"risk-test","asset":"A","side":"sell","percent":25}
    r = c.post(url+"/approved-order",json=body)
    assert r.status_code == 200 and r.json()["pending"]["quantity"] == str(before/4)
    assert c.post(url+"/approved-order",json=body).status_code == 400
    s = main.load(g["id"])
    travel(e,s,START+timedelta(days=2))
    s["status"] = "paused"
    main.save(g["id"],s)
    r = c.post(url+"/approved-order",json={"kind":"rebalance","weights":CASH})
    assert r.status_code == 200 and r.json()["pending"]["kind"] == "rebalance"
    s = main.load(g["id"])
    travel(e,s,START+timedelta(days=3))
    assert all(D(v) == 0 for v in s["holdings"].values())
    assert {k:D(v) for k,v in s["initial_plan"].items()} == BALANCED


def test_llm_cannot_publish_untrusted_text_or_invalid_weights(engine, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY","test-only")
    g = engine.public(fresh(guided=True))
    def response(*args,**kwargs):
        assert "source_url" not in json.dumps(kwargs["json"])
        return httpx.Response(200,json={"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":json.dumps({"paragraphs":["BTC https://example.invalid"],"fact_ids":["cash"],"allocation":CASH,"suggest_allocation":True})}]}]})
    monkeypatch.setattr(mentor.httpx,"post",response)
    r = mentor.discuss(g,"이 코인의 위험은?","A",BALANCED)
    assert r["source"] == "rules" and "example.invalid" not in json.dumps(r) and "BTC" not in json.dumps(r)
    def valid(*args,**kwargs):
        result = {"supported":True} if kwargs["json"]["text"]["format"]["name"] == "answer_review" else {"paragraphs":["현금으로 보유하면 코인 가격 변동에 노출되는 금액을 줄일 수 있어요."],"fact_ids":["allocation","cash"],"allocation":CASH,"suggest_allocation":True}
        return httpx.Response(200,json={"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":json.dumps(result)}]}]})
    monkeypatch.setattr(mentor.httpx,"post",valid)
    r = mentor.discuss(g,"대기 자금 위주로 구성해줘","A",BALANCED)
    assert r["source"] == "ai" and r["weights"] == CASH
    assert "BTC" not in json.dumps(r)


def test_inflight_duplicate_chat_does_not_call_model(client, monkeypatch):
    g = client.post("/api/guided-sessions",json={}).json()
    rid = str(uuid.uuid4())
    s = main.load(g["id"])
    s["chat_request"] = rid
    s["chat_wall"] = 0
    main.save(g["id"],s)
    monkeypatch.setattr(main,"discuss",lambda *a:pytest.fail("중복 요청은 모델을 호출하면 안 됩니다."))
    r = client.post("/api/sessions/"+g["id"]+"/chat",json={"request_id":rid,"question":"이자는?","asset":"A","draft":CASH})
    assert r.status_code == 400 and not main.load(g["id"])["chat"]


@pytest.mark.parametrize("question,cash", [("안정형으로 구성해줘",60),("균형형으로 구성해줘",30),("공격형으로 구성해줘",10)])
def test_setup_profile_questions_match_cash_guidance(client, question, cash):
    g=client.post("/api/guided-sessions",json={}).json()
    r=client.post("/api/sessions/"+g["id"]+"/chat",json={"request_id":str(uuid.uuid4()),"question":question,"asset":"A","draft":CASH})
    assert r.status_code==200
    result=r.json()
    assert result["status"]=="ready" and result["pending"] is None and result["trades"]==[]
    reply=result["chat"][-1]
    assert reply["source"]=="rules" and reply["weights"]["cash"]==cash
    assert "대기 자금" not in json.dumps(reply,ensure_ascii=False)
