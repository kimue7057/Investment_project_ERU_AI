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
from .supabase_store import SupabaseSessions
from .mentor import discuss
from .risk_policy import validate_rules, retire_custom_rules
from .investment_review import build_review, create_recap
from .account_auth import (AccountAuth, account, authorize_game, current_account,
                           set_auth_cookies, clear_auth_cookies)

app = FastAPI(title="ERU AI Alpha V1", docs_url=None, redoc_url=None, openapi_url=None)
lock = threading.RLock()
anchors = {}
log = logging.getLogger("eru.cloud")
storage_health = {"store": None, "checked": 0.0, "available": None}
auth_service = AccountAuth()


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
    storage_health.update(store=cloud_store, checked=time.monotonic(), available=False)


def storage_message(exc):
    if getattr(getattr(exc, "response", None), "status_code", None) == 403:
        return "온라인 게임 저장소 접근이 차단되어 게임을 열 수 없습니다. 운영자의 저장소 상태 확인이 필요합니다."
    return "게임 저장소에 연결할 수 없습니다. 잠시 후 다시 시도하세요."
IS_CLOUD = os.environ.get("VERCEL") == "1"


def configure_cloud_store():
    if not IS_CLOUD:
        return None
    # Supabase 설정 중 일부만 있어도 다른 저장소로 조용히 전환하지 않는다.
    if os.environ.get("ERU_STORAGE_BACKEND") == "supabase" or any(
            os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY")):
        if not all(os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY")):
            return None
        try:
            return SupabaseSessions()
        except ValueError:
            log.warning("storage_configuration_invalid provider=supabase")
            return None
    return BlobSessions() if os.environ.get("BLOB_READ_WRITE_TOKEN") else None


cloud_store = configure_cloud_store()
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
    identity, refreshed = None, None
    path = request.url.path
    protected = path in ("/api/sessions", "/api/paper-sessions", "/api/guided-sessions") or path.startswith(("/api/sessions/", "/api/account/"))
    if protected or path in ("/api/auth/session", "/api/auth/logout"):
        try:
            identity, refreshed = auth_service.authenticate(request)
            if protected and identity is None:
                raise HTTPException(401, "이메일 인증 후 이용해 주세요.")
        except HTTPException as exc:
            if exc.status_code == 401 and path in ("/api/auth/session", "/api/auth/logout"):
                refreshed = None
            else:
                response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
                response.headers["Cache-Control"] = "no-store"
                return response
    context = current_account.set(identity)
    request.state.refreshed_tokens = refreshed
    try:
        response = await call_next(request)
    finally:
        current_account.reset(context)
    secure = IS_CLOUD or request.url.scheme == "https"
    if path != "/api/auth/logout":
        set_auth_cookies(response, refreshed, secure)
    if path == "/api/auth/session" and identity is None:
        clear_auth_cookies(response, secure)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class EmailLogin(Strict):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class EmailCode(EmailLogin):
    code: str = Field(pattern=r"^[0-9]{6,10}$")


class NewGame(Strict):
    previous_id: uuid.UUID | None = None


class SignOut(Strict):
    session_id: uuid.UUID | None = None


class PortfolioDraft(Strict):
    version: Literal[2]
    phase: Literal["portfolio", "assets"]
    profile: Literal["cautious", "balanced", "active", "custom"] | None
    cash: str = Field(max_length=12, pattern=r"^[0-9.eE+-]*$")
    coins: list[Literal["A", "B", "C", "D"]] = Field(max_length=4)
    shares: dict[Literal["A", "B", "C", "D"], Annotated[str, Field(max_length=12, pattern=r"^[0-9.eE+-]*$")]]

    @field_validator("coins")
    @classmethod
    def unique_coins(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("종목을 중복 선택할 수 없습니다.")
        return value

    @field_validator("shares")
    @classmethod
    def complete_shares(cls, value):
        if set(value) != set("ABCD"):
            raise ValueError("네 코인의 입력을 모두 포함하세요.")
        return value


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
    phase: Literal["portfolio", "assets", "rules"] | None = None
    proposal_choices: dict[str, Literal["accepted", "declined", "superseded"]] = Field(default_factory=dict, max_length=40)
    allocation: dict[str, float] | None = None
    profile: Literal["cautious", "balanced", "active", "custom"] | None = None
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
    authorize_game(state)
    retire_custom_rules(state)
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
            raise HTTPException(503, storage_message(exc)) from None
        if result is None:
            raise HTTPException(404, "게임을 찾을 수 없습니다. 새 게임을 시작하세요.")
        envelope, etag = result
        state = envelope["state"]
        authorize_game(state)
        original = copy.deepcopy(state)
        migrated_guard = retire_custom_rules(state)
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
            must_save = migrated_guard or not read_only or state["status"] != original["status"] or delta >= 5
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
    storage_name = getattr(cloud_store, "storage_name", "private_blob") if IS_CLOUD else "sqlite"
    if ready and IS_CLOUD:
        if storage_health["store"] is not cloud_store or time.monotonic()-storage_health["checked"] >= 60:
            try:
                cloud_store.probe()
                storage_health.update(store=cloud_store, checked=time.monotonic(), available=True)
            except Exception as exc:
                storage_failure("probe", exc)
        if not storage_health["available"]:
            return JSONResponse({"status":"storage_unavailable", "version":"AI 동행 투자 V3", "storage":storage_name}, status_code=503)
    if IS_CLOUD and cloud_store is None:
        return JSONResponse({"status":"storage_required", "version":"AI 동행 투자 V3"}, status_code=503)
    return {"status": "ready" if ready else "data_required", "version": "AI 동행 투자 V3",
            "storage": storage_name}


@app.get("/api/catalog")
def catalog():
    return {"as_of": START.isoformat(), "assets": [a for a in CATALOG if a["alias"] in "ABCD"], "initial": 100000000,
            "duration": 300, "start": "2022-11-07", "end": "2026-08-05",
            "research": []}


@app.get("/api/auth/session")
def auth_session():
    user = current_account.get()
    return {"configured": auth_service.configured, "user": {"id": user.id, "email": user.email} if user else None}


@app.post("/api/auth/send-code")
def send_code(body: EmailLogin):
    auth_service.send(body.email)
    return {"sent": True, "retry_after": 60}


@app.post("/api/auth/verify")
def verify_code(body: EmailCode, request: Request):
    user, tokens = auth_service.verify(body.email, body.code)
    response = JSONResponse({"user": {"id": user.id, "email": user.email}})
    set_auth_cookies(response, tokens, IS_CLOUD or request.url.scheme == "https")
    return response


@app.post("/api/auth/logout")
def sign_out(request: Request, body: SignOut | None = None):
    if body and body.session_id and current_account.get():
        def stop(s):
            if s["status"] == "running":
                s["status"] = "paused"
        update(str(body.session_id), stop)
    auth_service.logout(request, request.state.refreshed_tokens)
    response = JSONResponse({"signed_out": True})
    clear_auth_cookies(response, IS_CLOUD or request.url.scheme == "https")
    return response


@app.get("/api/account/games")
def account_games(offset: int = 0):
    if not data_ready:
        raise HTTPException(503, "검증된 시세 데이터를 준비 중입니다.")
    if not 0 <= offset <= 100000:
        raise HTTPException(400, "올바른 목록 위치를 입력해 주세요.")
    owner = account().id
    if IS_CLOUD:
        if not isinstance(cloud_store, SupabaseSessions):
            raise HTTPException(503, "계정 기록 저장소 연결을 확인해 주세요.")
        try:
            rows = cloud_store.list_owned(owner, offset)
        except Exception as exc:
            storage_failure("account_list", exc)
            raise HTTPException(503, "내 투자 기록을 불러오지 못했습니다.") from None
    else:
        with lock:
            rows = [{"id": r[0], "state": json.loads(r[1]), "last_seen": 0} for r in db.execute(
                "SELECT id,state FROM sessions WHERE json_extract(state,'$.owner_id')=? "
                "AND json_extract(state,'$.mode')='guided' ORDER BY json_extract(state,'$.created_at') DESC,id DESC LIMIT 21 OFFSET ?",
                (owner, offset)).fetchall()]
    summaries = []
    for row in rows[:20]:
        s = row["state"]
        if s.get("owner_id") != owner:
            continue  # 공급자 필터 외에 서버에서도 소유자를 다시 확인한다.
        nav = engine.nav(s)
        summaries.append({"id": row["id"], "status": s["status"], "created_at": s.get("created_at"),
                          "now": s["now"], "elapsed": s["elapsed"], "nav": float(nav),
                          "return_pct": float((nav/100000000-1)*100), "trade_count": len(s["trades"]),
                          "initial_plan": copy.deepcopy(s.get("initial_plan"))})
    return {"games": summaries, "next_offset": offset+20 if len(rows) > 20 else None}


@app.post("/api/sessions")
def create():
    return create_session(False)


@app.post("/api/paper-sessions")
def create_paper():
    return create_session(True)


@app.post("/api/guided-sessions")
def create_guided(body: NewGame | None = None):
    if body and body.previous_id:
        def pause_previous(s):
            if s["status"] == "running":
                s["status"] = "paused"
        update(str(body.previous_id), pause_previous)
    return create_session(False, guided=True)


def create_session(paper, guided=False):
    user = account()
    if not data_ready:
        raise HTTPException(503, "시세 데이터 수집 및 검증이 필요합니다.")
    with lock:
        sid, state = str(uuid.uuid4()), fresh(paper=paper, guided=guided)
        state.update(owner_id=user.id, created_at=time.time())
        if IS_CLOUD:
            if cloud_store is None:
                raise HTTPException(503, "게임 저장소를 준비 중입니다.")
            try:
                cloud_store.write(sid, state, time.time())
            except Exception as exc:
                storage_failure("create", exc)
                raise HTTPException(503, storage_message(exc)) from None
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
    if body.risk_rules is not None:
        raise HTTPException(400, "사용자 조건 설정은 중단했습니다. 화면을 새로고침하고 기본 리스크 가드로 시작하세요.")
    return update(sid, lambda s: engine.start(s, body.weights))


@app.post("/api/sessions/{sid}/setup-draft")
def save_setup_draft(sid: str, body: PortfolioDraft):
    def action(s):
        if s.get("mode") != "guided" or s["status"] != "ready":
            raise ValueError("투자 시작 전 작성 중인 계획만 저장할 수 있습니다.")
        s["setup_draft"] = body.model_dump()
    return update(sid, action)


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


@app.post("/api/sessions/{sid}/leave")
def leave_game(sid: str):
    def action(s):
        if s["status"] == "running":
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
        cancelled_id = s["pending"].get("decision_id")
        for choice in s["choices"]:
            if choice.get("id") == cancelled_id and cancelled_id is not None:
                choice["cancelled"] = True
        s["pending"] = None
        if s.get("mode") == "guided":
            engine.choice(s, "cancel", summary="미체결 주문을 취소했습니다.")
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
        engine.choice(s, body.kind, alert_id=body.alert_id, summary=summary)
        s["status"] = "running"
    return update(sid, action)


@app.post("/api/sessions/{sid}/chat")
def chat(sid: str, body: Chat):
    if body.setup and (body.setup.phase == "rules" or body.setup.risk_rules is not None):
        raise HTTPException(400, "조건 상담 단계는 중단했습니다. 화면을 새로고침하고 투자 계획을 확인하세요.")
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
    reply = discuss({**snapshot, "guard_policy": "builtin"}, body.question.strip(), body.asset, body.draft, setup)
    def finish(s):
        if s.get("chat_request") != request_id or s["now"] != snapshot["now"] or s["status"] != snapshot["status"]:
            raise ValueError("논의 중 투자 상태가 바뀌었습니다. 현재 상태에서 다시 질문하세요.")
        if not any(c["id"] == request_id for c in s["chat"]):
            metadata = ({"phase": setup["phase"], "setup_basis": {k: setup[k] for k in ("profile", "cash", "allocation")}}
                        if setup and setup.get("phase") else {})
            s["chat"].append({"id": request_id, "at": s["now"], **reply, **metadata})
    return update(sid, finish, body.asset)


def finished_snapshot(sid, action=None):
    snapshot = {}
    def capture(s):
        if s.get("mode") != "guided" or s["status"] != "finished":
            raise ValueError("투자 종료 후에 복기를 확인할 수 있습니다.")
        if action:
            action(s)
        snapshot.clear()
        snapshot.update(copy.deepcopy(s))
    update(sid, capture, read_only=action is None)
    return snapshot


@app.get("/api/sessions/{sid}/review")
def review(sid: str):
    return build_review(finished_snapshot(sid), market)


@app.post("/api/sessions/{sid}/review/recap")
def review_recap(sid: str):
    request_id = str(uuid.uuid4())
    def begin(s):
        if s.get("review_recap", {}).get("source") == "ai":
            return
        if time.time() < s.get("review_recap_pending_until", 0):
            raise ValueError("복기를 정리 중입니다. 잠시 후 다시 확인하세요.")
        if s.get("review_recap_count", 0) >= 3:
            raise ValueError("이 게임의 복기 요청 3회를 모두 사용했습니다. 저장된 기록은 계속 확인할 수 있습니다.")
        s["review_recap_count"] = s.get("review_recap_count", 0) + 1
        s["review_recap_request"] = request_id
        s["review_recap_pending_until"] = time.time() + 30
    snapshot = finished_snapshot(sid, begin)
    if snapshot.get("review_recap", {}).get("source") == "ai":
        return snapshot["review_recap"]
    reply = create_recap(build_review(snapshot, market))
    def finish(s):
        if s.get("review_recap_request") == request_id:
            s["review_recap"] = reply
            s["review_recap_pending_until"] = 0
    final = finished_snapshot(sid, finish)
    return final.get("review_recap", reply)


dist = ROOT / "frontend/dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
