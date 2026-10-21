"""종료 후에만 만드는 읽기 전용 복기. 실제 장부와 독립적인 가정을 구분한다."""
import copy
from datetime import datetime
from decimal import Decimal as D

from .assets import ASSET_NAMES, display_names
from .engine import Engine, fresh, INITIAL
from .interest import accrue
from .market import ALIASES, START, END
from .trade_history import journal


class HoldReplay(Engine):
    def guard(self, s):
        return None


def hold_value(cash, holdings, at, market):
    """체결 이후 추가 주문 없는 단리 비교. 과거 적립 이자는 양쪽에 공통으로 제외."""
    state = {"mode": "guided", "status": "running", "now": at, "cash": str(cash),
             "pending": None, "interest": "0"}
    accrue(state, END)
    return cash + D(state["interest"]) + sum(holdings[a] * market.quote(a, END) for a in ALIASES)


def build_review(s, market):
    if s.get("mode") != "guided" or s["status"] != "finished":
        raise ValueError("투자 종료 후에 복기를 확인할 수 있습니다.")
    engine = Engine(market)
    final = engine.nav(s)
    fills, assets = journal(s["trades"], {a: market.quote(a, END) for a in ALIASES})
    initial_plan = s.get("initial_plan")
    baseline = None
    if initial_plan:
        replay = HoldReplay(market)
        baseline_state = fresh(guided=True)
        replay.start(baseline_state, initial_plan)
        replay.advance(baseline_state, 300)
        baseline = {"label": "처음 계획 그대로 보유", "nav": str(replay.nav(baseline_state)),
                    "interest": baseline_state["interest"], "fees": baseline_state["fees"],
                    "history": baseline_state["history"],
                    "difference": str(final - replay.nav(baseline_state))}

    # 정확한 ID가 없는 과거 기록을 추측해서 승인과 연결하지 않는다.
    linked = {}
    legacy_groups = {}
    for index, trade in enumerate(s["trades"]):
        if trade.get("decision_id"):
            linked.setdefault(trade["decision_id"], []).append(index)
        else:
            legacy_groups.setdefault((trade["at"], trade["reason"]), []).append(index)

    # 체결 전후 잔고는 기록된 현금 흐름과 수량만으로 복원한다. 장부는 변경하지 않는다.
    pre, post = {}, {}
    cash, holdings = INITIAL, {a: D(0) for a in ALIASES}
    for i, fill in enumerate(fills):
        pre[i] = (cash, holdings.copy())
        cash += D(fill["cash_flow"])
        holdings[fill["asset"]] += D(fill["quantity"]) * (1 if fill["side"] == "buy" else -1)
        post[i] = (cash, holdings.copy())

    alerts = {a["id"]: a for a in s["alerts"]}
    messages = {c["id"]: c for c in s.get("chat", [])}
    decisions = []
    for i, choice in enumerate(s["choices"]):
        if choice["action"] == "default_guard":
            continue
        cid = choice.get("id", f"legacy-choice-{i}")
        indices = linked.get(cid, [])
        snapshot = choice.get("snapshot")
        alert = alerts.get(choice.get("alert_id"))
        item = {"id": cid, "at": choice["at"], "action": choice["action"],
                "summary": display_names(choice.get("summary") or {
                    "ignore": "매매 없이 현재 구성 유지", "accept": "가드 제안 승인",
                    "modify": "비율을 수정해 가드 제안 승인"}.get(choice["action"], "투자 판단 기록")),
                "linkage": "recorded" if choice.get("id") else "legacy",
                "cancelled": bool(choice.get("cancelled")),
                "situation": display_names(alert["summary"]) if alert else "직접 선택한 투자 판단입니다.",
                "nav": snapshot["nav"] if snapshot else None,
                "composition": None,
                "discussions": [{"id": m["id"], "at": m["at"], "question": display_names(m["question"]),
                                 "paragraphs": [display_names(p) for p in m["paragraphs"]], "status": m["status"]}
                                for mid in choice.get("chat_ids", []) if (m := messages.get(mid))],
                "fills": [fills[j] for j in indices]}
        if snapshot:
            at = datetime.fromisoformat(choice["at"])
            nav = D(snapshot["nav"])
            item["composition"] = {"cash": str((D(snapshot["cash"]) + D(snapshot["interest"]))/nav*100),
                                   **{a: str(D(snapshot["holdings"][a])*market.quote(a, at)/nav*100) for a in ALIASES}}
        decisions.append(item)

    for (at, reason), indices in legacy_groups.items():
        decisions.append({"id": f"legacy-fills-{indices[0]}", "at": at, "action": "execution",
                          "summary": "초기 매수 체결" if reason == "initial" else "매매 체결 기록",
                          "linkage": "fills_only", "cancelled": False, "situation": "이전 기록은 승인 연결 정보가 없어 체결을 별도로 표시합니다.",
                          "nav": None, "composition": None, "discussions": [], "fills": [fills[j] for j in indices]})
    decisions.sort(key=lambda d: d["at"])  # 같은 시점은 기록 순서를 유지한다.
    index_for_id = {f["id"]: i for i, f in enumerate(fills)}
    for i, item in enumerate(decisions):
        group = item["fills"]
        item["realized_pnl"] = str(sum((D(f["realized_pnl"]) for f in group if f["realized_pnl"] is not None), D(0))) if any(f["side"] == "sell" for f in group) else None
        item["fees"] = str(sum((D(f["fee"]) for f in group), D(0)))
        item["cash_flow"] = str(sum((D(f["cash_flow"]) for f in group), D(0)))
        item["comparison"] = None
        if group and all(f["reason"] != "initial" for f in group):
            indices = [index_for_id[f["id"]] for f in group]
            # 하나의 주문 묶음은 같은 시가에서 연속 체결된다. 모호한 과거 묶음은 비교하지 않는다.
            if len({f["at"] for f in group}) == 1 and indices == list(range(min(indices), max(indices)+1)):
                cash_before, held_before = pre[min(indices)]
                cash_after, held_after = post[max(indices)]
                at = group[0]["at"]
                acted = hold_value(cash_after, held_after, at, market)
                unchanged = hold_value(cash_before, held_before, at, market)
                item["comparison"] = {"at": at, "acted": str(acted), "unchanged": str(unchanged),
                                      "difference": str(acted-unchanged)}
        following = next((d for d in decisions[i+1:] if d["nav"] is not None), None)
        item["period"] = ({"until": following["at"] if following else s["now"],
                           "end_nav": following["nav"] if following else str(final),
                           "change": str(D(following["nav"] if following else final)-D(item["nav"]))}
                          if item["nav"] is not None else None)
        # 그래프 마커는 마지막으로 관측한 실제 자산값에 놓는다. 구형 기록은 근사 표시한다.
        point = next((p for p in reversed(s["history"]) if p["time"] <= item["at"]), s["history"][0])
        item["marker_value"] = item["nav"] or str(point["value"])

    return {"version": 1, "initial": str(INITIAL), "final_nav": str(final),
            "net_profit": str(final-INITIAL), "return_pct": str((final/INITIAL-1)*100),
            "realized": s["realized"], "unrealized": str(sum((D(a["unrealized_pnl"]) for a in assets), D(0))),
            "trading_profit": str(sum((D(a["total_pnl"]) for a in assets), D(0))),
            "interest": s["interest"], "fees": s["fees"], "mdd_pct": str(D(s["mdd"])*100),
            "history": copy.deepcopy(s["history"]), "baseline": baseline, "decisions": decisions,
            "assets": assets, "initial_plan": copy.deepcopy(initial_plan),
            "recap": copy.deepcopy(s.get("review_recap"))}


