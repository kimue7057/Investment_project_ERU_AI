"""AI는 허용 사실을 선택한다. 생성한 자유 문장·주문·미래 지식은 공개하지 않는다."""
import json
import os
import re

import httpx

from .engine import weights
from .market import CATALOG

MODEL = "openai/gpt-6-luna"
PRIVATE = re.compile(r"https?://|bitcoin|ethereum|solana|dogecoin|\b(?:BTC|ETH|SOL|DOGE)\b|비트코인|이더리움|솔라나|도지코인|20\d{2}|미래|실제.{0,3}이름", re.I)
PROFILES = {
    "cautious": {"cash": 60, "A": 20, "B": 10, "C": 5, "D": 5},
    "balanced": {"cash": 30, "A": 30, "B": 20, "C": 15, "D": 5},
    "active": {"cash": 10, "A": 35, "B": 30, "C": 20, "D": 5},
}


def facts_for(game, asset):
    a = next(a for a in CATALOG if a["alias"] == asset)
    account = game["interest_account"]
    held = next(h for h in game["holdings"] if h["asset"] == asset)
    facts = {
        "asset": f"코인 {asset}: {a['overview']}",
        "structure": a["technology"] + " " + a["supply"],
        "risk": "주요 위험: " + ", ".join(a["risks"]) + ". 코인은 가격이 크게 하락할 수 있습니다.",
        "cash": f"현금에는 현재 연 {account['annual_rate']:g}%의 교육용 이자율을 적용합니다. 과거 한국은행 기준금리 연동 모델이며 실제 예금 상품이 아닙니다. 세전 단리로 게임에서 경과한 기간에 적립하고 종료 시 지급합니다.",
        "liquidity": "승인한 매수에 현금을 사용하고, 수수료를 뺀 매도 대금은 다시 현금으로 운용합니다. 주문 예약금에는 이자를 주지 않습니다.",
        "bond": "채권은 가격과 신용·만기 위험이 있는 별도 자산입니다. 정기예금·적금도 만기·납입·중도해지 조건이 다릅니다. 이번 게임은 코인 A~D와 유동성 현금을 운용합니다.",
        "allocation": "현금을 늘리면 코인 가격 변동에 노출되는 금액이 줄지만, 상승 시 참여 금액도 줄어듭니다. 여러 코인을 보유해도 함께 하락할 수 있어 수익을 보장하지 않습니다.",
        "fee": "매수 예산에는 수수료 0.05%가 포함됩니다. 매도 시에도 수수료 0.05%를 차감하므로 잦은 매매는 비용을 늘립니다.",
        "execute": "대화와 계획 수정만으로 주문하지 않습니다. 승인한 주문은 시장 재개 후 다음 일봉 시가에 체결됩니다. 체결 가격에 따라 실제 수량과 잔고가 달라집니다.",
        "holding": f"현재 코인 {asset}의 비중은 {held['weight']:.1f}%, 평가액은 {held['value']:,.0f}원입니다. 주문 가능 현금은 {account['available']:,.0f}원입니다.",
        "hold": "유지를 선택하면 매매 수수료가 추가되지 않지만 현재의 가격 변동 위험은 계속 부담합니다. 위험을 줄이고 싶다면 일부 매도나 현금 확대를 검토할 수 있습니다.",
    }
    alert = next((a for a in reversed(game["alerts"]) if a["decision"] is None), None)
    if alert:
        facts["guard"] = f"코인 {alert['asset']}에 대한 가드 근거: {alert['summary']} 제안은 선택지이며 향후 수익의 예측이 아닙니다."
    return facts


