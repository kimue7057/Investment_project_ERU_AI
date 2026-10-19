#!/usr/bin/env python3
"""Candidate ONLY: collect daily unadjusted/adjusted KR stock & fund quote fields.

Yahoo Finance is a non-official experimental endpoint, not a licensed KRX market-data
feed. Production should replace it with a properly licensed KRX or vendor feed,
and apply dividends/splits/ETF distributions using verified historical events.
"""
from __future__ import annotations
import csv,json,time
from datetime import datetime,date,timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
CANDIDATES={'E':'005930.KS','F':'133690.KS','G':'329200.KS'}
KST=ZoneInfo('Asia/Seoul')
COLUMNS=['asset_alias','session_date','session_end_at_kst','price_available_at_kst','open','high','low','close','adjusted_close','volume','currency','exchange','data_source','source_pair','source_quote_time_utc']

def download(alias,ticker):
    begin=int(datetime(2022,11,1,tzinfo=timezone.utc).timestamp())
    end=int(datetime(2026,8,7,tzinfo=timezone.utc).timestamp())
    params={'period1':begin,'period2':end,'interval':'1d','events':'history,div,splits'}
    last=None;raw=None;url=None
    for host in ['query1.finance.yahoo.com','query2.finance.yahoo.com']:
        url='https://'+host+'/v8/finance/chart/'+ticker+'?'+urlencode(params)
        req=Request(url,headers={'Accept':'application/json','User-Agent':'Mozilla/5.0'})
        try:
            with urlopen(req,timeout=30) as resp:raw=resp.read();break
        except Exception as e:last=e;time.sleep(1)
    if raw is None:raise RuntimeError(f'No quote data from either endpoint: {last}')
    resp=json.loads(raw);results=resp.get('chart',{}).get('result') or []
    if not results:raise RuntimeError('Empty or error JSON: '+repr(resp.get('chart',{}).get('error')))
    data=results[0]
    meta=data.get('meta',{})
    quote=data['indicators']['quote'][0]
    adj=data.get('indicators',{}).get('adjclose') or [{}]
    closes=adj[0].get('adjclose',[])
    rows=[]
    for i,tstamp in enumerate(data.get('timestamp',[])):
        local=datetime.fromtimestamp(tstamp,tz=timezone.utc).astimezone(KST)
        session=local.date()
        if not (date(2022,11,7)<=session<=date(2026,8,5)):continue
        if any(quote[k][i] is None for k in ['open','high','low','close']):continue
        cutoff=datetime(session.year,session.month,session.day,15,40,tzinfo=KST)
        rows.append({'asset_alias':alias,'session_date':session.isoformat(),
          'session_end_at_kst':cutoff.isoformat(),'price_available_at_kst':cutoff.isoformat(),
          'open':quote['open'][i],'high':quote['high'][i],'low':quote['low'][i],
          'close':quote['close'][i],
          'adjusted_close':closes[i] if i<len(closes) and closes[i] is not None else '',
          'volume':quote['volume'][i] or 0,'currency':'KRW','exchange':'KRX',
          'data_source':'YAHOO_EXPERIMENTAL_CANDIDATE','source_pair':ticker,
          'source_quote_time_utc':datetime.fromtimestamp(tstamp,tz=timezone.utc).isoformat()})
    rows.sort(key=lambda r:r['session_date'])
    rawfile=ROOT/'data'/'raw'/'equities'/f'{alias}_yahoo_raw.json';rawfile.parent.mkdir(parents=True,exist_ok=True);rawfile.write_bytes(raw)
    out=ROOT/'data'/'normalized'/f'{alias}_equity_daily_CANDIDATE.csv'
    out.parent.mkdir(parents=True,exist_ok=True)
    with out.open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=COLUMNS);w.writeheader();w.writerows(rows)
    return {'status':'CANDIDATE_NONOFFICIAL_QA_REQUIRED','ticker_private':ticker,
      'rows':len(rows),'first':rows[0]['session_date'] if rows else None,
      'last':rows[-1]['session_date'] if rows else None,
      'raw_file':str(rawfile.relative_to(ROOT)),'output_file':str(out.relative_to(ROOT)),
      'quote_url':url,'currency':meta.get('currency'),
      'source_disclaimer':'Unofficial Yahoo quote data must not be used commercially without authorization.'}

def main():
    report={}
    for alias,ticker in CANDIDATES.items():
        print('Collecting candidate',alias,flush=True)
        try:report[alias]=download(alias,ticker)
        except Exception as e:report[alias]={'status':'FAILED_NO_DATA','ticker_private':ticker,'error':str(e)}
    p=ROOT/'reports'/'equity_download_status.json'
    p.write_text(json.dumps(report,indent=2),encoding='utf-8')
    if any(v['status']=='FAILED_NO_DATA' for v in report.values()):raise SystemExit(2)
if __name__=='__main__':main()
