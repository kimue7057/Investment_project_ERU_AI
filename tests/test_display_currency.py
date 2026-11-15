import re
from pathlib import Path
from decimal import Decimal

from backend.app.display_currency import FX_NUMERATOR, FX_DENOMINATOR, sgd_money
from backend.app.result_mail import report_content


def test_frontend_and_email_use_the_same_fixed_reference():
    source=(Path(__file__).resolve().parents[1]/"frontend/src/bitcoin/currency.js").read_text(encoding="utf-8")
    assert int(re.search(r"numerator:(\d+)",source)[1])==FX_NUMERATOR
    assert int(re.search(r"denominator:(\d+)",source)[1])==FX_DENOMINATOR
    assert sgd_money(Decimal("103807249.23"))=="S$100,000.00"
    assert sgd_money(Decimal("-103807249.23"))=="S$-100,000.00"


def test_report_currency_changes_without_changing_performance():
    metric={"value":103807249.23,"mdd_pct":-18.2}
    report={"amount":103807249.23,"cycles":[{"name":"1차 사이클","start":"2016-07-01","end":"2020-04-30",
        "metrics":{"hold":metric,"guard":metric,"difference":0}}]}
    ko_html,ko_text=report_content(report)
    en_html,en_text=report_content({**report,"locale":"en"})
    assert 'lang="ko"' in ko_html and "103,807,249원" in ko_text
    assert 'lang="en"' in en_html and "S$100,000.00" in en_text
    assert "-18.2%" in ko_text and "-18.2%" in en_text
    assert "2026-11-13" in en_text and "Historical FX movements" in en_text
    assert report["amount"]==103807249.23 and "locale" not in report
