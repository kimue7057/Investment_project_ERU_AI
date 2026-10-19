import json
import copy
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .engine import Engine, fresh, weights
from .market import Market, ROOT, START, CATALOG

app = FastAPI(title="ERU AI Alpha V1", docs_url=None, redoc_url=None, openapi_url=None)
lock = threading.RLock()
anchors = {}
db_path = Path(os.environ.get("ERU_DB_PATH", str(ROOT / "data/runtime/sessions.sqlite3")))
db_path.parent.mkdir(parents=True, exist_ok=True)
db = sqlite3.connect(db_path, check_same_thread=False)
db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL)")
try:
    market = Market()
    engine = Engine(market)
    data_ready = True
except (OSError, ValueError, KeyError) as exc:
    market = engine = None
    data_ready = False


@app.middleware("http")
async def local_boundary(request: Request, call_next):
    # The server binds to loopback; block browser-origin cross-site mutations and DNS rebinding.
    host = request.headers.get("host", "").split(":")[0]
    if host not in ("127.0.0.1", "localhost", "testserver"):
        return JSONResponse({"detail": "로컬 접속만 허용됩니다."}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin not in ("http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:5173", "http://localhost:5173"):
        return JSONResponse({"detail": "동일 로컬 웹사이트에서 접속하세요."}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Allocation(Strict):
    weights: dict[str, float]


class Trade(Strict):
    asset: Literal["A", "B", "C", "D"]
    side: Literal["buy", "sell"]
    amount: float | None = Field(None, gt=0, le=1e16)
    percent: float | None = Field(None, gt=0, le=100)


class Decision(Strict):
    alert_id: str = Field(max_length=120)
    action: Literal["accept", "modify", "ignore"]
    percent: float | None = Field(None, gt=0, le=100)


def save(sid, state):
    db.execute("INSERT OR REPLACE INTO sessions VALUES (?, ?)", (sid, json.dumps(state)))
    db.commit()


def load(sid):
    if not data_ready:
        raise HTTPException(503, "검증된 시세 데이터가 없습니다. 데이터 수집 및 검증을 먼저 실행하세요.")
    row = db.execute("SELECT state FROM sessions WHERE id = ?", (sid,)).fetchone()
    if not row:
        raise HTTPException(404, "게임을 찾을 수 없습니다. 새 게임을 시작하세요.")
    state = json.loads(row[0])
    now = time.monotonic()
    if sid not in anchors and state["status"] == "running":
        state["status"] = "paused"  # Server restart never advances offline time.
    engine.advance(state, now - anchors.get(sid, now))
    anchors[sid] = now
    return state


def update(sid, action, alias="A"):
    with lock:
        state = load(sid)
        before = copy.deepcopy(state)
        try:
            action(state)
        except ValueError as exc:
            save(sid, before)  # Invalid orders cannot discard already elapsed market time.
            raise HTTPException(400, str(exc)) from exc
        save(sid, state)
        return {"id": sid, **engine.public(state, alias)}


@app.get("/api/health")
def health():
    return {"status": "ready" if data_ready else "data_required", "version": "Alpha V1"}


@app.get("/api/catalog")
def catalog():
    return {"as_of": START.isoformat(), "assets": CATALOG, "initial": 100000000,
            "duration": 300, "start": "2022-11-07", "end": "2026-08-05",
            "research": market.research(START) if data_ready else []}


@app.post("/api/sessions")
def create():
    if not data_ready:
        raise HTTPException(503, "시세 데이터 수집 및 검증이 필요합니다.")
    with lock:
        sid, state = str(uuid.uuid4()), fresh()
        save(sid, state)
        anchors[sid] = time.monotonic()
        return {"id": sid, **engine.public(state)}


@app.get("/api/sessions/{sid}")
def state(sid: str, asset: str = "A"):
    if asset not in "ABCD" or len(asset) != 1:
        raise HTTPException(400, "지원하지 않는 상품입니다.")
    return update(sid, lambda s: None, asset)


@app.post("/api/sessions/{sid}/start")
def start(sid: str, body: Allocation):
    return update(sid, lambda s: engine.start(s, body.weights))


@app.post("/api/sessions/{sid}/pause")
def pause(sid: str):
    def action(s):
        if s["status"] != "running":
            raise ValueError("재생 중인 게임만 일시정지할 수 있습니다.")
        s["status"] = "paused"
    return update(sid, action)


@app.post("/api/sessions/{sid}/resume")
def resume(sid: str):
    def action(s):
        if s["status"] != "paused":
            raise ValueError("일시정지한 게임만 재개할 수 있습니다.")
        for a in s["alerts"]:
            if a["decision"] is None:
                a["decision"] = "ignore"
                s["choices"].append({"alert_id": a["id"], "at": s["now"], "action": "ignore", "percent": None})
        s["status"] = "running"
    return update(sid, action)


@app.post("/api/sessions/{sid}/orders")
def trade(sid: str, body: Trade):
    return update(sid, lambda s: engine.order(s, body.asset, body.side, body.amount, body.percent))


@app.post("/api/sessions/{sid}/targets")
def targets(sid: str, body: Allocation):
    def action(s):
        if s["status"] not in ("ready", "paused"):
            raise ValueError("일시정지 후 목표 비중을 저장하세요.")
        s["targets"] = {a: str(v) for a, v in weights(body.weights).items()}
    return update(sid, action)


@app.post("/api/sessions/{sid}/rebalance")
def rebalance(sid: str, body: Allocation):
    return update(sid, lambda s: engine.rebalance(s, body.weights))


@app.post("/api/sessions/{sid}/cancel")
def cancel(sid: str):
    def action(s):
        if s["status"] != "paused" or not s["pending"] or s["pending"]["kind"] == "initial":
            raise ValueError("취소할 수 있는 대기 주문이 없습니다.")
        s["pending"] = None
    return update(sid, action)


@app.post("/api/sessions/{sid}/decision")
def decision(sid: str, body: Decision):
    return update(sid, lambda s: engine.decide(s, body.alert_id, body.action, body.percent))


dist = ROOT / "frontend/dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
