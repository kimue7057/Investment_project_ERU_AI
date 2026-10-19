"""Record the earliest daily candle exposed by the official API (not an intraday listing timestamp)."""
import json
import time
from datetime import datetime, timezone
from collect_upbit import fetch_json, UPBIT, MARKETS
from urllib.parse import urlencode
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
report = {"checked_at": datetime.now(timezone.utc).isoformat(), "assets": {},
          "definition": "Earliest exchange daily candle returned by official paginated history; does not assert intraday listing time."}
for alias, pair in MARKETS.items():
    to = "2022-11-07T00:00:00Z"
    earliest = None
    requests = []
    for _ in range(40):
        url = UPBIT + "?" + urlencode({"market": pair, "to": to, "count": 200})
        rows, _ = fetch_json(url)
        requests.append(url)
        if not rows:
            break
        next_to = min(r["candle_date_time_utc"] for r in rows) + "Z"
        if next_to >= to:
            raise RuntimeError("Non-advancing cursor")
        earliest = next_to[:10]
        to = next_to
        time.sleep(.23)
    report["assets"][alias] = {"first_observed_daily_session": earliest, "available_at_game_start": earliest is not None and earliest <= "2022-11-07", "api_requests": requests}
    print(alias, earliest, flush=True)
(ROOT / "data/metadata/first_history_PRIVATE.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
