@echo off
setlocal
cd /d "%~dp0.."
python scripts\collect_upbit.py
python scripts\collect_kr_stocks.py
python -m unittest discover -s tests -v
python scripts\create_snapshots.py
python scripts\validate_prices.py
pause
