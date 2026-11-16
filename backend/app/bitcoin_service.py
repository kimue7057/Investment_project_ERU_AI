"""인증 없이 이용하는 BTC 비교. HttpOnly 방문자 쿠키로 각 기록을 분리한다."""
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .bitcoin_engine import BitcoinEngine, CYCLES, MODEL_VERSION
from .blob_store import StorageConflict
from .result_mail import ResultMailer, REPORT_VERSION

COOKIE="eru_btc_visitor"
MODE="bitcoin_v1"
ID=re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")


class Strict(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)


class Playback(Strict):
    action: Literal["pause","resume","speed","next","finish"]
    speed: Literal[1,4,8]|None=None


class SendReport(Strict):
    email: str=Field(min_length=3,max_length=254,pattern=r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")
    consent: Literal[True]
    website: str=Field(default="",max_length=0)
    locale: Literal["en","ko"]="ko"

    @field_validator("email",mode="before")
    @classmethod
    def normalize(cls,value):
        return value.strip().lower() if isinstance(value,str) else value


class Start(SendReport):
    amount: Decimal=Field(ge=10000,le=10000000000,max_digits=13,decimal_places=2)


class SavedContactStart(Strict):
    amount: Decimal=Field(ge=10000,le=10000000000,max_digits=13,decimal_places=2)
    locale: Literal["en","ko"]="ko"


class RetryDelivery(Strict):
    pass


class BitcoinService:
    def __init__(self,provider,lock,clock=time.time):
        self.provider,self.lock,self.clock=provider,lock,clock
        self.engine=None
        self.mailer=ResultMailer()
        try:
            self.engine=BitcoinEngine()
        except (OSError,ValueError,KeyError):
            pass

    def token(self,request,create=False):
        value=request.cookies.get(COOKIE,"")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}",value):
            if not create:
                raise HTTPException(404,"이 브라우저의 비교 기록을 찾을 수 없어요.")
            value=secrets.token_urlsafe(32)
        return value,hashlib.sha256(value.encode()).hexdigest()

    def read(self,sid):
        if not ID.fullmatch(sid):
            return None
        store,db=self.provider()
        try:
            if store is not None:
                result=store.read(sid)
                return (result[0]["state"],result[1]) if result else None
            if db is None:
                raise ValueError("No private storage")
            row=db.execute("SELECT state FROM sessions WHERE id=?",(sid,)).fetchone()
            return (json.loads(row[0]),None) if row else None
        except (ValueError,TypeError):
            raise HTTPException(503,"비교 기록 저장소를 준비하고 있어요.") from None
        except Exception:
            raise HTTPException(503,"비교 기록 저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.") from None

    def write(self,sid,state,revision):
        store,db=self.provider()
        try:
            if store is not None:
                store.write(sid,state,self.clock(),revision)
            elif db is not None:
                db.execute("INSERT INTO sessions(id,state) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
                           (sid,json.dumps(state,separators=(",",":"))))
                db.commit()
            else:
                raise ValueError("No private storage")
        except StorageConflict:
            raise
        except Exception:
            raise HTTPException(503,"비교 기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.") from None

    def quota(self,category,identity,seconds,limit):
        window=int(self.clock()//seconds)
        digest=hashlib.sha256((category+":"+identity+":"+str(window)).encode()).hexdigest()
        sid=str(uuid.uuid5(uuid.NAMESPACE_URL,"eru/bitcoin/quota/"+digest))
        for _ in range(5):
            result=self.read(sid)
            s,rev=result if result else ({"mode":"bitcoin_quota","count":0},None)
            if s.get("mode")!="bitcoin_quota" or s["count"]>=limit:
                raise HTTPException(429,"요청이 많아요. 잠시 후 다시 시도해 주세요.")
            s["count"]+=1
            try:
                self.write(sid,s,rev);return
            except StorageConflict:
                continue
        raise HTTPException(409,"다른 요청을 처리 중이에요. 잠시 후 다시 시도해 주세요.")

    def public(self,state,view=None):
        result=self.engine.public(state,view)
        delivery=state.get("report_delivery")
        if delivery:
            # 수신 주소·동의 기록·발송 임대·제공자 응답은 서버에만 보관한다.
            result["report_delivery"]={k:delivery[k] for k in
                ("status","recipient","locale","error_code") if k in delivery}
        return result

    def contact_id(self,owner):
        return str(uuid.uuid5(uuid.NAMESPACE_URL,"eru/bitcoin/contact/"+owner))

    def contact(self,owner):
        result=self.read(self.contact_id(owner))
        if not result:return None
        state,revision=result
        if state.get("mode")!="bitcoin_contact" or not hmac.compare_digest(state.get("visitor_hash",""),owner):
            raise HTTPException(503,"이메일 설정을 불러오지 못했어요.")
        return state,revision

    def contact_public(self,request):
        try:_,owner=self.token(request)
        except HTTPException:return {"registered":False}
        result=self.contact(owner)
        return {"registered":True,"recipient":result[0]["recipient"]} if result else {"registered":False}

    def save_contact(self,request,body):
        token,owner=self.token(request,True)
        with self.lock:
            self.quota("contact",owner,3600,20)
            for _ in range(5):
                result=self.contact(owner)
                revision=result[1] if result else None
                local,domain=body.email.split("@")
                state={"mode":"bitcoin_contact","visitor_hash":owner,"email":body.email,
                    "recipient":local[:1]+"***@"+domain,"consented_at":self.clock()}
                try:
                    self.write(self.contact_id(owner),state,revision)
                    return token,{"registered":True,"recipient":state["recipient"]}
                except StorageConflict:continue
        raise HTTPException(409,"이메일 설정을 저장 중이에요. 다시 시도해 주세요.")

    def create(self,request,body):
        if self.engine is None:
            raise HTTPException(503,"검증된 비트코인 데이터를 준비하고 있어요.")
        token,owner=self.token(request,True)
        with self.lock:
            if isinstance(body,SavedContactStart):
                registered=self.contact(owner)
                if not registered:
                    raise HTTPException(400,"먼저 결과를 받을 이메일을 설정해 주세요.")
                email=registered[0]["email"]
                consented_at=registered[0]["consented_at"]
            else:
                # 이전 배포 클라이언트의 명시적 수신 동의 요청도 유지한다.
                email=body.email
                consented_at=self.clock()
            self.quota("create",owner,3600,20)
            now=self.clock();sid=str(uuid.uuid4())
            local,domain=email.split("@")
            state={"id":sid,"mode":MODE,"model_version":MODEL_VERSION,"market_sha":self.engine.fingerprint,"visitor_hash":owner,"amount":str(body.amount),"created_at":now,
                "anchor":now,"elapsed":0.0,"speed":4,"status":"running","email_receipts":{},
                "report_delivery":{"email":email,"recipient":local[:1]+"***@"+domain,
                    "locale":body.locale,"consented_at":consented_at,"status":"scheduled",
                    "use_saved_contact":isinstance(body,SavedContactStart)}}
            self.write(sid,state,None)
        return token,self.public(state)

    def advance(self,s):
        now=self.clock()
        if s["status"]=="running":
            delta=max(0,now-s["anchor"])
            if delta>15:
                s["status"]="paused"
            else:
                s["elapsed"]=min(300,s["elapsed"]+delta*s["speed"])
                if s["elapsed"]>=300:
                    s["status"]="finished"
        s["anchor"]=now

    def change(self,request,sid,action=None,view=None,raw=False,auto_delivery=True):
        if self.engine is None:
            raise HTTPException(503,"검증된 비트코인 데이터를 준비하고 있어요.")
        _,owner=self.token(request)
        with self.lock:
            for _ in range(5):
                result=self.read(sid)
                if not result:
                    raise HTTPException(404,"이 브라우저의 비교 기록을 찾을 수 없어요.")
                saved,rev=result
                # 소유자 확인 전에 시계·저장·메일을 변경하지 않는다.
                if saved.get("mode")!=MODE or not hmac.compare_digest(saved.get("visitor_hash",""),owner):
                    raise HTTPException(404,"이 브라우저의 비교 기록을 찾을 수 없어요.")
                if saved.get("model_version")!=MODEL_VERSION or saved.get("market_sha")!=self.engine.fingerprint:
                    raise HTTPException(409,"이 기록은 이전 계산 버전이에요. 새 비교를 시작해 주세요.")
                state=copy.deepcopy(saved)
                self.advance(state)
                if action:
                    action(state)
                # 표시한 재생 위치가 다른 인스턴스나 장기 비활성 후 되감기지 않게
                # 진행 중인 경량 세션은 매 응답의 마지막 위치를 영속화한다.
                persist=bool(action) or state["status"]!=saved["status"] or state["elapsed"]!=saved["elapsed"]
                try:
                    if persist:
                        self.write(sid,state,rev)
                    break
                except StorageConflict:
                    continue
            else:
                raise HTTPException(409,"다른 요청을 처리 중이에요. 잠시 후 다시 시도해 주세요.")
        # 완료 결과를 먼저 저장하고, 잠금을 해제한 뒤 메일을 만든다.
        if auto_delivery and state["status"]=="finished":
            state=self.deliver(request,sid,state)
        return state if raw else self.public(state,view)

    def deliver(self,request,sid,state):
        delivery=state.get("report_delivery",{})
        if delivery.get("status") not in ("scheduled","sending"):
            return state
        lease=secrets.token_hex(16)
        def claim(s):
            d=s.get("report_delivery",{})
            if d.get("status")=="scheduled" or (d.get("status")=="sending" and self.clock()-d.get("started_at",0)>=60):
                # 첫 발송/명시적 재시도는 설정에서 마지막으로 저장한 주소를 쓴다.
                # 진행 중인 발송의 복구는 기존 주소·멱등 키를 그대로 유지한다.
                if d.get("status")=="scheduled" and d.get("use_saved_contact",True):
                    contact=self.contact(s["visitor_hash"])
                    if contact:
                        d.update({k:contact[0][k] for k in ("email","recipient","consented_at")})
                d.update(status="sending",lease=lease,started_at=self.clock())
        state=self.change(request,sid,claim,raw=True,auto_delivery=False)
        d=state.get("report_delivery",{})
        if d.get("lease")!=lease:
            return state
        error=None
        try:
            self.email(request,sid,SendReport(email=d["email"],consent=True,locale=d["locale"]))
        except Exception as exc:
            # 결과 조회는 발송 장애와 분리하며 제공자 원문을 노출하지 않는다.
            error="rate_limited" if isinstance(exc,HTTPException) and exc.status_code==429 else "unavailable"
        def finish(s):
            current=s["report_delivery"]
            if current.get("lease")!=lease:return
            current.pop("lease",None)
            if error:
                current.update(status="failed",error_code=error)
            else:
                current.update(status="accepted",accepted_at=self.clock())
                current.pop("email",None)
                current.pop("error_code",None)
        return self.change(request,sid,finish,raw=True,auto_delivery=False)

    def retry_delivery(self,request,sid):
        def retry(s):
            if s["status"]!="finished" or not s.get("report_delivery"):
                raise HTTPException(400,"시작할 때 이메일을 등록한 완료 기록만 다시 발송할 수 있어요.")
            d=s["report_delivery"]
            if d["status"]=="failed":
                d["status"]="scheduled"
                d.pop("error_code",None)
        return self.change(request,sid,retry)

    def playback(self,request,sid,body):
        def apply(s):
            if s["status"]=="finished":return
            if body.action=="finish":s.update(elapsed=300.0,status="finished")
            elif body.action=="pause":s["status"]="paused"
            elif body.action=="resume":s["status"]="running"
            elif body.action=="speed":
                if body.speed is None:raise HTTPException(400,"재생 속도를 선택해 주세요.")
                s["speed"]=body.speed
            elif body.action=="next":
                cycle=min(2,int(s["elapsed"]//100));progress=s["elapsed"]-cycle*100
                run=self.engine.runs[cycle];count=len(run["history"])-1
                next_event=next((e for e in run["highlights"] if e["at_idx"]/count*100>progress+.05),None)
                # 이진 부동소수점의 경계 바로 아래로 내림되어 선택한 장면이
                # 보이지 않는 일을 막는다. 한 일봉보다 훨씬 작은 여유만 둔다.
                s["elapsed"]=min((cycle+1)*100,cycle*100+(next_event["at_idx"]+1e-6)/count*100) if next_event else (cycle+1)*100
                s["status"]="finished" if s["elapsed"]>=300 else "paused"
        return self.change(request,sid,apply)

    def list(self,request):
        try:_,owner=self.token(request)
        except HTTPException:return {"records":[]}
        store,db=self.provider()
        try:
            if store is not None:
                response=store.rest.request("GET","eru_game_sessions",params={"environment":"eq."+store.environment,
                    "state->>mode":"eq."+MODE,"state->>visitor_hash":"eq."+owner,
                    "select":"id,state","order":"last_seen.desc,id.desc","limit":"12"})
                response.raise_for_status();states=[r["state"] for r in response.json()]
            else:
                states=[json.loads(r[0]) for r in db.execute("SELECT state FROM sessions WHERE json_extract(state,'$.mode')=? AND json_extract(state,'$.visitor_hash')=? ORDER BY json_extract(state,'$.created_at') DESC LIMIT 12",(MODE,owner))]
        except Exception:
            raise HTTPException(503,"비교 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.") from None
        return {"records":[{k:s[k] for k in ("id","amount","elapsed","status","created_at")}
            for s in states if s.get("mode")==MODE and hmac.compare_digest(s.get("visitor_hash",""),owner)]}

    def email(self,request,sid,body):
        if not self.mailer.configured:
            raise HTTPException(503,"결과 메일 발송을 준비하고 있어요. 화면의 결과와 복기는 계속 확인할 수 있어요.")
        digest=hashlib.sha256(body.email.encode()).hexdigest()
        receipt_key=REPORT_VERSION+":"+digest
        lease=secrets.token_hex(16)
        def claim(s):
            if s["status"]!="finished":
                raise HTTPException(400,"비교를 마친 후 결과 메일을 받을 수 있어요.")
            if receipt_key in s.get("email_receipts",{}):
                return
            if sum(key.startswith(REPORT_VERSION+":") for key in s.get("email_receipts",{}))>=2:
                raise HTTPException(429,"이 비교 결과의 발송 횟수를 모두 사용했어요.")
            pending=s.get("email_pending")
            if pending and self.clock()-pending["at"]<60:
                raise HTTPException(409,"이 결과의 메일을 발송하고 있어요. 잠시 후 확인해 주세요.")
            s["email_pending"]={"digest":digest,"at":self.clock(),"lease":lease}
        state=self.change(request,sid,claim,raw=True,auto_delivery=False)
        if receipt_key in state.get("email_receipts",{}):
            return {"status":"accepted","already_sent":True}
        try:
            with self.lock:
                self.quota("email-recipient",digest,86400,3)
                self.quota("email-visitor",state["visitor_hash"],3600,4)
                self.quota("email-global","all",86400,100)
            report=self.engine.public(state)
            report["locale"]=body.locale
            message_id=self.mailer.send(body.email,report)
        except HTTPException:
            def release(s):
                if s.get("email_pending",{}).get("lease")==lease:s.pop("email_pending",None)
            self.change(request,sid,release,auto_delivery=False)
            raise
        def finish(s):
            s.setdefault("email_receipts",{})[receipt_key]={"at":self.clock(),"id":message_id}
            if s.get("email_pending",{}).get("lease")==lease:s.pop("email_pending",None)
        self.change(request,sid,finish,auto_delivery=False)
        return {"status":"accepted","already_sent":False}


def make_router(provider,lock):
    service=BitcoinService(provider,lock)
    router=APIRouter(prefix="/api/bitcoin")

    @router.get("/config")
    def config():
        return {"ready":service.engine is not None,"email_ready":service.mailer.configured,"duration":300,
            "cycles":[{"id":cid,"name":name,"start":start,"end":end} for cid,name,start,end in CYCLES],
            "initial":"두 계좌 모두 BTC 100%로 동일 출발","fee_rate":.0005,
            "currency_note":"USD 가격 변동률을 원화 자본에 적용하며 환율 변동과 현금 이자는 미반영합니다."}

    def with_cookie(token,result,request):
        response=JSONResponse(result)
        response.set_cookie(COOKIE,token,max_age=86400*30,httponly=True,
            secure=os.environ.get("VERCEL")=="1" or request.url.scheme=="https",samesite="lax",path="/")
        return response

    @router.get("/contact")
    def contact(request:Request):
        return service.contact_public(request)

    @router.post("/contact")
    def save_contact(body:SendReport,request:Request):
        token,result=service.save_contact(request,body)
        return with_cookie(token,result,request)

    @router.post("/sessions")
    def start(body:Start|SavedContactStart,request:Request):
        token,result=service.create(request,body)
        return with_cookie(token,result,request)

    @router.get("/sessions/{sid}")
    def snapshot(sid:str,request:Request,view:int|None=None):
        return service.change(request,sid,view=view)

    @router.post("/sessions/{sid}/playback")
    def playback(sid:str,body:Playback,request:Request):
        return service.playback(request,sid,body)

    @router.post("/sessions/{sid}/email")
    def email(sid:str,body:SendReport,request:Request):
        return service.email(request,sid,body)

    @router.post("/sessions/{sid}/delivery/retry")
    def retry_delivery(sid:str,body:RetryDelivery,request:Request):
        return service.retry_delivery(request,sid)

    @router.get("/records")
    def records(request:Request):
        return service.list(request)

    return router,service
