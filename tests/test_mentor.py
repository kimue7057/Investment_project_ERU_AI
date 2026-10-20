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
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-not-a-real-key")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-use")
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "must-not-use")
    monkeypatch.setenv("VERCEL_OIDC_TOKEN", "must-not-use")
    monkeypatch.delenv("OPENROUTER_MODEL", raising=False)
    return Engine(Market()).public(fresh(guided=True))


def response(result):
    return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {
        "content": json.dumps(result, ensure_ascii=False), "reasoning": "must-not-publish"}}]})


def answer(**changes):
    result = {"paragraphs": ["현금을 늘리면 코인의 가격 변화에 노출되는 금액을 줄일 수 있어요. 어느 정도의 비중이 편하신가요?"],
              "fact_ids": ["allocation", "cash"], "allocation": None, "suggest_allocation": False, "risk_rules": None, "setup_preference": None}
    result.update(changes)
    return result


def test_openrouter_context_history_and_no_trade(game, monkeypatch):
    game["chat"] = [{"id": str(uuid.uuid4()), "question": f"질문 {i}", "paragraphs": ["현금 비중을 논의했어요."],
                    "weights": PLAN, "secret": "must-not-be-sent"} for i in range(15)]
    before = copy.deepcopy(game)
    calls = []
    def post(url, **kw):
        assert url == "https://openrouter.ai/api/v1/chat/completions"
        assert kw["headers"]["Authorization"] == "Bearer test-not-a-real-key"
        payload = kw["json"]
        assert payload["stream"] is False and payload["model"] == "openai/gpt-6-luna"
        assert payload["provider"]["require_parameters"] is True
        assert payload["reasoning"]["exclude"] is True
        data = json.loads(payload["messages"][1]["content"])
        context = data["context"]
        assert context["setup"]["allocation"] == PLAN and context["focus_asset"] is None
        assert len(context["recent_discussion"]) == 12
        assert context["recent_discussion"][0]["question"] == "질문 3"
        assert all(a+".risk" in context["facts"] for a in "ABCD")
        assert "secret" not in json.dumps(context) and "chart" not in context
        calls.append(payload["response_format"]["json_schema"]["name"])
        return response({"supported": True} if len(calls) == 2 else answer())
    monkeypatch.setattr(mentor.httpx, "post", post)
    r = mentor.discuss(game, "그럼 현금을 더 늘리면?", "A", PLAN, SETUP)
    assert r["source"] == "ai" and "OpenRouter 연결" in r["status"]
    assert "must-not-publish" not in json.dumps(r)
    assert calls == ["investment_discussion", "answer_review"]
    assert r["weights"] is None and game == before
    assert set(r) == {"question", "paragraphs", "weights", "source", "status"}


def test_incomplete_setup_does_not_claim_old_draft_is_current(game):
    partial = {**SETUP, "selected": [], "shares": dict.fromkeys("ABCD", 0)}
    ctx = mentor.context_for(game, "A", PLAN, partial)
    assert ctx["setup"]["allocation"] is None and ctx["setup"]["selected"] == []


def test_conversation_has_no_implicit_conditions_or_preselected_plan(game):
    setup={**SETUP,"mode":"conversation","profile":None,"step":0,"cash":100,
           "selected":[],"shares":dict.fromkeys("ABCD",0),"allocation":None,"risk_rules":None}
    ctx=mentor.context_for(game,"A",PLAN,setup)
    assert ctx["setup"]["allocation"] is None and ctx["setup"]["risk_rules"] is None
    assert ctx["setup"]["mode"]=="conversation"


