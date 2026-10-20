"""상담으로 만든 조건을 검증하고 서버의 현재 장부·확정 일봉으로 평가한다."""
from datetime import datetime, timedelta
from decimal import Decimal as D

from .assets import ASSET_NAMES

METRICS = ("concentration", "asset_loss", "daily_drop", "portfolio_loss")
DEFAULT_RULES = [
    {"metric": "concentration", "asset": "held", "threshold": 60, "enabled": True},
    {"metric": "asset_loss", "asset": "held", "threshold": 15, "enabled": True},
    {"metric": "daily_drop", "asset": "held", "threshold": 10, "enabled": True},
    {"metric": "portfolio_loss", "asset": "portfolio", "threshold": 10, "enabled": True},
]


def validate_rules(rules):
    if not isinstance(rules, list) or len(rules) > 8:
        raise ValueError("리스크 조건은 최대 8개까지 만들 수 있습니다.")
    clean, seen = [], set()
    for r in rules:
        if not isinstance(r, dict) or set(r) != {"metric", "asset", "threshold", "enabled"}:
            raise ValueError("리스크 조건의 항목을 확인하세요.")
        metric, asset, threshold = r["metric"], r["asset"], r["threshold"]
        if metric not in METRICS or asset not in ("held", "portfolio", "A", "B", "C", "D"):
            raise ValueError("지원하지 않는 리스크 조건입니다.")
        if (metric == "portfolio_loss") != (asset == "portfolio"):
            raise ValueError("전체 자산 손실은 전체 자산 기준으로 설정하세요.")
        if type(threshold) not in (int, float) or not D(str(threshold)).is_finite() or not 0 < threshold <= 100:
            raise ValueError("리스크 기준은 0 초과 100% 이하로 입력하세요.")
        if D(str(threshold)).as_tuple().exponent < -2 or type(r["enabled"]) is not bool:
            raise ValueError("리스크 기준은 소수 둘째 자리까지 입력하세요.")
        key = metric, asset
        if key in seen:
            raise ValueError("같은 지표와 대상의 조건은 하나로 합쳐주세요.")
        seen.add(key)
        clean.append({"metric": metric, "asset": asset, "threshold": threshold, "enabled": r["enabled"]})
    return clean


def evaluate(engine, s):
    """종목별·조건별로 재알림을 관리해 다른 조건이 대기 기간에 가려지지 않게 한다."""
    now, nav = engine.now(s), engine.nav(s)
    memory = s.setdefault("risk_rule_state", {})
    candidates = []
    for i, rule in enumerate(s["risk_rules"]):
        if not rule["enabled"]:
            continue
        metric = rule["metric"]
        assets = list("ABCD") if rule["asset"] == "held" else [rule["asset"]]
        for a in assets:
            value = None
            if metric == "portfolio_loss":
                value = (D(1) - nav / D("100000000")) * 100
            elif D(s["holdings"][a]) > 0:
                position = D(s["holdings"][a]) * engine.market.quote(a, now)
                if metric == "concentration":
                    value = position / nav * 100 if nav > 0 else D(0)
                elif metric == "asset_loss":
                    cost = D(s["costs"][a])
                    value = (1 - position / cost) * 100 if cost > 0 else D(0)
                else:
                    rows = engine.market.completed(a, now)
                    if len(rows) >= 2:
                        value = (1 - rows[-1]["close"] / rows[-2]["close"]) * 100
            key = f"{i}:{a}"
            record = memory.setdefault(key, {"active": False, "last": None})
            if value is None or value < D(str(rule["threshold"])):
                record["active"] = False
                continue
            if not record["active"] or not record["last"] or now - datetime.fromisoformat(record["last"]) >= timedelta(days=7):
                candidates.append((i, a, value, record))
    if not candidates:
        return None
    i, a, value, record = candidates[0]
    record.update(active=True, last=now.isoformat())
    rule = s["risk_rules"][i]
    descriptions = {"concentration": "전체 자산에서 차지하는 비중", "asset_loss": "수수료 포함 매수원가 대비 평가손실",
                    "daily_drop": "최근 확정 일봉의 전일 종가 대비 하락", "portfolio_loss": "시작 자금 대비 전체 자산 손실"}
    target = "전체 자산" if a == "portfolio" else ASSET_NAMES[a]
    focus = max("ABCD", key=lambda x: D(s["holdings"][x]) * engine.market.quote(x, now)) if a == "portfolio" else a
    return {"id": f"custom-{i}-{a}-{now.isoformat()}", "at": now.isoformat(), "kind": "risk", "asset": focus,
            "side": "sell", "title": f"{target} · 내가 정한 리스크 조건", "summary":
            f"{target}의 {descriptions[rule['metric']]}이 {value:.2f}%로, 설정한 {rule['threshold']}% 이상에 도달했어요. 자동 매도 없이 시장을 멈췄어요.",
            "percent": 20, "decision": None, "rule_index": i, "metric": rule["metric"],
            "threshold": rule["threshold"], "observed": str(value)}
