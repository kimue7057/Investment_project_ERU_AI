"""실제 키 없이 직접 연결·대화 맥락·공개 경계·실패 경로를 검증한다."""
import copy
import json
import uuid

import httpx
import pytest

from backend.app import mentor
from backend.app.engine import Engine, fresh
from backend.app.market import Market

CASH = {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}
PLAN = {"cash": 30, "A": 42, "B": 28, "C": 0, "D": 0}
SETUP = {"profile": "balanced", "step": 2, "cash": 30, "selected": ["A", "B"],
         "shares": {"A": 60, "B": 40, "C": 0, "D": 0}}


@pytest.fixture
def game(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-not-a-real-key")
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "must-not-use")
    monkeypatch.setenv("VERCEL_OIDC_TOKEN", "must-not-use")
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    return Engine(Market()).public(fresh(guided=True))


def response(result):
    return httpx.Response(200, json={"status": "completed", "output": [{"type": "message", "content": [
        {"type": "output_text", "text": json.dumps(result, ensure_ascii=False)}]}]})


def answer(**changes):
    result = {"paragraphs": ["현금을 늘리면 코인의 가격 변화에 노출되는 금액을 줄일 수 있어요. 어느 정도의 비중이 편하신가요?"],
              "fact_ids": ["allocation", "cash"], "allocation": None, "suggest_allocation": False}
    result.update(changes)
    return result


def test_direct_openai_context_history_and_no_trade(game, monkeypatch):
    game["chat"] = [{"id": str(uuid.uuid4()), "question": f"질문 {i}", "paragraphs": ["현금 비중을 논의했어요."],
                    "weights": PLAN, "secret": "must-not-be-sent"} for i in range(15)]
    before = copy.deepcopy(game)
    calls = []
    def post(url, **kw):
        assert url == "https://api.openai.com/v1/responses"
        assert kw["headers"]["Authorization"] == "Bearer test-not-a-real-key"
        payload = kw["json"]
        assert payload["store"] is False and payload["model"] == "gpt-6-luna"
        data = json.loads(payload["input"][0]["content"])
        context = data["context"]
        assert context["setup"]["allocation"] == PLAN and context["focus_asset"] is None
        assert len(context["recent_discussion"]) == 12
        assert context["recent_discussion"][0]["question"] == "질문 3"
        assert all(a+".risk" in context["facts"] for a in "ABCD")
        assert "secret" not in json.dumps(context) and "chart" not in context
        calls.append(payload["text"]["format"]["name"])
        return response({"supported": True} if len(calls) == 2 else answer())
    monkeypatch.setattr(mentor.httpx, "post", post)
    r = mentor.discuss(game, "그럼 현금을 더 늘리면?", "A", PLAN, SETUP)
    assert r["source"] == "ai" and "OpenAI 직접 연결" in r["status"]
    assert calls == ["investment_discussion", "answer_review"]
    assert r["weights"] is None and game == before
    assert set(r) == {"question", "paragraphs", "weights", "source", "status"}


def test_incomplete_setup_does_not_claim_old_draft_is_current(game):
    partial = {**SETUP, "selected": [], "shares": dict.fromkeys("ABCD", 0)}
    ctx = mentor.context_for(game, "A", PLAN, partial)
    assert ctx["setup"]["allocation"] is None and ctx["setup"]["selected"] == []


def test_context_rounding_matches_exact_hundred(game):
    ctx = mentor.context_for(game, "A", PLAN, {**SETUP, "cash": 33.33,
        "selected": ["A", "B", "C"], "shares": {"A": 33.33, "B": 33.33, "C": 33.34, "D": 0}})
    assert ctx["setup"]["allocation"] == {"cash": 33.33, "A": 22.22, "B": 22.22, "C": 22.23, "D": 0}


