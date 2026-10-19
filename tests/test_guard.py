"""Isolated test-only market stub; never writes production candles."""
from datetime import timedelta
from decimal import Decimal as D

from backend.app.engine import Engine, fresh
from backend.app.market import START


class DecliningTestMarket:
    def quote(self, a, now):
        return D(100)

    def completed(self, a, now):
        # Every observation is an already completed Sunday before the start date.
        return [{"day": (START.date() - timedelta(days=1 + i*7)).isoformat(), "close": D(200+i)}
                for i in reversed(range(21))]

    def next_open(self, now):
        return now + timedelta(days=1)


def test_cash_based_buy_proposal_and_modified_order():
    e, s = Engine(DecliningTestMarket()), fresh()
    s["status"] = "paused"
    a = e.guard(s)
    assert a["side"] == "buy" and a["percent"] == 20
    s["alerts"].append(a)
    e.decide(s, a["id"], "modify", 10)
    assert s["pending"]["side"] == "buy"
    assert D(s["pending"]["budget"]) == D("10000000")
    assert s["choices"][-1]["action"] == "modify"
