import json
import copy
import os
import sqlite3
import threading
import time
import uuid
import logging
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .engine import Engine, fresh, weights
from .market import Market, ROOT, START, CATALOG
from .blob_store import BlobSessions, StorageConflict
from .mentor import discuss
from .risk_policy import validate_rules

app = FastAPI(title="ERU AI Alpha V1", docs_url=None, redoc_url=None, openapi_url=None)
lock = threading.RLock()
anchors = {}
log = logging.getLogger("eru.cloud")


def storage_failure(operation, exc):
    response = getattr(exc, "response", None)
    code = "unavailable"
    if response is not None:
        try:
            candidate = response.json().get("error", {}).get("code", "unknown")
            if isinstance(candidate, str) and len(candidate) < 80 and all(c.isalnum() or c == "_" for c in candidate):
                code = candidate
        except (ValueError, AttributeError):
            pass
    log.warning("storage_%s_failed type=%s status=%s code=%s", operation, type(exc).__name__,
                getattr(response, "status_code", None), code)
IS_CLOUD = os.environ.get("VERCEL") == "1"
cloud_store = BlobSessions() if IS_CLOUD and os.environ.get("BLOB_READ_WRITE_TOKEN") else None
db = None
if not IS_CLOUD:
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
    host = request.headers.get("host", "").split(":")[0]
    allowed = {"127.0.0.1", "localhost", "testserver"}
    if IS_CLOUD:
        allowed.update(filter(None, [os.environ.get(k) for k in ("VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_BRANCH_URL")]))
        allowed.update(filter(None, os.environ.get("ERU_ALLOWED_HOSTS", "").split(",")))
    if host not in allowed:
        return JSONResponse({"detail": "허용된 서비스 주소에서 접속하세요."}, status_code=403)
    origin = request.headers.get("origin")
    origins = {"http://127.0.0.1:8000", "http://localhost:8000", "http://127.0.0.1:5173", "http://localhost:5173"}
    if IS_CLOUD:
        origins.add("https://" + host)
    if origin and origin not in origins:
        return JSONResponse({"detail": "동일 웹사이트에서 접속하세요."}, status_code=403)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Allocation(Strict):
    weights: dict[str, float]


class StartPlan(Allocation):
    risk_rules: list[dict] | None = None

    @field_validator("risk_rules")
    @classmethod
    def validated_rules(cls, value):
        return validate_rules(value) if value is not None else None


class Trade(Strict):
    asset: Literal["A", "B", "C", "D"]
    side: Literal["buy", "sell"]
    amount: float | None = Field(None, gt=0, le=1e16)
    percent: float | None = Field(None, gt=0, le=100)
    quantity: str | None = Field(None, max_length=100)


class Decision(Strict):
    alert_id: str = Field(max_length=120)
    action: Literal["accept", "modify", "ignore"]
    percent: float | None = Field(None, gt=0, le=100)


class SetupContext(Strict):
    mode: Literal["conversation"] | None = None
    allocation: dict[str, float] | None = None
    profile: Literal["cautious", "balanced", "active"] | None = None
    step: int = Field(ge=0, le=4)
    cash: float = Field(ge=0, le=100)
    selected: list[Literal["A", "B", "C", "D"]] = Field(max_length=4)
    shares: dict[Literal["A", "B", "C", "D"], Annotated[float, Field(ge=0, le=100)]]
    risk_rules: list[dict] | None = None

    @field_validator("allocation")
    @classmethod
    def validated_allocation(cls, value):
        return {a:float(v) for a,v in weights(value).items()} if value is not None else None

    @field_validator("risk_rules")
    @classmethod
    def validated_rules(cls, value):
        return validate_rules(value) if value is not None else None


class Chat(Strict):
    request_id: uuid.UUID
    question: str = Field(min_length=1, max_length=600)
    asset: Literal["A", "B", "C", "D"] = "A"
    draft: dict[str, float]
    setup: SetupContext | None = None


class ApprovedOrder(Strict):
    kind: Literal["hold", "trade", "rebalance"]
    alert_id: str | None = Field(None, max_length=120)
    asset: Literal["A", "B", "C", "D"] | None = None
    side: Literal["buy", "sell"] | None = None
    amount: float | None = Field(None, gt=0, le=1e16)
    percent: float | None = Field(None, gt=0, le=100)
    weights: dict[str, float] | None = None


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


def update(sid, action, alias="A", read_only=False):
    if IS_CLOUD:
        return update_cloud(sid, action, alias, read_only)
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


