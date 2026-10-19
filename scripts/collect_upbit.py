#!/usr/bin/env python3
"""Download original Upbit KRW daily candles and normalize to a point-in-time schema.

The exchange defines UTC 00:00 daily candle boundaries, which are 09:00 KST.
A candle identified by UTC date D closes at 09:00 KST on date D+1.
Do not serve its OHLC or closing price before that timestamp.
"""
from __future__ import annotations
import argparse, csv, json, time, hashlib
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
UPBIT='https://api.upbit.com/v1/candles/days'
MARKETS={'A':'KRW-BTC','B':'KRW-ETH','C':'KRW-SOL','D':'KRW-DOGE'}
START=date(2022,11,7);END=date(2026,8,5)
WARMUP_START=START-timedelta(days=224)
KST=ZoneInfo('Asia/Seoul')
COLUMNS=['asset_alias','session_date','session_end_at_kst','price_available_at_kst','open','high','low','close','volume','turnover_krw','currency','exchange','data_source','source_pair','source_quote_time_utc']

def fetch_json(url,retries=4):
    err=None
    for i in range(retries):
        try:
            req=Request(url,headers={'Accept':'application/json','User-Agent':'ERUResearchSample/0.1 public candle reader'})
            with urlopen(req,timeout=25) as resp:
                data=resp.read()
                return json.loads(data),data
        except Exception as e:
            err=e;time.sleep(min(1.2*(2**i),6))
    raise RuntimeError(f'HTTP request failed: {url}: {err}')

def normalize(alias,items):
    found={}
    for x in items:
        day=date.fromisoformat(x['candle_date_time_utc'][:10])
        if not (WARMUP_START<=day<=END):continue
        available=datetime.combine(day+timedelta(days=1),datetime.min.time(),tzinfo=timezone.utc).astimezone(KST)
        found[str(day)]={
            'asset_alias':alias,'session_date':str(day),
            'session_end_at_kst':available.isoformat(),
            'price_available_at_kst':available.isoformat(),
            'open':x['opening_price'],'high':x['high_price'],'low':x['low_price'],
            'close':x['trade_price'],'volume':x['candle_acc_trade_volume'],
            'turnover_krw':x.get('candle_acc_trade_price',''),
            'currency':'KRW','exchange':'UPBIT','data_source':'official_api',
            'source_pair':x['market'],'source_quote_time_utc':x['candle_date_time_utc']}
    return [found[x] for x in sorted(found)]

def collect(alias,wait=0.23):
    collected_start=datetime.now(timezone.utc).isoformat()
    market=MARKETS[alias]
    out=ROOT/'data'/'raw'/'upbit'/alias;out.mkdir(parents=True,exist_ok=True)
    cutoff=datetime.combine(END+timedelta(days=1),datetime.min.time(),tzinfo=timezone.utc)
    raw=[]; urls=[]
    for page in range(25):
        params={'market':market,'to':cutoff.isoformat().replace('+00:00','Z'),'count':200}
        url=UPBIT+'?'+urlencode(params)
        records,body=fetch_json(url)
        if not isinstance(records,list) or not records:break
        (out/f'page_{page+1:02d}.json').write_bytes(body)
        urls.append(url);raw.extend(records)
        earliest=min(date.fromisoformat(row['candle_date_time_utc'][:10]) for row in records)
        if earliest<WARMUP_START:break
        new_cutoff=datetime.combine(earliest,datetime.min.time(),tzinfo=timezone.utc)
        if new_cutoff>=cutoff:raise RuntimeError('Pagination cursor did not advance')
        cutoff=new_cutoff
        time.sleep(wait)
    rows=normalize(alias,raw)
    csvpath=ROOT/'data'/'normalized'/f'{alias}_upbit_ohlcv_daily.csv'
    csvpath.parent.mkdir(parents=True,exist_ok=True)
    with csvpath.open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=COLUMNS);w.writeheader();w.writerows(rows)
    expected=(END-START).days+1
    seen=set(row['session_date'] for row in rows if START<=date.fromisoformat(row['session_date'])<=END)
    missing=[str(START+timedelta(days=i)) for i in range(expected) if str(START+timedelta(days=i)) not in seen]
    return {'asset_alias':alias,'ticker_private':market,'status':'COMPLETE' if not missing else 'PARTIAL_REVIEW_REQUIRED',
            'collection_started_at_utc':collected_start,'collection_completed_at_utc':datetime.now(timezone.utc).isoformat(),
            'sha256':hashlib.sha256(csvpath.read_bytes()).hexdigest(),
            'rows':len(rows),'game_window_rows':len(seen),'warmup_rows':len(rows)-len(seen),'expected_calendar_days':expected,
            'first':rows[0]['session_date'] if rows else None,
            'last':rows[-1]['session_date'] if rows else None,
            'missing_days':missing,'api_requests':urls,'output_file':str(csvpath.relative_to(ROOT)),
            'readme':'Upbit sessions run 09:00 KST -> next day 09:00 KST. All OHLCV becomes known only after close.'}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--assets',nargs='+',choices=list(MARKETS),default=list(MARKETS))
    args=parser.parse_args()
    report={}
    for alias in args.assets:
        print(f'Collecting {alias}... ',flush=True)
        try:report[alias]=collect(alias)
        except Exception as e:report[alias]={'status':'FAILED_NO_DATA','error':str(e)}
        print(report[alias]['status'],report[alias].get('rows',0))
    p=ROOT/'reports'/'upbit_download_status.json';p.parent.mkdir(exist_ok=True)
    p.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
    if any(x['status']=='FAILED_NO_DATA' for x in report.values()):raise SystemExit(2)
if __name__=='__main__':main()