QUESTIONS = {
    "risk": "다시 투자한다면 어느 정도의 손실을 감당할 수 있을까요?",
    "cash": "현금 비중이 변동성과 이자 수익에 어떤 영향을 줬나요?",
    "timing": "승인 시점과 다음 일봉 체결가의 차이를 고려했나요?",
    "hold": "유지한 결정과 매매한 결정을 같은 기준으로 평가했나요?",
    "process": "다음에는 결과보다 판단 근거를 어떻게 개선하고 싶나요?"}


def recap_facts(review):
    facts = {"total": f"최종 자산 {D(review['final_nav']):,.0f}원, 총손익 {D(review['net_profit']):+,.0f}원입니다.",
             "interest": f"현금 이자는 {D(review['interest']):,.0f}원입니다. 매매 순손익은 {D(review['trading_profit']):+,.0f}원이며 수수료가 이미 반영됐습니다.",
             "drawdown": f"최대 낙폭은 {D(review['mdd_pct']):.2f}%입니다."}
    if review["baseline"]:
        facts["baseline"] = f"처음 계획을 그대로 보유한 비교와 실제 최종 자산의 차이는 {D(review['baseline']['difference']):+,.0f}원입니다. 이것만으로 개별 선택의 인과관계를 단정할 수 없습니다."
    for d in review["decisions"]:
        if d["realized_pnl"] is not None:
            facts[d["id"]] = f"{d['at'][:10]}의 {d['summary']} 이 주문 묶음의 매도 실현손익은 {D(d['realized_pnl']):+,.0f}원입니다."
    return facts


