"""고정 표시 환산율. 거래 장부·성과 계산과 분리한다."""
from decimal import Decimal, ROUND_HALF_UP

REFERENCE_DATE="2026-11-13"
FX_NUMERATOR=14778000
FX_DENOMINATOR=14236
KRW_PER_SGD=Decimal(FX_NUMERATOR)/Decimal(FX_DENOMINATOR)


def sgd_money(value):
    converted=(Decimal(str(value))/KRW_PER_SGD).quantize(Decimal("0.01"),rounding=ROUND_HALF_UP)
    return f"S${converted:,.2f}"
