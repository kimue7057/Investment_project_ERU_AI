"""Record whether bulk data providers are reachable, without inventing results."""
import json,socket
from datetime import datetime,timezone
from pathlib import Path
hosts=['api.upbit.com','query1.finance.yahoo.com','query2.finance.yahoo.com','news.samsung.com','solana.com']
probe={}
for h in hosts:
    try:
        value=socket.getaddrinfo(h,443)
        probe[h]={'dns':'RESOLVED','addresses':len(value)}
    except Exception as e:
        probe[h]={'dns':'BLOCKED','error':type(e).__name__+': '+str(e)}
p=Path(__file__).resolve().parents[1]/'reports'/'network_access.json'
p.write_text(json.dumps({'checked_at_utc':datetime.now(timezone.utc).isoformat(),'hosts':probe},indent=2),encoding='utf-8')
print(json.dumps(probe,indent=2))
