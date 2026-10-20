"""체결 기록에서 복원하는 읽기 전용 Decimal 거래 명세. 기존 세션 장부는 변경하지 않는다."""
from decimal import Decimal as D

from .assets import ASSET_NAMES


def journal(trades, prices):
    positions = {a: {k: D(0) for k in ("quantity", "cost", "realized", "buy_total", "sell_total", "fees")}
                 for a in ASSET_NAMES}
    details = []
    fields = ("at", "asset", "side", "quantity", "price", "gross", "fee", "reason")
    for index, trade in enumerate(trades):
        a, side = trade["asset"], trade["side"]
        p = positions[a]
        quantity, gross, fee = (D(trade[k]) for k in ("quantity", "gross", "fee"))
        realized = None
        rate = None
        if side == "buy":
            basis = gross + fee
            cash_flow = -basis
            p["cost"] += basis
            p["quantity"] += quantity
            p["buy_total"] += basis
        else:
            # 엔진의 이동평균 원가 배분과 같은 연산 순서를 유지한다.
            basis = p["cost"] * quantity / p["quantity"]
            cash_flow = gross - fee
            realized = cash_flow - basis
            rate = realized / basis * 100 if basis else None
            p["cost"] -= basis
            p["quantity"] -= quantity
            p["realized"] += realized
            p["sell_total"] += cash_flow
        p["fees"] += fee
        details.append({**{k: trade[k] for k in fields}, "id": f"fill-{index}", "name": ASSET_NAMES[a],
            "cash_flow": str(cash_flow), "cost_basis": str(basis),
            "realized_pnl": str(realized) if realized is not None else None,
            "realized_return_pct": str(rate) if rate is not None else None,
            "cumulative_realized": str(p["realized"]), "balance_quantity": str(p["quantity"])})
    performance = []
    for a, p in positions.items():
        value = p["quantity"] * prices[a]
        unrealized = value - p["cost"]
        performance.append({"asset": a, "name": ASSET_NAMES[a], "quantity": str(p["quantity"]),
            "remaining_cost": str(p["cost"]), "value": str(value),
            "average_cost": str(p["cost"]/p["quantity"]) if p["quantity"] else "0",
            "realized_pnl": str(p["realized"]), "unrealized_pnl": str(unrealized),
            "unrealized_return_pct": str(unrealized/p["cost"]*100) if p["cost"] else None,
            "total_pnl": str(p["realized"]+unrealized),
            **{k: str(p[k]) for k in ("buy_total", "sell_total", "fees")}})
    return details, performance
