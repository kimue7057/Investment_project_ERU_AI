"""Generate actual-source research snapshots for selected game dates, not fake prices."""
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from src.asof_engine import load_event_registry,public_research,validate_no_identifiers,assemble_public_state
records=load_event_registry()
for timestamp,name in [('2022-11-07T23:59:59+09:00','game_start'),('2022-11-18T23:59:59+09:00','first_news'),('2023-02-01T23:59:59+09:00','q4_released'),('2026-08-05T23:59:59+09:00','game_end')]:
    all_visible=public_research(records,timestamp)
    payload={'as_of':timestamp,'assets':{a:assemble_public_state(records,[],timestamp,a) for a in 'ABCDEFG'},
             'verified_research_items':len(all_visible),
             'note':'Price arrays intentionally empty until actual downloaded/validated market data exists.'}
    validate_no_identifiers(payload)
    out=ROOT/'snapshots'/f'{name}.json'
    out.write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
    print(name,'research items',len(all_visible),'source IDs',[i['event_id'] for i in all_visible])
