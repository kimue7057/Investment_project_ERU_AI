import copy
import json
import re
from datetime import datetime, timedelta
from decimal import Decimal as D

import pytest

from backend.app.engine import Engine, fresh, FEE, INITIAL, SPAN, weights
from backend.app.market import Market, START, END, KST, ALIASES


@pytest.fixture(scope="module")
def market():
    return Market()


@pytest.fixture
def engine(market):
    return Engine(market)


def travel(engine, s, until):
    """Replay genuine data and explicitly ignore automatic alerts in tests."""
    while engine.now(s) < until:
        s["status"] = "running"
        engine.advance(s, (until - engine.now(s)).total_seconds() / SPAN * 300 + 1e-8)
        if s["status"] == "finished":
            break
        for a in s["alerts"]:
            if a["decision"] is None:
                engine.decide(s, a["id"], "ignore")


def started(engine, allocation=None):
    s = fresh()
    engine.start(s, allocation or {"cash": 20, "A": 30, "B": 20, "C": 15, "D": 15})
    travel(engine, s, START + timedelta(hours=10))
    s["status"] = "paused"
    return s


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -1, 101])
def test_bad_weights_rejected(value):
    with pytest.raises(ValueError):
        weights({"cash": value, "A": 0, "B": 0, "C": 0, "D": 0})


def test_initial_cash_and_next_open(engine, market):
    s = fresh()
    engine.start(s, {"cash": 0, "A": 100, "B": 0, "C": 0, "D": 0})
    assert not s["trades"] and D(s["cash"]) == INITIAL
    engine.advance(s, .01)
    assert not s["trades"]
    travel(engine, s, START + timedelta(hours=9))
    t = s["trades"][0]
    assert D(t["price"]) == market.open_price("A", START + timedelta(hours=9))
    assert abs(D(t["quantity"]) * D(t["price"]) * (1 + FEE) - INITIAL) < D("0.0000001")
    assert D(s["cash"]) == 0


def test_pause_does_not_advance(engine):
    s = started(engine)
    before = copy.deepcopy(s)
    engine.advance(s, 1000)
    assert s == before


def test_overspend_oversell_and_duplicate_orders(engine):
    s = started(engine)
    for side, amount in [("buy", 100000001), ("sell", 100000000000)]:
        with pytest.raises(ValueError):
            engine.order(s, "A", side, amount=amount)
    engine.order(s, "A", "buy", percent=100)
    with pytest.raises(ValueError):
        engine.order(s, "A", "buy", percent=100)
    assert D(s["cash"]) == D("20000000")


def test_next_open_strictly_after_submission(engine, market):
    at = START + timedelta(hours=9)
    assert market.next_open(at) == at + timedelta(days=1)


def test_sell_all_ledger_identity(engine):
    s = started(engine, {"cash": 0, "A": 100, "B": 0, "C": 0, "D": 0})
    engine.order(s, "A", "sell", percent=100)
    travel(engine, s, START + timedelta(days=1, hours=10))
    assert D(s["holdings"]["A"]) == 0
    assert D(s["costs"]["A"]) == 0
    assert abs(D(s["cash"]) - INITIAL - D(s["realized"])) < D("0.000001")


@pytest.mark.parametrize("allocation", [
    {"cash": 0, "A": 0, "B": 100, "C": 0, "D": 0},
    {"cash": 25, "A": 25, "B": 20, "C": 15, "D": 15},
    {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}])
def test_rebalance_targets_and_fee_conservation(engine, market, allocation):
    s = started(engine)
    engine.rebalance(s, allocation)
    at = datetime.fromisoformat(s["pending"]["at"])
    pre = D(s["cash"]) + sum(D(s["holdings"][a]) * market.open_price(a, at) for a in ALIASES)
    fees_before = D(s["fees"])
    s["now"] = at.isoformat()
    engine.execute(s)
    nav = engine.nav(s)
    assert abs(pre - nav - (D(s["fees"]) - fees_before)) < D("0.000001")
    for a in ALIASES:
        assert abs(D(s["holdings"][a]) * market.quote(a, at) / nav * 100 - allocation[a]) < D("0.000001")
    assert abs(D(s["cash"]) / nav * 100 - allocation["cash"]) < D("0.000001")


def test_anonymity_and_no_future_throughout_real_replay(engine, market):
    s = fresh()
    engine.start(s, {"cash": 20, "A": 30, "B": 20, "C": 15, "D": 15})
    forbidden = re.compile(r"bitcoin|ethereum|solana|dogecoin|https?://|\b(?:BTC|ETH|SOL|DOGE)\b|source_pair|private_source", re.I)
    snapshots = 0
    while s["status"] != "finished":
        engine.advance(s, 5)
        p = engine.public(s)
        if s["status"] != "finished":
            assert not forbidden.search(json.dumps(p))
            assert "identities" not in p and "baseline_return_pct" not in p
        assert all(datetime.fromisoformat(c["time"] + "T09:00:00+09:00") + timedelta(days=1) <= engine.now(s) for c in p["chart"])
        visible = {r["event_id"] for r in p["research"]}
        assert all(datetime.fromisoformat(e["available_at_kst"]) <= engine.now(s) for e in market.events if e["event_id"] in visible)
        if s["status"] == "paused":
            for a in s["alerts"]:
                if a["decision"] is None:
                    engine.decide(s, a["id"], "ignore")
            s["status"] = "running"
        snapshots += 1
    assert s["elapsed"] == 300 and engine.now(s) == END
    assert p["identities"]["A"].endswith("BTC")
    assert p["chart"][-1]["time"] == "2026-08-04"
    assert abs(p["return_pct"] - p["baseline_return_pct"]) < 1e-8
    assert snapshots > 50


def test_research_exact_release_boundary(market):
    at = datetime(2022, 11, 18, tzinfo=KST)
    assert "C-2022-11-17-network" not in {r["event_id"] for r in market.research(at-timedelta(microseconds=1))}
    assert "C-2022-11-17-network" in {r["event_id"] for r in market.research(at)}


def test_unfinished_week_cannot_change_guard(engine, market):
    s = started(engine)
    travel(engine, s, datetime(2023, 2, 15, 12, tzinfo=KST))
    s["last_alert"] = None
    s["seen_signals"] = []
    before = engine.guard(s)
    future = [r for r in market.rows["A"] if r["at"] > engine.now(s)]
    old = [r["close"] for r in future]
    try:
        for r in future:
            r["close"] = D("999999999999")
        assert engine.guard(s) == before
    finally:
        for r, value in zip(future, old):
            r["close"] = value


def test_mdd_matches_independent_history(engine):
    s = started(engine)
    travel(engine, s, END)
    peak, mdd = 100000000, 0
    for point in s["history"]:
        peak = max(peak, point["value"])
        mdd = max(mdd, (peak-point["value"])/peak)
    assert abs(float(s["mdd"])-mdd) < 1e-10


def test_end_rejects_orders_after_last_open(engine):
    s = started(engine)
    travel(engine, s, datetime(2026, 8, 5, 10, tzinfo=KST))
    s["status"] = "paused"
    with pytest.raises(ValueError):
        engine.order(s, "A", "buy", percent=10)


def test_retry_resets_everything(engine):
    s = started(engine)
    travel(engine, s, END)
    retry = fresh()
    assert retry["now"] == START.isoformat() and retry["elapsed"] == 0
    assert retry["trades"] == [] and retry["alerts"] == [] and retry["cash"] == "100000000"