def create_recap(review):
    """AI는 검증된 사실/질문을 고른다. 자유 생성 숫자·의도·인과 설명은 공개하지 않는다."""
    import os
    from .mentor import api_key, generate, ReplyError
    import httpx

    facts = recap_facts(review)
    fallback = {"source": "records", "status": "기록 기반 복기", "paragraphs": [facts[k] for k in ("total", "interest", "drawdown")],
                "questions": [QUESTIONS["process"]]}
    token = api_key()
    if not token:
        return {**fallback, "status": "기록 기반 복기 · AI 연결 키 없음"}
    model = os.getenv("OPENROUTER_MODEL", "openai/gpt-6-luna")
    schema = {"type": "object", "properties": {
        "fact_ids": {"type": "array", "items": {"type": "string", "enum": list(facts)}, "minItems": 2, "maxItems": 4},
        "question_ids": {"type": "array", "items": {"type": "string", "enum": list(QUESTIONS)}, "minItems": 1, "maxItems": 2}},
        "required": ["fact_ids", "question_ids"], "additionalProperties": False}
    try:
        result = generate(token, model, "교육용 투자 복기입니다. 사실 목록에서 결과와 판단 과정을 돌아보는 데 중요한 항목과 성찰 질문을 선택하세요. 매도 손실과 전체 성과를 균형 있게 고르세요. 숫자나 의도를 새로 만들지 마세요.",
                          {"facts": facts, "questions": QUESTIONS}, schema, review=True)
        if not isinstance(result, dict) or set(result) != {"fact_ids", "question_ids"}:
            raise ValueError()
        ids, qids = result["fact_ids"], result["question_ids"]
        if not isinstance(ids, list) or not 2 <= len(ids) <= 4 or not all(isinstance(k, str) and k in facts for k in ids):
            raise ValueError()
        if not isinstance(qids, list) or not 1 <= len(qids) <= 2 or not all(isinstance(k, str) and k in QUESTIONS for k in qids):
            raise ValueError()
        return {"source": "ai", "status": f"OpenRouter 연결 · {model} · 기록 선택형 복기",
                "paragraphs": [facts[k] for k in dict.fromkeys(ids)], "questions": [QUESTIONS[k] for k in dict.fromkeys(qids)]}
    except ReplyError as exc:
        return {**fallback, "status": f"기록 기반 복기 · {exc}"}
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return {**fallback, "status": "기록 기반 복기 · AI 응답을 확인하지 못했어요"}
