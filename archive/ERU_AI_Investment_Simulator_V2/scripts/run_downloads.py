#!/usr/bin/env python3
"""Run collectors with transparent error statuses. Network access is mandatory."""
import subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
for name in ['collect_upbit.py','collect_kr_stocks.py','validate_prices.py']:
    print('===',name,'===',flush=True)
    result=subprocess.run([sys.executable,str(ROOT/'scripts'/name)],cwd=ROOT,check=False)
    if result.returncode:print('CHECK FAILURE:',name,'return code',result.returncode,flush=True)
print('Open reports/ to confirm downloaded row counts and missing dates. A script run is not proof that prices were collected.')