def test_offline_conversation_does_not_invent_plan_or_send_user_back_to_forms(game,monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    setup={**SETUP,"mode":"conversation","allocation":None,"risk_rules":None}
    for question in ("균형형 구성 추천해줘","전체 손실 알림도 같이 정하자"):
        r=mentor.discuss(game,question,"A",CASH,setup)
        assert r["source"]=="rules" and r["weights"] is None and "risk_rules" not in r
        assert "입력" not in " ".join(r["paragraphs"]) and "오른쪽" not in " ".join(r["paragraphs"])


def test_conversation_passes_exact_plan_and_whole_plan_reply_remains_unapproved(game,monkeypatch):
    rules=[{"metric":"portfolio_loss","asset":"portfolio","threshold":10,"enabled":True}]
    setup={**SETUP,"mode":"conversation","allocation":PLAN,"risk_rules":None}
    ctx=mentor.context_for(game,"A",CASH,setup)
    assert ctx["setup"]["allocation"]==PLAN
    replies=iter([answer(allocation=PLAN,suggest_allocation=True,setup_preference={"profile":"balanced","cash":30},risk_rules=rules),{"supported":True}])
    monkeypatch.setattr(mentor.httpx,"post",lambda *a,**kw:response(next(replies)))
    before=copy.deepcopy(game)
    r=mentor.discuss(game,"균형형 구성과 전체 손실 10% 알림을 함께 정리해줘","A",CASH,setup)
    assert r["source"]=="ai" and r["weights"]==PLAN and r["risk_rules"]==rules
    assert game==before and game["initial_plan"] is None and game["risk_rules"] is None


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


def test_risk_consultation_proposal_keeps_portfolio_and_rules_unconfirmed(game, monkeypatch):
    from backend.app.risk_policy import DEFAULT_RULES
    proposed = [*DEFAULT_RULES, {"metric":"asset_loss","asset":"A","threshold":8,"enabled":True}]
    before = copy.deepcopy(game)
    replies = iter([answer(paragraphs=["새벽코인의 매수원가 대비 평가손실이 8% 이상이면 시장을 멈추고 함께 판단하는 조건을 제안해요. 최종 승인 전에는 적용되지 않아요."],fact_ids=["risk_policy"],risk_rules=proposed), {"supported":True}])
    def post(*args, **kw):
        ctx=json.loads(kw["json"]["messages"][1]["content"])["context"]
        assert ctx["setup"]["risk_rules"] == DEFAULT_RULES
        return response(next(replies))
    monkeypatch.setattr(mentor.httpx,"post",post)
    r=mentor.discuss(game,"새벽코인 8% 손실 조건을 추가해줘","A",PLAN,{**SETUP,"step":3,"risk_rules":DEFAULT_RULES})
    assert r["source"]=="ai" and r["weights"] is None and r["risk_rules"]==proposed
    assert game==before and game["risk_rules"] is None


def test_profile_and_cash_can_be_proposed_before_coin_selection(game, monkeypatch):
    partial={**SETUP,"profile":None,"step":0,"selected":[],"shares":dict.fromkeys("ABCD",0)}
    preference={"profile":"cautious","cash":65}
    replies=iter([answer(fact_ids=["preference"],setup_preference=preference),{"supported":True}])
    monkeypatch.setattr(mentor.httpx,"post",lambda *a,**kw:response(next(replies)))
    before=copy.deepcopy(game)
    r=mentor.discuss(game,"안정형으로 현금 65%로 시작하고 싶어","A",CASH,partial)
    assert r["source"]=="ai" and r["setup_preference"]==preference and r["weights"] is None
    assert game==before


@pytest.mark.parametrize("rules", [[{"metric":"price","asset":"A","threshold":8,"enabled":True}], [{"metric":"asset_loss","asset":"A","threshold":0,"enabled":True}]])
def test_invalid_ai_risk_proposal_is_not_published(game, monkeypatch, rules):
    monkeypatch.setattr(mentor.httpx,"post",lambda *a,**kw:response(answer(risk_rules=rules)))
    r=mentor.discuss(game,"알림 조건을 정해줘","A",PLAN,SETUP)
    assert r["source"]=="rules" and "risk_rules" not in r and r["weights"] is None


def test_post_start_risk_change_cannot_be_claimed_as_applied(game, monkeypatch):
    game["status"]="paused"
    monkeypatch.setattr(mentor.httpx,"post",lambda *a,**kw:response(answer(risk_rules=[])))
    r=mentor.discuss(game,"리스크 알림 모두 꺼줘","A",PLAN)
    assert r["source"]=="rules" and "risk_rules" not in r


@pytest.mark.parametrize("status,code,expected", [(401, "invalid_api_key", "키 인증"),
    (401, "ip_not_authorized", "IP 제한"), (402, 402, "크레딧 잔액"),
    (429, "insufficient_quota", "크레딧 잔액"), (429, "rate_limit_exceeded", "요청 한도"),
    (429, "credit_balance_exhausted", "크레딧 잔액"),
    (404, "model_not_found", "모델 권한"), (500, "server_error", "일시 연결")])
def test_errors_are_actionable_without_secrets(game, monkeypatch, status, code, expected):
    monkeypatch.setattr(mentor.httpx, "post", lambda *a, **kw: httpx.Response(status, json={
        "error": {"code": code, "message": "test-not-a-real-key private provider detail"}}))
    r = mentor.discuss(game, "왜 현금을 남겨?", "A", PLAN)
    assert r["source"] == "rules" and expected in r["status"]
    assert "test-not-a-real-key" not in json.dumps(r) and "private provider detail" not in json.dumps(r)


def test_no_key_never_uses_openai_or_gateway(game, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    monkeypatch.setattr(mentor.httpx, "post", lambda *a, **kw: pytest.fail("OpenAI 또는 Gateway로 우회하면 안 됩니다."))
    assert mentor.discuss(game, "현금 이자는?", "A", PLAN)["source"] == "rules"


@pytest.mark.parametrize("value", ['  test-not-a-real-key\n', '"test-not-a-real-key"',
    "'test-not-a-real-key'", 'Bearer test-not-a-real-key', '"Bearer test-not-a-real-key"'])
def test_pasted_key_wrappers_are_removed_without_exposing_value(game, monkeypatch, value):
    monkeypatch.setenv("OPENROUTER_API_KEY", value)
    def post(*a, **kw):
        assert kw["headers"]["Authorization"] == "Bearer test-not-a-real-key"
        return httpx.Response(401, json={"error": {"code": "invalid_api_key"}})
    monkeypatch.setattr(mentor.httpx, "post", post)
    reply = mentor.discuss(game, "현금 이자는?", "A", PLAN)
    assert "새 API 키로 교체" in reply["status"]
    assert "test-not-a-real-key" not in json.dumps(reply)


@pytest.mark.parametrize("body", [
    {"choices": [{"finish_reason": "length", "message": {"content": "private partial text"}}]},
    {"choices": [{"finish_reason": "error", "message": {"content": "private provider detail"}}]},
    {"error": {"code": 502, "message": "private provider detail"}},
    {"choices": [{"finish_reason": "stop", "message": {"content": None, "refusal": "private refusal"}}]},
    {"choices": []},
])
def test_truncated_refused_or_inline_error_never_published(game, monkeypatch, body):
    monkeypatch.setattr(mentor.httpx, "post", lambda *a, **kw: httpx.Response(200, json=body))
    reply = mentor.discuss(game, "현금 이자는?", "A", PLAN)
    assert reply["source"] == "rules" and "private" not in json.dumps(reply)


def test_configured_router_model_used_for_both_requests(game, monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "vendor/configured-model")
    calls = []
    def post(*a, **kw):
        calls.append(kw["json"]["model"])
        return response({"supported": True} if len(calls) == 2 else answer())
    monkeypatch.setattr(mentor.httpx, "post", post)
    reply = mentor.discuss(game, "현금 이자는?", "A", PLAN)
    assert calls == ["vendor/configured-model"]*2
    assert reply["source"] == "ai" and "vendor/configured-model" in reply["status"]


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
