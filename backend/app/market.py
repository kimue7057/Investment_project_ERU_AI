"""Trusted data boundary. Only explicit, as-of public fields leave this module."""
import bisect
import csv
import hashlib
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from .assets import ASSET_NAMES

ROOT = Path(__file__).resolve().parents[2]
KST = timezone(timedelta(hours=9))
START = datetime(2022, 11, 7, tzinfo=KST)
END = datetime(2026, 8, 5, 23, 59, 59, tzinfo=KST)
ALIASES = "ABCD"


class Market:
    def __init__(self, root=ROOT):
        report = json.loads((root / "data/metadata/validation.json").read_text(encoding="utf-8"))
        if not report.get("passed"):
            raise ValueError("Real data validation has not passed")
        self.rows = {}
        for alias in ALIASES:
            path = root / "data/normalized" / f"{alias}_upbit_ohlcv_daily.csv"
            if hashlib.sha256(path.read_bytes()).hexdigest() != report["assets"][alias]["sha256"]:
                raise ValueError("Data hash mismatch; validate again")
            with path.open(encoding="utf-8-sig") as f:
                self.rows[alias] = [{"day": r["session_date"],
                    "at": datetime.fromisoformat(r["price_available_at_kst"]),
                    "opened": datetime.fromisoformat(r["session_date"] + "T09:00:00+09:00"),
                    **{k: Decimal(r[k]) for k in ("open", "high", "low", "close", "volume")}}
                    for r in csv.DictReader(f)]
        self.open_times = {a: [r["opened"] for r in rs] for a, rs in self.rows.items()}
        self.close_times = {a: [r["at"] for r in rs] for a, rs in self.rows.items()}
        self.events = json.loads((root / "data/sources/source_events_PRIVATE.json").read_text(encoding="utf-8"))
        self.events = [e for e in self.events if e["asset_alias"] in ALIASES and
                       e.get("evidence_status", "").startswith("verified") and "candidate" not in e["evidence_status"]]
        self.points = sorted({r["opened"] for r in self.rows["A"] if START < r["opened"] <= END} |
                             {datetime.fromisoformat(e["available_at_kst"]) for e in self.events
                              if START < datetime.fromisoformat(e["available_at_kst"]) <= END} | {END})

    def completed(self, alias, now):
        return self.rows[alias][:bisect.bisect_right(self.close_times[alias], now)]

    def quote(self, alias, now):
        oi = bisect.bisect_right(self.open_times[alias], now) - 1
        ci = bisect.bisect_right(self.close_times[alias], now) - 1
        opened, closed = self.rows[alias][oi], self.rows[alias][ci]
        return opened["open"] if opened["opened"] >= closed["at"] else closed["close"]

    def next_open(self, now):
        i = bisect.bisect_right(self.open_times["A"], now)
        if i == len(self.open_times["A"]) or self.open_times["A"][i] > END:
            raise ValueError("종료 전 다음 체결 시점이 없습니다. 현재 보유 자산으로 평가됩니다.")
        return self.open_times["A"][i]

    def open_price(self, alias, at):
        i = bisect.bisect_left(self.open_times[alias], at)
        if i == len(self.rows[alias]) or self.rows[alias][i]["opened"] != at:
            raise ValueError("검증된 체결 시세가 없습니다.")
        return self.rows[alias][i]["open"]

    def research(self, now, alias=None):
        keys = ("event_id", "asset_alias", "published_on", "document_type", "public_title", "public_summary")
        return [{k: e[k] for k in keys} for e in self.events
                if datetime.fromisoformat(e["available_at_kst"]) <= now
                and (alias is None or alias == e["asset_alias"])]

    def public_chart(self, alias, now):
        return [{"time": r["day"], **{k: float(r[k]) for k in ("open", "high", "low", "close", "volume")}}
                for r in self.completed(alias, now) if r["day"] >= START.date().isoformat()]


CATALOG = [
    {"alias": "A", "name": ASSET_NAMES["A"], "category": "DIGITAL ASSET", "overview": "중앙 운영자 없이 참여자가 거래 기록과 가치 이전을 검증하는 분산 네트워크입니다.",
     "technology": "작업 증명 기반 합의와 연결된 거래 기록으로 이중 지불을 방지하는 설계를 제안합니다.",
     "supply": "프로토콜에 발행 상한이 있으며 신규 발행 보상이 단계적으로 줄어드는 구조입니다.",
     "risks": ["큰 가격 변동과 유동성 변화", "채굴 참여 집중 및 에너지 비용", "보관 키 분실과 거래소 위험"], "document_label": "기술 백서 요약"},
    {"alias": "B", "name": ASSET_NAMES["B"], "category": "DIGITAL ASSET", "overview": "프로그램 가능한 계약과 분산 애플리케이션 실행을 지원하는 네트워크입니다.",
     "technology": "공유 실행 환경에서 계약 코드를 처리합니다. 2022년 공개된 공지는 합의 방식 전환 계획을 다룹니다.",
     "supply": "네트워크 보상으로 발행되며 일부 거래 수수료가 소각됩니다. 고정된 총발행 상한은 없습니다.",
     "risks": ["계약 코드 오류와 보안 취약점", "네트워크 혼잡과 수수료 변동", "업그레이드 및 검증 참여 집중 위험"], "document_label": "공식 기술·전환 공지"},
    {"alias": "C", "name": ASSET_NAMES["C"], "category": "DIGITAL ASSET", "overview": "많은 거래를 빠르게 처리하기 위해 시간과 거래 순서를 조정하는 네트워크입니다.",
     "technology": "검증 가능한 시간 순서와 지분 기반 검증을 결합합니다. 시작일 이전에 네트워크 중단 보고가 공개되었습니다.",
     "supply": "초기 발행과 네트워크 보상을 통한 추가 발행이 존재합니다. 유통량과 잠금 해제에 유의해야 합니다.",
     "risks": ["네트워크 중단과 재시작", "높은 운영 장비 요구 수준", "보유 물량 집중과 매도 압력"], "document_label": "공식 기술 해설·운영 보고"},
    {"alias": "D", "name": ASSET_NAMES["D"], "category": "DIGITAL ASSET", "overview": "커뮤니티 참여를 기반으로 소액 가치 이전에 활용되는 디지털자산입니다.",
     "technology": "작업 증명 방식으로 거래를 확인합니다. 공식 개발자 릴리스 노트를 기술자료로 제공합니다.",
     "supply": "지속적으로 신규 보상이 발행되는 구조이며 고정된 총발행 상한은 없습니다.",
     "risks": ["커뮤니티 관심과 투기 수요에 민감", "지속 발행에 따른 공급 증가", "가격 급변과 보관·거래소 위험"], "document_label": "공식 소프트웨어 자료 (정식 백서 아님)"},
    *[{"alias": a, "name": n, "category": c, "available": False, "overview": "실제 투자상품 선정 및 데이터 검증 후 연결됩니다. Alpha V1에서는 거래할 수 없습니다."}
      for a, n, c in [("E", "주식 E", "EQUITY"), ("F", "주식 F", "EQUITY ETF"), ("G", "부동산 G", "REAL ESTATE")]]
]
