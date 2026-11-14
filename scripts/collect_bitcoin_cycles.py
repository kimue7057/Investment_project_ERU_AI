"""BTC 단독 비교용 공식 일봉 수집. 원본·CSV는 Git에 포함하지 않는다."""
import csv
import gzip
import hashlib
import io
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
FIRST = date(2016, 5, 1)
LAST = date(2026, 5, 31)
SOURCE = "https://api.exchange.coinbase.com/products/BTC-USD/candles"
FIELDS = ["date", "open", "high", "low", "close", "volume"]


def validate_rows(rows):
    expected = [(FIRST + timedelta(days=i)).isoformat() for i in range((LAST-FIRST).days+1)]
    if [r["date"] for r in rows] != expected:
        raise ValueError("BTC daily candles contain a missing, duplicate or unordered day")
    for r in rows:
        o, h, low, c, v = [Decimal(r[k]) for k in FIELDS[1:]]
        if not all(x.is_finite() for x in (o,h,low,c,v)) or not 0 < low <= min(o,c) <= max(o,c) <= h or v < 0:
            raise ValueError("Invalid official BTC candle: "+r["date"])


def collect():
    raw = ROOT / "data/raw/bitcoin_cycles"
    raw.mkdir(parents=True, exist_ok=True)
    by_day = {}
    provenance = []
    with httpx.Client(timeout=40, headers={"User-Agent":"ERU-Research/1.0", "Accept":"application/json"}) as client:
        start = FIRST
        while start <= LAST:
            end = min(LAST+timedelta(days=1), start+timedelta(days=250))
            path = raw / (start.isoformat()+".json")
            if path.exists():
                body = path.read_bytes()
            else:
                for attempt in range(4):
                    response = client.get(SOURCE, params={"granularity":86400,
                        "start":start.isoformat()+"T00:00:00Z", "end":end.isoformat()+"T00:00:00Z"})
                    if response.status_code < 500 and response.status_code != 429:
                        break
                    time.sleep(1+attempt)
                response.raise_for_status()
                body = response.content
                path.write_bytes(body)
                time.sleep(.25)
            data = json.loads(body)
            if not isinstance(data,list):
                raise ValueError("Official BTC response is not a candle list")
            for record in data:
                if len(record) != 6:
                    raise ValueError("Unexpected official BTC candle shape")
                stamp, low, high, opened, closed, volume = record
                day = datetime.fromtimestamp(stamp,timezone.utc).date()
                if FIRST <= day <= LAST:
                    row = dict(zip(FIELDS,[day.isoformat(),str(opened),str(high),str(low),str(closed),str(volume)]))
                    if day.isoformat() in by_day and by_day[day.isoformat()] != row:
                        raise ValueError("Conflicting official BTC candles")
                    by_day[day.isoformat()] = row
            provenance.append({"file":str(path.relative_to(ROOT)),"sha256":hashlib.sha256(body).hexdigest()})
            print("verified page",start.isoformat(),flush=True)
            start = end
    rows = [by_day[k] for k in sorted(by_day)]
    validate_rows(rows)
    buf = io.StringIO(newline="")
    writer = csv.DictWriter(buf,fieldnames=FIELDS,lineterminator="\n")
    writer.writeheader();writer.writerows(rows)
    content = buf.getvalue().encode()
    target = ROOT / "data/normalized/bitcoin_cycles.csv"
    target.write_bytes(content)
    bootstrap = ROOT / "data/bootstrap"
    bootstrap.mkdir(parents=True,exist_ok=True)
    (bootstrap/"bitcoin_cycles.csv.gz").write_bytes(gzip.compress(content,mtime=0))
    report = {"passed":True,"source":SOURCE,"pair":"BTC-USD","granularity":86400,
        "rows":len(rows),"first":rows[0]["date"],"last":rows[-1]["date"],
        "sha256":hashlib.sha256(content).hexdigest(),"collected_at":datetime.now(timezone.utc).isoformat(),
        "execution":"signal after completed daily close; execute at following daily open",
        "raw_pages":provenance}
    (ROOT/"data/metadata/bitcoin_cycles_validation.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps({k:report[k] for k in ("passed","rows","first","last","sha256")}))


if __name__ == "__main__":
    collect()