@pytest.mark.parametrize("bad", [
    {"paragraphs": ["비트코인으로 매수해요."]},
    {"paragraphs": ["B\u200bTC가 올라요."]},
    {"paragraphs": ["ｈｔｔｐｓ://example.invalid"]},
    {"paragraphs": ["2026년 사건으로 오릅니다."]},
    {"paragraphs": ["<img src=x>"]},
    {"fact_ids": ["future_event"]},
    {"paragraphs": []},
    {"allocation": {"cash": 10, "A": 99}, "suggest_allocation": True},
    {"allocation": PLAN, "suggest_allocation": False},
    {"private": "should-never-publish"},
])
def test_invalid_or_private_generated_reply_fails_closed(game, monkeypatch, bad):
    calls = []
    def post(*a, **kw):
        calls.append(kw)
        return response(answer(**bad))
    monkeypatch.setattr(mentor.httpx, "post", post)
    result = mentor.discuss(game, "위험을 알려줘", "A", PLAN)
    assert result["source"] == "rules" and result["weights"] is None
    assert len(calls) == 1
    assert "example.invalid" not in json.dumps(result)


def test_new_unverified_market_event_fails_grounding_review(game, monkeypatch):
    replies = iter([answer(paragraphs=["대형 거래소의 파산이 예정돼 있으니 매도하세요."]), {"supported": False}])
    monkeypatch.setattr(mentor.httpx, "post", lambda *a, **kw: response(next(replies)))
    r = mentor.discuss(game, "앞으로 어떻게 될까?", "A", PLAN)
    assert r["source"] == "rules" and "파산" not in " ".join(r["paragraphs"])


def test_valid_proposal_is_only_a_draft(game, monkeypatch):
    before = copy.deepcopy(game)
    proposed = {"cash": 50, "A": 30, "B": 20, "C": 0, "D": 0}
    replies = iter([answer(allocation=proposed, suggest_allocation=True), {"supported": True}])
    monkeypatch.setattr(mentor.httpx, "post", lambda *a, **kw: response(next(replies)))
    r = mentor.discuss(game, "현금 반으로 하고 A와 B만 유지해줘", "A", PLAN, SETUP)
    assert r["source"] == "ai" and r["weights"] == proposed and game == before


@pytest.mark.parametrize("status,code,expected", [(401, "invalid_api_key", "키 인증"),
    (429, "insufficient_quota", "잔액·결제"), (429, "rate_limit_exceeded", "요청 한도"),
    (404, "model_not_found", "모델 권한"), (500, "server_error", "일시 연결")])
def test_errors_are_actionable_without_secrets(game, monkeypatch, status, code, expected):
    monkeypatch.setattr(mentor.httpx, "post", lambda *a, **kw: httpx.Response(status, json={
        "error": {"code": code, "message": "test-not-a-real-key private provider detail"}}))
    r = mentor.discuss(game, "왜 현금을 남겨?", "A", PLAN)
    assert r["source"] == "rules" and expected in r["status"]
    assert "test-not-a-real-key" not in json.dumps(r) and "private provider detail" not in json.dumps(r)


def test_no_key_never_uses_gateway(game, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY")
    monkeypatch.setattr(mentor.httpx, "post", lambda *a, **kw: pytest.fail("Gateway로 우회하면 안 됩니다."))
    assert mentor.discuss(game, "현금 이자는?", "A", PLAN)["source"] == "rules"


def test_explicit_identifiers_block_but_general_future_discussion_allowed(game, monkeypatch):
    calls = []
    def post(*a, **kw):
        calls.append(kw)
        return response({"supported": True} if len(calls) == 2 else answer())
    monkeypatch.setattr(mentor.httpx, "post", post)
    for q in ("BTC의 미래 가격은?", "2026년 수익 알려줘"):
        r = mentor.discuss(game, q, "A", PLAN)
        assert r["source"] == "boundary" and not calls
    assert mentor.discuss(game, "미래가 불안해서 현금을 남기고 싶어", "A", PLAN)["source"] == "ai"
