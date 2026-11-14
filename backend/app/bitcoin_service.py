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
from .result_mail import ResultMailer

COOKIE="eru_btc_visitor"
MODE="bitcoin_v1"
ID=re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")


class Strict(BaseModel):
    model_config=ConfigDict(extra="forbid",allow_inf_nan=False)


class Start(Strict):
    amount: Decimal=Field(ge=10000,le=10000000000,max_digits=13,decimal_places=2)


class Playback(Strict):
    action: Literal["pause","resume","speed","next","finish"]
    speed: Literal[1,4,8]|None=None


class SendReport(Strict):
    email: str=Field(min_length=3,max_length=254,pattern=r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")
    consent: Literal[True]
    website: str=Field(default="",max_length=0)

    @field_validator("email",mode="before")
    @classmethod
    def normalize(cls,value):
        return value.strip().lower() if isinstance(value,str) else value


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

    def create(self,request,amount):
        if self.engine is None:
            raise HTTPException(503,"검증된 비트코인 데이터를 준비하고 있어요.")
        token,owner=self.token(request,True)
        with self.lock:
            self.quota("create",owner,3600,20)
            now=self.clock();sid=str(uuid.uuid4())
            state={"id":sid,"mode":MODE,"model_version":MODEL_VERSION,"market_sha":self.engine.fingerprint,"visitor_hash":owner,"amount":str(amount),"created_at":now,
                "anchor":now,"elapsed":0.0,"speed":4,"status":"running","email_receipts":{}}
            self.write(sid,state,None)
        return token,self.engine.public(state)

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

    def change(self,request,sid,action=None,view=None,raw=False):
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
                    return state if raw else self.engine.public(state,view)
                except StorageConflict:
                    continue
        raise HTTPException(409,"다른 요청을 처리 중이에요. 잠시 후 다시 시도해 주세요.")

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
                s["elapsed"]=cycle*100+next_event["at_idx"]/count*100 if next_event else (cycle+1)*100
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
        lease=secrets.token_hex(16)
        def claim(s):
            if s["status"]!="finished":
                raise HTTPException(400,"비교를 마친 후 결과 메일을 받을 수 있어요.")
            if digest in s.get("email_receipts",{}):
                return
            if len(s.get("email_receipts",{}))>=2:
                raise HTTPException(429,"이 비교 결과의 발송 횟수를 모두 사용했어요.")
            pending=s.get("email_pending")
            if pending and self.clock()-pending["at"]<60:
                raise HTTPException(409,"이 결과의 메일을 발송하고 있어요. 잠시 후 확인해 주세요.")
            s["email_pending"]={"digest":digest,"at":self.clock(),"lease":lease}
        state=self.change(request,sid,claim,raw=True)
        if digest in state.get("email_receipts",{}):
            return {"status":"accepted","already_sent":True}
        try:
            with self.lock:
                self.quota("email-recipient",digest,86400,3)
                self.quota("email-visitor",state["visitor_hash"],3600,4)
                self.quota("email-global","all",86400,100)
            message_id=self.mailer.send(body.email,self.engine.public(state))
        except HTTPException:
            def release(s):
                if s.get("email_pending",{}).get("lease")==lease:s.pop("email_pending",None)
            self.change(request,sid,release)
            raise
        def finish(s):
            s.setdefault("email_receipts",{})[digest]={"at":self.clock(),"id":message_id}
            if s.get("email_pending",{}).get("lease")==lease:s.pop("email_pending",None)
        self.change(request,sid,finish)
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

    @router.post("/sessions")
    def start(body:Start,request:Request):
        token,result=service.create(request,body.amount)
        response=JSONResponse(result)
        response.set_cookie(COOKIE,token,max_age=86400*30,httponly=True,
            secure=os.environ.get("VERCEL")=="1" or request.url.scheme=="https",samesite="lax",path="/")
        return response

    @router.get("/sessions/{sid}")
    def snapshot(sid:str,request:Request,view:int|None=None):
        return service.change(request,sid,view=view)

    @router.post("/sessions/{sid}/playback")
    def playback(sid:str,body:Playback,request:Request):
        return service.playback(request,sid,body)

    @router.post("/sessions/{sid}/email")
    def email(sid:str,body:SendReport,request:Request):
        return service.email(request,sid,body)

    @router.get("/records")
    def records(request:Request):
        return service.list(request)

    return router,service