def update_cloud(sid, action, alias="A", read_only=False):
    if not data_ready or cloud_store is None:
        raise HTTPException(503, "배포 데이터 또는 비공개 저장소를 준비 중입니다.")
    for attempt in range(4):
        try:
            result = cloud_store.read(sid)
        except ValueError:
            result = None
        except Exception as exc:
            storage_failure("read", exc)
            raise HTTPException(503, "게임 저장소에 연결할 수 없습니다. 잠시 후 다시 시도하세요.") from None
        if result is None:
            raise HTTPException(404, "게임을 찾을 수 없습니다. 새 게임을 시작하세요.")
        envelope, etag = result
        state = envelope["state"]
        original = copy.deepcopy(state)
        wall = time.time()
        delta = max(0, wall - envelope["last_seen"])
        # A suspended/background browser does not silently skip a long market period.
        if state["status"] == "running" and delta > 15:
            state["status"] = "paused"
        else:
            engine.advance(state, delta)
        before = copy.deepcopy(state)
        error = None
        try:
            action(state)
        except ValueError as exc:
            state, error = before, str(exc)
        try:
            # Reconstruct ordinary frames without writing on every poll. Persist
            # decisions, stop/end boundaries, and a five-second liveness checkpoint.
            must_save = not read_only or state["status"] != original["status"] or delta >= 5
            if state != original and must_save:
                cloud_store.write(sid, state, wall, etag)
        except StorageConflict:
            continue
        except Exception as exc:
            storage_failure("write", exc)
            # A failed time-only checkpoint can be reconstructed from the last
            # durable anchor. Retry reads, never replay a mutating user action.
            checkpoint_only = (read_only and state["status"] == original["status"] == "running"
                               and state["pending"] == original["pending"]
                               and state["trades"] == original["trades"])
            if checkpoint_only and attempt < 2:
                continue
            raise HTTPException(503, "게임 상태를 저장하지 못했습니다. 잠시 후 다시 시도하세요.") from None
        if error:
            raise HTTPException(400, error)
        return {"id": sid, **engine.public(state, alias)}
    raise HTTPException(409, "다른 요청을 처리 중입니다. 잠시 후 다시 시도하세요.")


@app.get("/api/health")
def health():
    ready = data_ready and (not IS_CLOUD or cloud_store is not None)
    return {"status": "ready" if ready else "data_required", "version": "AI 동행 투자 V3",
            "storage": "private_blob" if IS_CLOUD else "sqlite"}


@app.get("/api/catalog")
def catalog():
    return {"as_of": START.isoformat(), "assets": [a for a in CATALOG if a["alias"] in "ABCD"], "initial": 100000000,
            "duration": 300, "start": "2022-11-07", "end": "2026-08-05",
            "research": []}


@app.post("/api/sessions")
def create():
    return create_session(False)


@app.post("/api/paper-sessions")
def create_paper():
    return create_session(True)


@app.post("/api/guided-sessions")
def create_guided():
    return create_session(False, guided=True)


def create_session(paper, guided=False):
    if not data_ready:
        raise HTTPException(503, "시세 데이터 수집 및 검증이 필요합니다.")
    with lock:
        sid, state = str(uuid.uuid4()), fresh(paper=paper, guided=guided)
        if IS_CLOUD:
            if cloud_store is None:
                raise HTTPException(503, "게임 저장소를 준비 중입니다.")
            try:
                cloud_store.write(sid, state, time.time())
            except Exception:
                raise HTTPException(503, "게임을 저장하지 못했습니다. 잠시 후 다시 시도하세요.") from None
        else:
            save(sid, state)
            anchors[sid] = time.monotonic()
        return {"id": sid, **engine.public(state)}


@app.get("/api/sessions/{sid}")
def state(sid: str, asset: str = "A"):
    if asset not in "ABCD" or len(asset) != 1:
        raise HTTPException(400, "지원하지 않는 상품입니다.")
    return update(sid, lambda s: None, asset, read_only=True)


@app.post("/api/sessions/{sid}/start")
def start(sid: str, body: StartPlan):
    return update(sid, lambda s: engine.start(s, body.weights, body.risk_rules))


@app.post("/api/sessions/{sid}/play")
def play(sid: str):
    return update(sid, lambda s: engine.play(s))


@app.post("/api/sessions/{sid}/pause")
def pause(sid: str):
    def action(s):
        if s["status"] == "paused":
            return  # An automatic alert may pause between the UI click and this request.
        if s["status"] != "running":
            raise ValueError("재생 중인 게임만 일시정지할 수 있습니다.")
        s["status"] = "paused"
    return update(sid, action)


