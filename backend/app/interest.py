"""명시적인 교육용 대기 자금 모델. 실제 예금 상품 금리가 아니다."""
from datetime import datetime, timedelta
from decimal import Decimal as D

from .market import KST

# 한국은행 기준금리 추이, 확인일 2026-10-20.
# https://www.bok.or.kr/portal/singl/baseRate/list.do?menuNo=200656
# 당일 공표 시각 추정으로 인한 미래 정보 노출을 피하도록 다음 날부터 적용한다.
RATES = [(datetime.fromisoformat(day).replace(tzinfo=KST) + timedelta(days=1), D(rate))
         for day, rate in [("2022-10-12", "3.00"), ("2022-11-24", "3.25"),
                           ("2023-01-13", "3.50"), ("2024-10-11", "3.25"),
                           ("2024-11-28", "3.00"), ("2025-02-25", "2.75"),
                           ("2025-05-29", "2.50"), ("2026-07-16", "2.75")]]


def rate_at(at):
    return next((rate for day, rate in reversed(RATES) if day <= at), D(0))


def reserve(s):
    p = s.get("pending")
    if not p:
        return D(0)
    if p["kind"] == "initial":
        return D("100000000") * (100 - D(p["weights"]["cash"])) / 100
    if p["kind"] == "trade" and p["side"] == "buy":
        return D(p["budget"])
    # 비중 조정 주문은 전체 구성을 예약한다. 체결 전 원금을 중복 운용하지 않는다.
    return D(s["cash"]) if p["kind"] == "rebalance" else D(0)


def accrue(s, until):
    if s.get("mode") != "guided" or s["status"] != "running":
        return
    since = datetime.fromisoformat(s["now"])
    if until <= since:
        return
    principal = max(D(0), D(s["cash"]) - reserve(s))
    interest = D(s.get("interest", "0"))
    # 금리 변경점에서 구간을 나눈다. 갱신 빈도·분할·복원에 의존하지 않는다.
    boundaries = [day for day, _ in RATES if since < day < until] + [until]
    for stop in boundaries:
        seconds = D(str((stop - since).total_seconds()))
        interest += principal * rate_at(since) / 100 * seconds / D(31536000)
        since = stop
    s["interest"] = str(interest)


def public_interest(s, at):
    return {"accrued": float(D(s.get("interest", "0"))), "annual_rate": float(rate_at(at)),
            "principal": float(D(s["cash"])), "reserved": float(reserve(s)),
            "available": float(max(D(0), D(s["cash"]) - reserve(s))),
            "settled": bool(s.get("interest_settled")),
            "policy": "과거 한국은행 기준금리 연동 · 교육용 · 세전 단리 · 365일 기준",
            "terms": "실제 예금 상품이 아닙니다. 변경 금리는 공표 다음 날부터 적용하며 주문 예약금은 제외합니다. 이자는 종료 시 정산하고 재투자하지 않습니다."}