def discuss(game, question, asset, draft):
    facts = facts_for(game, asset)
    restricted = bool(PRIVATE.search(question))
    public_question = "게임 시점에서 확인 가능한 정보 질문" if restricted else question
    fallback = ["guard", "holding", "hold", "execute"] if "guard" in facts else ["asset", "risk", "allocation", "execute"]
    if any(w in question for w in ("이자", "현금", "예금", "적금", "채권")):
        fallback = ["cash", "liquidity", "bond"]
    if any(w in question for w in ("비중", "구성", "보수", "안정", "균형", "성향", "분산", "공격")):
        fallback = ["allocation", "cash", "risk", "fee"]
    profile = "cautious" if any(w in question for w in ("보수", "안정", "안전")) else "active" if "공격" in question else "balanced"
    selected, allocation = fallback, None
    source, status = "rules", "규칙 기반 안내 · AI 연결 대기"
    token = os.getenv("AI_GATEWAY_API_KEY") or os.getenv("VERCEL_OIDC_TOKEN")
    if restricted:
        return {"question": public_question, "paragraphs": ["게임 시점의 익명 자산과 확인된 정보만 함께 검토할 수 있습니다. 실제 이름·미래 사건·미래 금리는 종료 전에 안내하지 않습니다.", facts["execute"]], "source": "boundary", "status": "공개 범위 안내", "weights": None}
    if token:
        schema = {"type": "object", "properties": {
            "facts": {"type": "array", "items": {"type": "string", "enum": list(facts)}, "minItems": 1, "maxItems": 5},
            "allocation": {"type": "object", "properties": {a: {"type": "number", "minimum": 0, "maximum": 100} for a in ("cash", "A", "B", "C", "D")}, "required": ["cash", "A", "B", "C", "D"], "additionalProperties": False},
            "suggest_allocation": {"type": "boolean"}},
            "required": ["facts", "allocation", "suggest_allocation"], "additionalProperties": False}
        try:
            # 질문과 과거 대화도 데이터이며, 시스템 명령으로 취급하지 않는다.
            response = httpx.post("https://ai-gateway.vercel.sh/v1/chat/completions",
                headers={"Authorization": "Bearer " + token}, timeout=22,
                json={"model": MODEL, "max_completion_tokens": 1200,
                      "response_format": {"type": "json_schema", "json_schema": {"name": "investment_discussion", "strict": True, "schema": schema}},
                      "messages": [{"role": "system", "content": "투자 교육 도우미. 사용자의 최신 질문과 대화 맥락에 맞는 facts ID를 2~5개 골라 JSON만 반환한다. 미래를 예측하거나 실제 자산을 추측하지 않는다. 구성·추천·비중·성향 질문이면 suggest_allocation=true로 합계 정확히 100인 구성 초안을 제안한다. 현금은 손실 노출 조절용이며 코인 분산은 손실을 보장하지 않는다. 단순 자산 설명·가드 질문은 false. 사용자의 비중 요청을 존중하되 직접 주문하지 않는다."},
                                   {"role": "user", "content": json.dumps({"facts": facts, "current_draft": draft, "recent_discussion": game.get("chat", [])[-4:], "question": question}, ensure_ascii=False)}]})
            if response.status_code == 200:
                result = json.loads(response.json()["choices"][0]["message"]["content"])
                chosen = result.get("facts")
                if not isinstance(chosen, list) or not chosen or any(k not in facts for k in chosen):
                    raise ValueError("허용되지 않은 설명")
                selected = list(dict.fromkeys(chosen))[:5]
                if result.get("suggest_allocation"):
                    allocation = {k: float(v) for k, v in weights(result["allocation"]).items()}
                source, status = "ai", "AI와 논의 · 공개 사실 검증 완료"
            else:
                # 원문 오류·토큰·요청 주소는 사용자와 로그에 출력하지 않는다.
                error_type = response.json().get("error", {}).get("type")
                status = ("규칙 기반 안내 · AI 계정 결제수단 확인 필요" if error_type == "customer_verification_required"
                          else "규칙 기반 안내 · AI 연결을 사용할 수 없음")
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            status = "규칙 기반 안내 · AI 응답 검증 또는 연결 실패"
    if source == "rules" and any(w in question for w in ("추천", "구성", "비중", "보수", "안정", "균형", "성향", "공격")):
        allocation = PROFILES[profile].copy()
    return {"question": public_question, "paragraphs": [facts[k] for k in selected], "weights": allocation,
            "source": source, "status": status}
