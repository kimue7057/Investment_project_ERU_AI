"""Deterministic, server-owned replay and ledger. No client clock or price inputs."""
import bisect
import copy
from datetime import datetime, timedelta
from decimal import Decimal

from .market import ALIASES, START, END

D = Decimal
INITIAL = D("100000000")
FEE = D("0.0005")
DURATION = 300
SPAN = (END - START).total_seconds()


def number(value):
    try:
        n = D(str(value))
    except Exception:
        raise ValueError("올바른 숫자를 입력하세요.")
    if not n.is_finite():
        raise ValueError("유한한 숫자만 입력할 수 있습니다.")
    return n


def weights(value):
    if set(value) != set(["cash", *ALIASES]):
        raise ValueError("현금 및 코인 A~D의 비중을 모두 입력하세요.")
    value = {a: number(v) for a, v in value.items()}
    if any(v < 0 or v > 100 for v in value.values()) or sum(value.values()) != 100:
        raise ValueError("비중은 0~100% 범위이며 합계가 정확히 100%여야 합니다.")
    return value


def fresh(paper=False):
    state = {"status": "ready", "elapsed": 0.0, "now": START.isoformat(), "cash": str(INITIAL),
            "holdings": {a: "0" for a in ALIASES}, "costs": {a: "0" for a in ALIASES},
            "realized": "0", "fees": "0", "trades": [], "pending": None,
            "targets": {"cash": "20", "A": "30", "B": "20", "C": "15", "D": "15"},
            "history": [{"time": START.isoformat(), "value": float(INITIAL)}],
            "peak": str(INITIAL), "mdd": "0", "alerts": [], "choices": [],
            "seen_signals": [], "last_alert": None, "baseline": None}
    if paper:
        state["mode"] = "paper"
        state["targets"] = {"cash": "100", **{a: "0" for a in ALIASES}}
        state["baseline"] = {"cash": str(INITIAL), "holdings": state["holdings"].copy()}
    return state


