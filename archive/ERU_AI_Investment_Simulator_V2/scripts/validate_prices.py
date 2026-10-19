#!/usr/bin/env python3
"""Audit collected market files; never silently substitute invented prices."""
from __future__ import annotations
import csv,hashlib,json
from datetime import date,timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
START=date(2022,11,7);END=date(2026,8,5)
GAME_DAYS=(END-START).days+1
files=[];errors=[]
for alias in 'ABCDEFG':
    matches=list((ROOT/'data'/'normalized').glob(f'{alias}_*.csv'))
    if not matches:
        files.append({'asset_alias':alias,'status':'MISSING_NOT_DOWNLOADED','game_rows':0,'file':None})
        continue
    for path in matches:
        with path.open('r',encoding='utf-8',newline='') as f:rows=list(csv.DictReader(f))
        seen=[];broken=[]
        for row in rows:
            day=date.fromisoformat(row['session_date'])
            if START<=day<=END:seen.append(day)
            try:
                o,h,l,c=(float(row[k]) for k in ('open','high','low','close'))
                if not (l<=o<=h and l<=c<=h and l>0):broken.append(str(day))
            except (ValueError,TypeError):broken.append(str(day))
        ordered=sorted(set(seen))
        missing=[]
        if alias in 'ABCD':
            actual=set(ordered)
            missing=[str(START+timedelta(days=i)) for i in range(GAME_DAYS) if START+timedelta(days=i) not in actual]
        gaps_or_duplicate=len(ordered)!=len(seen)
        status='COMPLETE_GAME_WINDOW' if not (missing or broken or gaps_or_duplicate) and ordered and ordered[0]==START and ordered[-1]==END else 'REVIEW_REQUIRED'
        detail={'asset_alias':alias,'file':str(path.relative_to(ROOT)),'file_bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                'status':status,'total_rows':len(rows),'game_rows':len(seen),
                'first_game_date':str(ordered[0]) if ordered else None,'last_game_date':str(ordered[-1]) if ordered else None,
                'missing_game_days':missing[:25],'total_missing_game_days':len(missing),'invalid_OHLC_dates':broken[:25],
                'duplicate_dates':gaps_or_duplicate,'candidate_not_final':alias in 'EFG'}
        files.append(detail)
        if status!='COMPLETE_GAME_WINDOW':errors.append(detail['file'])
report={'game_window':{'start':str(START),'end':str(END),'calendar_days':GAME_DAYS},
        'files':files,'all_crypto_downloaded_and_qa_passed':all(any(r['asset_alias']==a and r['status']=='COMPLETE_GAME_WINDOW' for r in files) for a in 'ABCD'),
        'candidate_stocks_confirmed':False,
        'ready_for_live_game':False,
        'warning':'This report checks actual files. The absence of rows is NOT filled with synthetic prices. No equity candidate is final.'}
report['ready_for_live_game']=report['all_crypto_downloaded_and_qa_passed'] and report['candidate_stocks_confirmed']
out=ROOT/'reports'/'price_data_qa.json'
out.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({'crypto_qa_pass':report['all_crypto_downloaded_and_qa_passed'],'assets':[(x['asset_alias'],x['status'],x['game_rows']) for x in files]},indent=2))
