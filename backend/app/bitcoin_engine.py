"""비공개 비교 엔진의 검증된 로더. 공개 저장소에 운용 기준을 포함하지 않는다."""
import hashlib
import importlib.util
import json
import sys
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
FEE=Decimal("0.0005")
MODEL_VERSION="btc-guard-1"
CYCLES=(
    ("cycle-1","1차 사이클","2016-07-01","2020-04-30"),
    ("cycle-2","2차 사이클","2020-05-01","2023-06-30"),
    ("cycle-3","3차 사이클","2023-07-01","2026-05-31"),
)

@lru_cache(maxsize=1)
def implementation():
    manifest=json.loads((ROOT/"data/metadata/bitcoin_cycles_validation.json").read_text(encoding="utf-8"))
    path=ROOT/"data/private/bitcoin_engine_impl.py"
    if hashlib.sha256(path.read_bytes()).hexdigest()!=manifest["engine_sha256"]:
        raise ValueError("Private BTC engine checksum failed")
    spec=importlib.util.spec_from_file_location("eru_bitcoin_engine_private_v1",path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[spec.name]=module
    spec.loader.exec_module(module)
    if module.MODEL_VERSION!=MODEL_VERSION or module.CYCLES!=CYCLES or module.FEE!=FEE:
        raise ValueError("Private BTC engine version failed")
    return module

class BitcoinEngine:
    def __init__(self,candles=None):
        self._engine=implementation().BitcoinEngine(candles)

    def __getattr__(self,name):
        return getattr(self._engine,name)

def maximum_drop(history,key):
    return implementation().maximum_drop(history,key)
