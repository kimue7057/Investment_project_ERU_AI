"""BTC 새 모드의 시계·장부·미래 정보 경계를 검증한다. 운영 시세 파일은 변경하지 않는다."""
from datetime import date,timedelta
from decimal import Decimal as D
from dataclasses import replace
import json

import pytest

from backend.app.bitcoin_engine import BitcoinEngine,FEE,CYCLES,maximum_drop


@pytest.fixture(scope="module")
def btc():
    return BitcoinEngine()


def test_both_accounts_start_with_same_fee_and_btc_exposure(btc):
    for run in btc.runs:
        first=run["history"][0]
        assert first["hold"]==first["guard"]
        assert abs(first["guard"]+first["fees"]-D(1))<D("1e-25")
        assert first["cash"]==0 and first["exposure"]==1


def test_orders_fill_next_daily_open_and_ledger_reconciles(btc):
    for run in btc.runs:
        for e in run["events"]:
            if e["kind"]=="wait":
                assert e["fee"]==0 and e["cash_before"]==e["cash_after"]
                continue
            assert date.fromisoformat(e["at"])==date.fromisoformat(e["signal_at"])+timedelta(days=1)
            assert abs(e["value_before"]-e["value_after"]-e["fee"])<D("1e-24")
            assert abs(e["fee"]-e["trade_value"]*FEE)<D("1e-24")
            if e["kind"]=="buy":
                budget=e["cash_before"]-e["cash_after"]
                assert D(0)<budget<e["cash_before"]
                assert abs(budget-e["trade_value"]-e["fee"])<D("1e-24")
            else:
                assert abs(e["cash_after"]-e["cash_before"]-e["trade_value"]+e["fee"])<D("1e-24")
            assert e["stage"]>=1
        assert all(r["cash"]>=0 and D(0)<=r["exposure"]<=D(1) for r in run["history"])
        assert abs(run["history"][-1]["fees"]-run["history"][0]["fees"]-sum(e["fee"] for e in run["events"]))<D("1e-24")


def test_future_candles_do_not_change_past_decisions_or_values(btc):
    cutoff="2018-01-01"
    changed=[replace(c,opened=c.opened*3,high=c.high*3,low=c.low*3,close=c.close*3) if c.day>=cutoff else c for c in btc.candles]
    other=BitcoinEngine(changed)
    assert [r for r in btc.runs[0]["history"] if r["date"]<cutoff]==[r for r in other.runs[0]["history"] if r["date"]<cutoff]
    assert [r for r in btc.runs[0]["events"] if r["at"]<cutoff]==[r for r in other.runs[0]["events"] if r["at"]<cutoff]


def test_pre_end_response_does_not_expose_future_or_private_inputs(btc):
    s={"id":"x","amount":"100000000","elapsed":50,"speed":4,"status":"running","created_at":1}
    public=btc.public(s)
    assert public["cycles"][1]["history"]==[] and "metrics" not in public["cycles"][1]
    assert public["cycles"][2]["events"]==[]
    current=public["cycles"][0]
    assert all(e["at"]<=current["date"] and e["signal_at"]<=current["date"] for e in current["events"])
    assert all(p["date"]<=current["date"] for p in current["history"])
    raw=json.dumps(public)
    for private in ('"all_events"','"quantity_internal"','"visitor_hash"','"sha256"','"upper"','"lower"','https://'):
        assert private not in raw


def test_complete_results_scale_and_include_true_drawdown_extremes(btc):
    for i in range(3):
        a=btc.public_cycle(i,D("100000000"),100,finished=True)
        b=btc.public_cycle(i,D("200000000"),100,finished=True)
        assert abs(b["metrics"]["guard"]["value"]-a["metrics"]["guard"]["value"]*2)<=.02
        assert len(a["history"])<=300 and len(a["events"])<=20
        dates={r["date"] for r in a["history"]}
        for key in ("hold","guard"):
            dd,peak,trough=maximum_drop(btc.runs[i]["history"],key)
            assert float(dd*100)==a["metrics"][key]["mdd_pct"]
            assert peak in dates and trough in dates
        assert a["metrics"]["guard"]["value"]<a["metrics"]["hold"]["value"]
        assert a["metrics"]["guard"]["mdd_pct"]>a["metrics"]["hold"]["mdd_pct"]


def test_highlights_are_chronological_and_cover_each_action(btc):
    for run in btc.runs:
        assert run["highlights"][0]==run["events"][0]
        assert run["highlights"][-1]==run["events"][-1]
        assert {e["kind"] for e in run["highlights"]}=={e["kind"] for e in run["events"]}
        assert [e["at_idx"] for e in run["highlights"]]==sorted(e["at_idx"] for e in run["highlights"])
