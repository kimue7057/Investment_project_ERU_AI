"""사용자 조건, 실제 시세 평가, 승인 경계와 구 세션 호환을 검증한다."""
import copy
import json
from datetime import timedelta
from decimal import Decimal as D

import pytest

from backend.app.engine import Engine, fresh, SPAN
from backend.app.market import Market, START
from backend.app.risk_policy import validate_rules


def rule(metric="concentration", asset="held", threshold=60, enabled=True):
    return dict(metric=metric, asset=asset, threshold=threshold, enabled=enabled)


@pytest.fixture(scope="module")
def engine():
    return Engine(Market())


def invested(engine, rules):
    s = fresh(guided=True)
    engine.start(s, {"cash":30,"A":70,"B":0,"C":0,"D":0}, rules)
    engine.advance(s, (9*3600)/SPAN*300+1e-8)
    return s


@pytest.mark.parametrize("bad", [None, {}, [rule(threshold=0)], [rule(threshold=True)],
    [rule(threshold=float("nan"))], [rule(threshold=1.111)], [rule(threshold=101)],
    [rule(metric="eval")], [rule(asset="portfolio")], [rule(metric="portfolio_loss")],
    [rule(),rule()], [dict(rule(),script="secret")], [rule(enabled="true")], [rule()]*9])
def test_invalid_conditions_rejected_before_any_order(engine, bad):
    with pytest.raises(ValueError):
        validate_rules(bad)
    if bad is not None:
        s = fresh(guided=True)
        before = copy.deepcopy(s)
        with pytest.raises(ValueError):
            engine.start(s,{"cash":100,"A":0,"B":0,"C":0,"D":0},bad)
        assert s == before


def test_custom_threshold_triggers_only_after_real_next_open_and_survives_restore(engine):
    rules = [rule(threshold=60)]
    s = invested(engine,rules)
    assert len(s["trades"]) == 1 and s["status"] == "paused"
    alert = s["alerts"][-1]
    assert alert["metric"] == "concentration" and D(alert["observed"]) >= 60
    assert alert["threshold"] == 60 and "60%" in alert["summary"]
    assert s["pending"] is None  # 조건 충족은 매도 주문이 아니다.
    restored = json.loads(json.dumps(s))
    p = engine.public(restored)
    assert p["risk_rules"] == rules and "risk_rule_state" not in p
    assert engine.guard(restored) is None
    assert p["trades"] == engine.public(s)["trades"]
    rules[0]["threshold"] = 90
    assert restored["risk_rules"][0]["threshold"] == 60
    no_alert = invested(engine,[rule(threshold=90)])
    assert not no_alert["alerts"] and no_alert["status"] == "running"


def test_independent_rules_not_hidden_by_another_condition_and_rearm(engine):
    s = invested(engine,[rule(threshold=60),rule(metric="asset_loss",threshold=.01)])
    second = engine.guard(s)
    assert second and second["metric"] == "asset_loss"  # 매수 수수료도 원가에 포함.
    assert engine.guard(s) is None
    s["now"] = (engine.now(s)+timedelta(days=7)).isoformat()
    assert engine.guard(s) is not None
    # 실제 보유 수량이 없어지면 해당 조건은 해제된다.
    qty = s["holdings"]["A"]
    s["holdings"]["A"] = "0"
    assert engine.guard(s) is None
    s["holdings"]["A"] = qty
    assert engine.guard(s) is not None


def test_all_off_and_specific_unheld_asset_cannot_pause(engine):
    for rules in ([], [rule(enabled=False)], [rule(asset="B",threshold=1)]):
        s = invested(engine,rules)
        assert s["status"] == "running" and not s["alerts"]
        assert engine.public(s)["risk_rules"] == rules


def test_daily_drop_uses_only_completed_close_and_portfolio_includes_interest(engine):
    s = invested(engine,[])
    rows = engine.market.completed("A",engine.now(s))
    actual = (1-rows[-1]["close"]/rows[-2]["close"])*100
    if actual > 0:
        threshold = max(.01,float(actual.quantize(D(".01")))-.01)
        s["risk_rules"] = [rule(metric="daily_drop",asset="A",threshold=threshold)]
        a = engine.guard(s)
        assert a and D(a["observed"]) == actual
    s = fresh(guided=True)
    s["cash"],s["interest"] = "89000000","2000000"
    s["risk_rules"] = [rule(metric="portfolio_loss",asset="portfolio",threshold=10)]
    assert engine.guard(s) is None  # 미수이자 포함 9% 손실.
    s["interest"] = "1000000"
    alert = engine.guard(s)
    assert alert and D(alert["observed"]) == 10 and alert["asset"] in "ABCD"


def test_legacy_sessions_keep_original_guard(engine):
    s = invested(engine,None)
    assert "risk_rules" not in s and s["alerts"]
    assert "metric" not in s["alerts"][0]
    assert engine.public(s)["risk_rules"] is None
