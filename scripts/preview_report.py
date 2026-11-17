"""완료 결과형 UI의 로컬 미리보기. 운영 DB·메일 발송과 분리한다."""
import os
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
os.environ.pop('VERCEL',None)
os.environ.pop('RESEND_API_KEY',None)
os.environ.pop('RESEND_FROM_EMAIL',None)
os.environ['ERU_LOCAL_PREVIEW']='1'
os.environ['ERU_DB_PATH']=str(Path(os.environ['LOCALAPPDATA'])/'ERU-AI'/'report-preview.sqlite3')

from backend.app.main import app  # noqa: E402,F401