class Engine:
    def __init__(self, market):
        self.market = market

    def now(self, s):
        return datetime.fromisoformat(s["now"])

    def nav(self, s):
        return D(s["cash"]) + sum(D(s["holdings"][a]) * self.market.quote(a, self.now(s)) for a in ALIASES)

    def editable(self, s):
        if s["status"] != "paused":
            raise ValueError("시장 재생을 일시정지한 후 주문하세요.")
        if s["pending"]:
            raise ValueError("대기 주문이 있습니다. 취소하거나 시장을 재개해 체결하세요.")

    def start(self, s, allocation):
        if s.get("mode") == "paper":
            raise ValueError("모의투자는 초기 비중 설정 없이 시작하세요.")
        if s["status"] != "ready":
            raise ValueError("이미 시작된 게임입니다.")
        w = weights(allocation)
        s["targets"] = {a: str(v) for a, v in w.items()}
        at = self.market.next_open(self.now(s))
        s["pending"] = {"kind": "initial", "at": at.isoformat(), "weights": s["targets"].copy()}
        s["status"] = "running"

    def play(self, s):
        if s.get("mode") != "paper" or s["status"] != "ready":
            raise ValueError("시작 전 모의투자만 시작할 수 있습니다.")
        s["status"] = "running"

    def order(self, s, asset, side, amount=None, percent=None, quantity=None):
        self.editable(s)
        if asset not in ALIASES or side not in ("buy", "sell"):
            raise ValueError("거래할 수 없는 상품 또는 주문입니다.")
        if sum(v is not None for v in (amount, percent, quantity)) != 1:
            raise ValueError("금액, 수량, 비율 중 하나를 입력하세요.")
        if quantity is not None:
            if side != "sell":
                raise ValueError("수량 주문은 매도에서만 사용할 수 있습니다.")
            quantity, budget = number(quantity), None
        elif percent is not None:
            p = number(percent)
            if not 0 < p <= 100:
                raise ValueError("주문 비율은 0 초과 100% 이하여야 합니다.")
            quantity = D(s["holdings"][asset]) * p / 100 if side == "sell" else None
            budget = D(s["cash"]) * p / 100 if side == "buy" else None
        else:
            n = number(amount)
            if n <= 0:
                raise ValueError("주문 금액은 0보다 커야 합니다.")
            budget = n if side == "buy" else None
            quantity = n / self.market.quote(asset, self.now(s)) if side == "sell" else None
        if side == "buy" and (budget <= 0 or budget > D(s["cash"])):
            raise ValueError("가용 현금이 부족합니다. 매수 금액은 수수료를 포함합니다.")
        if side == "sell" and (quantity <= 0 or quantity > D(s["holdings"][asset])):
            raise ValueError("보유 수량이 부족합니다.")
        s["pending"] = {"kind": "trade", "at": self.market.next_open(self.now(s)).isoformat(),
                        "asset": asset, "side": side,
                        "budget": str(budget) if budget is not None else None,
                        "quantity": str(quantity) if quantity is not None else None}

    def rebalance(self, s, allocation):
        if s.get("mode") == "paper":
            raise ValueError("모의투자에서는 종목별 매수·매도를 사용하세요.")
        self.editable(s)
        w = weights(allocation)
        s["targets"] = {a: str(v) for a, v in w.items()}
        s["pending"] = {"kind": "rebalance", "at": self.market.next_open(self.now(s)).isoformat(),
                        "weights": s["targets"].copy()}

    def trade(self, s, asset, side, price, budget=None, quantity=None, reason="manual"):
        if side == "buy":
            gross = budget / (1 + FEE)
            quantity = gross / price
            fee = budget - gross
            s["cash"] = str(D(s["cash"]) - budget)
            s["costs"][asset] = str(D(s["costs"][asset]) + budget)
            s["holdings"][asset] = str(D(s["holdings"][asset]) + quantity)
        else:
            held = D(s["holdings"][asset])
            quantity = min(quantity, held)
            gross = quantity * price
            fee = gross * FEE
            cost = D(s["costs"][asset]) * quantity / held
            s["realized"] = str(D(s["realized"]) + gross - fee - cost)
            s["costs"][asset] = str(D(s["costs"][asset]) - cost)
            s["holdings"][asset] = str(held - quantity)
            s["cash"] = str(D(s["cash"]) + gross - fee)
        s["fees"] = str(D(s["fees"]) + fee)
        s["trades"].append({"at": s["now"], "asset": asset, "side": side,
                            "quantity": str(quantity), "price": str(price), "gross": str(gross),
                            "fee": str(fee), "reason": reason})

    def execute(self, s):
        p = s["pending"]
        if not p or p["at"] != s["now"]:
            return
        prices = {a: self.market.open_price(a, self.now(s)) for a in ALIASES}
        if p["kind"] == "trade":
            self.trade(s, p["asset"], p["side"], prices[p["asset"]],
                       budget=D(p["budget"]) if p["budget"] is not None else None,
                       quantity=D(p["quantity"]) if p["quantity"] is not None else None)
        elif p["kind"] == "initial":
            for a in ALIASES:
                budget = INITIAL * D(p["weights"][a]) / 100
                if budget > 0:
                    self.trade(s, a, "buy", prices[a], budget=budget, reason="initial")
            s["baseline"] = {"cash": s["cash"], "holdings": copy.deepcopy(s["holdings"])}
        else:
            current = {a: D(s["holdings"][a]) * prices[a] for a in ALIASES}
            nav = D(s["cash"]) + sum(current.values())
            w = {a: D(p["weights"][a]) / 100 for a in ALIASES}
            # Solve post-fee NAV so all targets, including cash=0, remain affordable.
            lo, hi = D(0), nav
            for _ in range(100):
                mid = (lo + hi) / 2
                required = mid + FEE * sum(abs(mid * w[a] - current[a]) for a in ALIASES)
                if required > nav:
                    hi = mid
                else:
                    lo = mid
            target = {a: lo * w[a] for a in ALIASES}
            for a in ALIASES:
                if current[a] > target[a]:
                    self.trade(s, a, "sell", prices[a], quantity=(current[a] - target[a]) / prices[a], reason="rebalance")
            for a in ALIASES:
                if target[a] > current[a]:
                    budget = min((target[a] - current[a]) * (1 + FEE), D(s["cash"]))
                    if budget > 0:
                        self.trade(s, a, "buy", prices[a], budget=budget, reason="rebalance")
        s["pending"] = None
        assert D(s["cash"]) >= D("-0.000001"), "Ledger cash invariant"

    def record(self, s):
        nav = self.nav(s)
        s["peak"] = str(max(D(s["peak"]), nav))
        s["mdd"] = str(max(D(s["mdd"]), (D(s["peak"]) - nav) / D(s["peak"])))
        entry = {"time": s["now"], "value": float(nav)}
        if s["history"][-1]["time"] == s["now"]:
            s["history"][-1] = entry
        else:
            s["history"].append(entry)

    def guard(self, s):
        now = self.now(s)
        if s["last_alert"] and now - datetime.fromisoformat(s["last_alert"]) < timedelta(days=14):
            return None
        nav = self.nav(s)
        for a in ALIASES:
            held = D(s["holdings"][a]) > 0
            fraction = D(s["holdings"][a]) * self.market.quote(a, now) / nav
            rows = self.market.completed(a, now)
            # Only fully closed UTC weeks. Sunday candle completes Monday 09:00 KST.
            weeks = [r for r in rows if datetime.fromisoformat(r["day"]).weekday() == 6]
            closes = [float(r["close"]) for r in weeks[-21:]]
            reason = None
            side = "sell"
            if held and fraction > D("0.60"):
                reason = f"단일 자산 비중이 {float(fraction)*100:.1f}%로 높습니다. 집중 위험을 줄이는 분할 매도를 검토하세요."
            if len(closes) >= 15:
                changes = [b - x for x, b in zip(closes[-15:], closes[-14:])]
                gain, loss = sum(max(v, 0) for v in changes), sum(max(-v, 0) for v in changes)
                rsi = 100 * gain / (gain + loss) if gain + loss else 50
                if held and rsi > 75:
                    reason = "완료된 주봉의 상승 강도가 높습니다. 과열 및 되돌림 위험에 대비한 분할 매도를 검토하세요."
                elif reason is None and rsi < 30 and D(s["cash"]) / nav >= D("0.20"):
                    side = "buy"
                    reason = "완료된 주봉에서 하락 강도가 높고 현금 여력이 있습니다. 손실 확대 가능성에 유의하며 여유 현금의 일부로 분할 매수를 검토하세요."
            if held and len(rows) >= 2 and rows[-1]["close"] / rows[-2]["close"] - 1 < D("-0.10"):
                side = "sell"
                reason = "확정된 일봉에서 큰 하락이 관찰됐습니다. 변동성과 손실 위험에 대비해 비중 축소를 검토하세요."
            signal_id = f"risk-{a}-{weeks[-1]['day'] if weeks else now.date()}"
            if reason and signal_id not in s["seen_signals"]:
                s["seen_signals"].append(signal_id)
                return {"id": signal_id, "at": s["now"], "kind": "risk", "asset": a, "side": side,
                        "title": f"코인 {a} · 분할 {'매수' if side == 'buy' else '매도'} 검토", "summary": reason, "percent": 20,
                        "decision": None}
        return None

    def advance(self, s, seconds):
        if s["status"] != "running":
            return
        elapsed = min(DURATION, s["elapsed"] + max(0, seconds))
        target = START + timedelta(seconds=SPAN * elapsed / DURATION)
        now = self.now(s)
        points = self.market.points[bisect.bisect_right(self.market.points, now):]
        for at in points:
            if at > target:
                break
            s["now"] = at.isoformat()
            s["elapsed"] = (at - START).total_seconds() / SPAN * DURATION
            self.execute(s)
            self.record(s)
            if at >= END:
                s["status"] = "finished"
                s["elapsed"] = DURATION
                return
            if s.get("mode") == "paper":
                continue  # Manual trading has no research releases or automatic alerts.
            new_docs = [e for e in self.market.events if datetime.fromisoformat(e["available_at_kst"]) == at]
            alert = ({"id": "news-" + new_docs[0]["event_id"], "at": s["now"], "kind": "research",
                     "title": "새로운 공식 자료가 공개됐습니다", "summary": "현재 날짜에 공개된 투자자료를 확인하고 판단할 수 있습니다.",
                     "asset": new_docs[0]["asset_alias"], "decision": None} if new_docs else self.guard(s))
            if alert:
                s["alerts"].append(alert)
                s["last_alert"] = s["now"]
                s["status"] = "paused"
                return
        s["now"] = target.isoformat()
        s["elapsed"] = elapsed

    def decide(self, s, alert_id, action, percent=None):
        if s["status"] != "paused":
            raise ValueError("일시정지 상태에서 제안을 확인하세요.")
        alert = next((a for a in s["alerts"] if a["id"] == alert_id), None)
        if not alert or alert["decision"] is not None or action not in ("accept", "modify", "ignore"):
            raise ValueError("이미 처리했거나 유효하지 않은 제안입니다.")
        if action != "ignore":
            if alert["kind"] != "risk":
                raise ValueError("자료 알림에는 매매 제안이 없습니다.")
            self.order(s, alert["asset"], alert.get("side", "sell"), percent=percent if action == "modify" else alert["percent"])
        alert["decision"] = action
        s["choices"].append({"alert_id": alert_id, "at": s["now"], "action": action,
                             "percent": percent if action == "modify" else alert.get("percent")})

    def public(self, s, alias="A"):
        if alias not in ALIASES:
            raise ValueError("지원하지 않는 상품입니다.")
        now, nav = self.now(s), self.nav(s)
        completed = {a: self.market.completed(a, now) for a in ALIASES}
        holdings = [{"asset": a, "quantity": s["holdings"][a],
                    "average_cost": float(D(s["costs"][a]) / D(s["holdings"][a])) if D(s["holdings"][a]) else 0,
                    "change_pct": float((completed[a][-1]["close"] / completed[a][-2]["close"] - 1) * 100),
                    "price": float(self.market.quote(a, now)),
                    "value": float(D(s["holdings"][a]) * self.market.quote(a, now)),
                    "weight": float(D(s["holdings"][a]) * self.market.quote(a, now) / nav * 100),
                    "unrealized": float(D(s["holdings"][a]) * self.market.quote(a, now) - D(s["costs"][a]))}
                    for a in ALIASES]
        public = {k: copy.deepcopy(s[k]) for k in ("status", "elapsed", "now", "targets", "pending", "alerts", "choices")}
        public.update({"initial": float(INITIAL), "duration": DURATION, "nav": float(nav),
            "cash": float(D(s["cash"])), "return_pct": float((nav / INITIAL - 1) * 100),
            "realized": float(D(s["realized"])), "unrealized": sum(h["unrealized"] for h in holdings),
            "fees": float(D(s["fees"])), "mdd_pct": float(D(s["mdd"]) * 100),
            "holdings": holdings, "chart": self.market.public_chart(alias, now), "chart_asset": alias,
            "research": [] if s.get("mode") == "paper" else self.market.research(now), "trades": copy.deepcopy(s["trades"]),
            "history": copy.deepcopy(s["history"]), "guard": "always_on", "fee_rate": float(FEE)})
        if s["status"] == "finished":
            public["identities"] = {"A": "비트코인 · BTC", "B": "이더리움 · ETH", "C": "솔라나 · SOL", "D": "도지코인 · DOGE"}
            b = s["baseline"]
            baseline_nav = D(b["cash"]) + sum(D(b["holdings"][a]) * self.market.quote(a, now) for a in ALIASES)
            public["baseline_return_pct"] = float((baseline_nav / INITIAL - 1) * 100)
        if s.get("mode") == "paper":
            # The paper UI has an explicit public contract; legacy system fields stay private.
            allowed = ("status", "elapsed", "now", "pending", "initial", "duration", "nav", "cash",
                       "return_pct", "realized", "unrealized", "fees", "mdd_pct", "holdings", "chart",
                       "chart_asset", "trades", "history", "fee_rate", "identities")
            public = {k: public[k] for k in allowed if k in public}
            public["mode"] = "paper"
        return public