@app.post("/api/sessions/{sid}/resume")
def resume(sid: str):
    def action(s):
        if s["status"] != "paused":
            raise ValueError("일시정지한 게임만 재개할 수 있습니다.")
        if s.get("mode") == "guided" and any(a["decision"] is None for a in s["alerts"]):
            raise ValueError("가드의 근거를 확인하고 유지 또는 매매를 선택하세요.")
        for a in s["alerts"]:
            if a["decision"] is None:
                a["decision"] = "ignore"
                s["choices"].append({"alert_id": a["id"], "at": s["now"], "action": "ignore", "percent": None})
        s["status"] = "running"
    return update(sid, action)


@app.post("/api/sessions/{sid}/orders")
def trade(sid: str, body: Trade):
    return update(sid, lambda s: engine.order(s, body.asset, body.side, body.amount, body.percent, body.quantity))


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
        if s["status"] != "paused" or not s["pending"] or (s["pending"]["kind"] == "initial" and s.get("mode") != "guided"):
            raise ValueError("취소할 수 있는 대기 주문이 없습니다.")
        s["pending"] = None
        if s.get("mode") == "guided":
            s["choices"].append({"at": s["now"], "action": "cancel", "summary": "미체결 주문을 취소했습니다."})
    return update(sid, action)


@app.post("/api/sessions/{sid}/decision")
def decision(sid: str, body: Decision):
    return update(sid, lambda s: engine.decide(s, body.alert_id, body.action, body.percent))


@app.post("/api/sessions/{sid}/approved-order")
def approved_order(sid: str, body: ApprovedOrder):
    def action(s):
        if s.get("mode") != "guided":
            raise ValueError("AI 동행 투자에서 사용할 수 있습니다.")
        engine.editable(s)
        unresolved = next((a for a in reversed(s["alerts"]) if a["decision"] is None), None)
        alert = next((a for a in s["alerts"] if a["id"] == body.alert_id), None) if body.alert_id else None
        if body.alert_id and (not alert or alert["decision"] is not None):
            raise ValueError("이미 처리했거나 유효하지 않은 가드입니다.")
        if unresolved and alert is not unresolved:
            raise ValueError("현재 가드에 대한 대응을 확인하세요.")
        summary = "매매 없이 현재 구성을 유지했습니다."
        if body.kind == "trade":
            engine.order(s, body.asset, body.side, amount=body.amount, percent=body.percent)
            summary = f"코인 {body.asset} {'매수' if body.side == 'buy' else '매도'} 주문을 승인했습니다."
        elif body.kind == "rebalance":
            engine.rebalance(s, body.weights or {})
            summary = "변경한 비중으로 매도 후 매수하는 주문을 승인했습니다."
        if alert:
            alert["decision"] = "hold" if body.kind == "hold" else "approved"
        s["choices"].append({"at": s["now"], "action": body.kind, "alert_id": body.alert_id,
                             "summary": summary})
        s["status"] = "running"
    return update(sid, action)


@app.post("/api/sessions/{sid}/chat")
def chat(sid: str, body: Chat):
    request_id = str(body.request_id)
    def begin(s):
        if s.get("mode") != "guided" or s["status"] == "finished":
            raise ValueError("진행 중인 AI 동행 투자에서 질문하세요.")
        if any(c["id"] == request_id for c in s["chat"]):
            return
        if s.get("chat_request") == request_id:
            raise ValueError("이 질문을 처리 중입니다. 같은 질문을 중복 접수하지 않습니다.")
        weights(body.draft)
        wall = time.time()
        if s["chat_count"] >= 40:
            raise ValueError("이 게임의 대화 40회를 모두 사용했습니다. 구성 수정과 매매는 계속할 수 있습니다.")
        if wall - s["chat_wall"] < 2:
            raise ValueError("이전 질문을 처리 중입니다. 잠시 후 질문하세요.")
        if s["status"] == "running":
            s["status"] = "paused"
        s["chat_count"] += 1
        s["chat_wall"] = wall
        s["chat_request"] = request_id
    snapshot = update(sid, begin, body.asset)
    if any(c["id"] == request_id for c in snapshot["chat"]):
        return snapshot
    setup = body.setup.model_dump() if body.setup and snapshot["status"] == "ready" else None
    reply = discuss(snapshot, body.question.strip(), body.asset, body.draft, setup)
    def finish(s):
        if s.get("chat_request") != request_id or s["now"] != snapshot["now"] or s["status"] != snapshot["status"]:
            raise ValueError("논의 중 투자 상태가 바뀌었습니다. 현재 상태에서 다시 질문하세요.")
        if not any(c["id"] == request_id for c in s["chat"]):
            s["chat"].append({"id": request_id, "at": s["now"], **reply})
    return update(sid, finish, body.asset)


dist = ROOT / "frontend/dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
