"""Fail closed: verify complete real candles and retain provenance + hashes."""
import csv
import hashlib
import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = date(2022, 11, 7)
END = date(2026, 8, 5)
WARMUP = START - timedelta(days=224)


def validate(root=ROOT):
    report = {"collected_verified_at": datetime.now(timezone.utc).isoformat(),
              "source": "https://api.upbit.com/v1/candles/days", "assets": {},
              "note": "Internal local evaluation. No market datasets committed or distributed."}
    for alias in "ABCD":
        path = root / "data/normalized" / f"{alias}_upbit_ohlcv_daily.csv"
        issues = []
        rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
        seen = [r["session_date"] for r in rows]
        expected = [(WARMUP + timedelta(days=i)).isoformat()
                    for i in range((END - WARMUP).days + 1)]
        if seen != expected:
            issues.append("Missing, duplicate or unordered daily observations")
        for row in rows:
            o, h, l, c, v = [float(row[k]) for k in ("open", "high", "low", "close", "volume")]
            if not all(math.isfinite(x) for x in (o, h, l, c, v)) or not (0 < l <= min(o, c) <= max(o, c) <= h) or v < 0:
                issues.append(f"Invalid OHLCV: {row['session_date']}")
            d = date.fromisoformat(row["session_date"]) + timedelta(days=1)
            if row["price_available_at_kst"] != f"{d}T09:00:00+09:00":
                issues.append(f"Invalid availability: {row['session_date']}")
            if (row["asset_alias"] != alias or row["currency"] != "KRW" or row["data_source"] != "official_api"
                or row["source_pair"] != {"A": "KRW-BTC", "B": "KRW-ETH", "C": "KRW-SOL", "D": "KRW-DOGE"}[alias]
                or row["source_quote_time_utc"] != row["session_date"] + "T00:00:00"):
                issues.append("Invalid provenance/currency/alias")
        report["assets"][alias] = {"rows": len(rows), "first": seen[0] if seen else None,
             "last": seen[-1] if seen else None, "game_rows": sum(START.isoformat() <= d <= END.isoformat() for d in seen),
             "warmup_rows": sum(d < START.isoformat() for d in seen),
             "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "issues": issues,
             "passed": not issues}
    report["passed"] = all(a["passed"] for a in report["assets"].values())
    report["raw_pages"] = [{"file": str(p.relative_to(root)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                           for p in sorted((root / "data/raw/upbit").glob("*/*.json"))]
    target = root / "data/metadata/validation.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


if __name__ == "__main__":
    result = validate()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["passed"] else 1)
