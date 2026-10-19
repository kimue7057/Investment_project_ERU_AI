"""Point-in-time data gate for an anonymous historical investment game.

Zero future observations. A source appears only when published and verified.
All true market names, original URLs and future release existence stay internal.
Do not use end-of-day OHLC until its documented price_available_at_kst.
"""
from __future__ import annotations
import csv,json,re
from datetime import datetime,date,time,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
KST=ZoneInfo('Asia/Seoul')
START=date(2022,11,7)
END=date(2026,8,5)
PUBLIC_EVENT_KEYS=('event_id','asset_alias','published_on','document_type','public_title','public_summary')
PUBLIC_CANDLE_KEYS=('asset_alias','session_date','open','high','low','close','volume')
PUBLIC_ALIASES={'A','B','C','D','E','F','G'}
FORBIDDEN_RE=re.compile(r'bitcoin|ethereum|solana|dogecoin|samsung|nasdaq|tiger|\b(?:BTC|ETH|SOL|DOGE)\b|005930|133690|329200|(?:https?://)',re.I)


def parse_instant(value):
    """Offset-aware ISO datetime in KST. Date-only -> 23:59:59 KST."""
    if isinstance(value,datetime):dt=value
    elif isinstance(value,date):dt=datetime.combine(value,time(23,59,59),tzinfo=KST)
    elif isinstance(value,str) and len(value)==10:dt=datetime.combine(date.fromisoformat(value),time(23,59,59),tzinfo=KST)
    else:dt=datetime.fromisoformat(value)
    if dt.tzinfo is None:raise ValueError('Simulation timestamp must have a timezone')
    return dt.astimezone(KST)


def load_event_registry():
    return json.loads((ROOT/'sources'/'source_events.json').read_text(encoding='utf-8'))


def public_research(events,now,asset_alias=None,allow_candidate_previews=False):
    """Return only prior publications, with no original links, real names or future counts."""
    when=parse_instant(now)
    if asset_alias is not None and asset_alias not in PUBLIC_ALIASES:raise ValueError('Invalid public asset alias')
    visible=[]
    for ev in events:
        if asset_alias is not None and ev['asset_alias']!=asset_alias:continue
        if parse_instant(ev['available_at_kst'])>when:continue
        status=ev.get('evidence_status','').lower()
        if 'verified' not in status:continue
        if status.endswith('_candidate') and not allow_candidate_previews:continue
        item={k:ev[k] for k in PUBLIC_EVENT_KEYS}
        for key in ('public_title','public_summary'):
            if FORBIDDEN_RE.search(item[key]):raise ValueError('Identity leak in '+ev['event_id'])
        visible.append(item)
    visible.sort(key=lambda d:(d['published_on'],d['event_id']),reverse=True)
    return visible


def public_market(candles,now,asset_alias=None,lookback=45):
    """Return completed historical candles only. Never disclose future range bounds."""
    when=parse_instant(now)
    if asset_alias is not None and asset_alias not in PUBLIC_ALIASES:raise ValueError('Invalid asset alias')
    visible=[]
    for c in candles:
        if asset_alias is not None and c.get('asset_alias')!=asset_alias:continue
        if parse_instant(c['price_available_at_kst'])>when:continue
        if date.fromisoformat(c['session_date'])>when.date():continue
        item={k:c[k] for k in PUBLIC_CANDLE_KEYS if k in c}
        visible.append(item)
    visible.sort(key=lambda c:(c['asset_alias'],c['session_date']))
    # A single asset's chart is selected by UI. Do not send future count or full source labels.
    return visible[-lookback:] if lookback else visible


def next_execution_candle(rows,submitted_at):
    """Find the next day whose opening is strictly after order submission.

    On daily-only replay opening time is a proxy execution rule, not a live fill.
    KRX equity open: 09:00 KST on session_date.
    Upbit UTC session open: 09:00 KST on session_date.
    Orders should be matched at the first eligible opening after submission.
    """
    dt=parse_instant(submitted_at)
    eligible=[]
    for x in rows:
        day=date.fromisoformat(x['session_date'])
        open_time=datetime.combine(day,time(9,0),tzinfo=KST)
        if open_time>dt:eligible.append((open_time,x))
    if not eligible:return None
    return sorted(eligible,key=lambda p:p[0])[0][1]


def assemble_public_state(events,candles,now,alias,allow_candidate_previews=False):
    if alias not in PUBLIC_ALIASES:raise ValueError('Alias only')
    return {'display_symbol':alias,'as_of':parse_instant(now).isoformat(),
            'research':public_research(events,now,alias,allow_candidate_previews=allow_candidate_previews),
            'recent_candles':public_market(candles,now,alias,lookback=45),
            'guard_state':'always_on'}


def validate_no_identifiers(public_state):
    flat=json.dumps(public_state,ensure_ascii=False)
    if FORBIDDEN_RE.search(flat):raise AssertionError('Public response reveals actual identity or source URL')
    return True


def read_candles(path):
    with Path(path).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))


def public_fundamentals(candidate_rows, now, allow_candidate_previews=False):
    """Optional PUBLIC financial fact cards, unlocked by issuer publication time.

    Candidate E must be approved for production. This method never returns
    private issuer identifiers, URLs, or metrics for future reporting periods.
    """
    if not allow_candidate_previews:
        return []
    when=parse_instant(now)
    cards=[]
    for row in candidate_rows:
        if parse_instant(row['available_at_kst'])>when:
            continue
        cards.append({
            'asset_alias':row['alias'],'period':row['period'],
            'published_on':row['published_on'],
            'sales_krw_trillion':float(row['sales_krw_trillion']),
            'operating_profit_krw_trillion':float(row['operating_profit_krw_trillion']),
            'release_type':row['release_type']
        })
    cards.sort(key=lambda x:x['published_on'],reverse=True)
    return cards
