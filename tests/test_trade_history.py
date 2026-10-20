"""체결 명세의 손익·기존 세션 호환성·가명 및 공개 필드 회귀 검증."""
import copy
from decimal import Decimal as D

import pytest

from backend.app.assets import ASSET_NAMES, display_names
from backend.app.engine import Engine, fresh
from backend.app.market import Market, START
from backend.app.trade_history import journal


def fill(side, qty, price, asset="A"):
    # 순수 계산 단위 테스트 전용. 게임 시세 파일·서버 데이터에는 사용하지 않는다.
    qty, price = D(qty), D(price)
    gross = qty*price
    return {"at": START.isoformat(), "asset": asset, "side": side, "quantity": str(qty),
            "price": str(price), "gross": str(gross), "fee": str(gross*D(".0005")), "reason": "manual"}


def test_average_cost_partial_profit_loss_fees_and_reentry():
    trades = [fill("buy", "1", "100"), fill("buy", "1", "200"),
              fill("sell", "1", "180"), fill("buy", "2", "50", "B"), fill("sell", "1", "120"),
              fill("buy", "1", "90")]
    before=copy.deepcopy(trades)
    details, totals=journal(trades,{a:D(100) for a in "ABCD"})
    assert trades==before
    profit, loss=details[2],details[4]
    assert D(profit["cost_basis"])==D("150.075")
    assert D(profit["cash_flow"])==D("179.91")
    assert D(profit["realized_pnl"])==D("29.835")
    assert D(loss["realized_pnl"])==D("-30.135")
    assert D(loss["cumulative_realized"])==D("-.3")
    assert D(loss["balance_quantity"])==0
    assert details[0]["realized_pnl"] is None and details[0]["realized_return_pct"] is None
    assert D(details[-1]["cost_basis"])==D("90.045")
    assert D(details[-1]["cumulative_realized"])==D("-.3")
    assert D(totals[0]["remaining_cost"])==D("90.045")
    assert D(totals[0]["total_pnl"])==D("9.655")
    assert D(totals[1]["realized_pnl"])==0 and D(totals[1]["quantity"])==2


def test_full_exit_keeps_realized_history_and_only_allowed_fields():
    trades=[fill("buy","3","10"),fill("sell","3","12")]
    trades[0].update(source_url="https://example.invalid", identity="BTC", future_event="secret")
    details, totals=journal(trades,dict.fromkeys("ABCD",D(15)))
    assert D(totals[0]["quantity"])==0 and D(totals[0]["remaining_cost"])==0
    assert D(totals[0]["realized_pnl"])==D("5.967")
    assert D(totals[0]["total_pnl"])==D("5.967")
    assert all(t["name"]=="새벽코인" for t in details)
    assert not any(k in details[0] for k in ("source_url","identity","future_event"))
    assert {t["id"] for t in details}=={"fill-0","fill-1"}


def test_existing_real_trade_events_match_server_ledger_without_migration():
    e=Engine(Market());s=fresh(guided=True)
    # 실제 시세의 체결 가격만 사용한다. 체결 명세에는 새 필드가 없는 기존 형식을 유지한다.
    for day in range(1,19):
        at=e.market.rows["A"][next(i for i,r in enumerate(e.market.rows["A"]) if r["opened"]>START)+day]["opened"]
        s["now"]=at.isoformat()
        for a in "ABCD":
            price=e.market.open_price(a,at)
            if day%3==0 and D(s["holdings"][a])>0:
                e.trade(s,a,"sell",price,quantity=D(s["holdings"][a])/(1 if day%6==0 else 3))
            else:
                e.trade(s,a,"buy",price,budget=D("12345.67"))
        before=copy.deepcopy(s)
        public=e.public(s)
        assert s==before
        assert abs(sum(D(p["realized_pnl"]) for p in public["asset_performance"])-D(s["realized"]))<D("1e-18")
        for p in public["asset_performance"]:
            a=p["asset"]
            assert D(p["quantity"])==D(s["holdings"][a])
            assert abs(D(p["remaining_cost"])-D(s["costs"][a]))<D("1e-18")
        assert abs(sum(D(t["fee"]) for t in public["trades"])-D(s["fees"]))<D("1e-18")
    assert "realized_pnl" not in s["trades"][0]


def test_old_display_text_changes_without_mutating_saved_history():
    e=Engine(Market());s=fresh(guided=True)
    s["chat"]=[{"id":"old","at":s["now"],"question":"코인 A와 B는?","paragraphs":["A 60%, 코인 B 40%"],"source":"rules","status":"안내","weights":None}]
    s["choices"]=[{"at":s["now"],"action":"trade","summary":"코인 A 매수 승인"}]
    before=copy.deepcopy(s);p=e.public(s)
    assert s==before
    assert "새벽코인" in p["chat"][0]["question"] and "물결코인" in p["chat"][0]["paragraphs"][0]
    assert p["choices"][0]["summary"]=="새벽코인 매수 승인"
    assert ASSET_NAMES=={a:p["name"] for a,p in zip("ABCD",p["asset_performance"])}
    assert display_names("AI · API · 코인 A~D") == "AI · API · 네 가지 코인"
