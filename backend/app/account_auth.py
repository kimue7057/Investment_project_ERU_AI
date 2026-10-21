"""Supabase 이메일 인증. 토큰은 HttpOnly 쿠키에만 두고 사용자 확인은 서버에서 한다."""
import base64
import hashlib
import json
import os
import threading
import time
import uuid
from collections import OrderedDict
from contextvars import ContextVar
from dataclasses import dataclass

import httpx
from fastapi import HTTPException

from .supabase_store import SupabaseREST

ACCESS_COOKIE = "eru_access"
REFRESH_COOKIE = "eru_refresh"
current_account = ContextVar("eru_account", default=None)


@dataclass(frozen=True)
class Account:
    id: str
    email: str


def account():
    user = current_account.get()
    if user is None:
        raise HTTPException(401, "이메일 인증 후 이용해 주세요.")
    return user


def authorize_game(state):
    if state.get("owner_id") != account().id:
        # 다른 사람의 게임이 존재하는지도 공개하지 않는다.
        raise HTTPException(404, "이 계정의 투자 기록을 찾을 수 없습니다.")


def token_expiry(token):
    """만료 캐시 상한에만 사용한다. 신원은 반드시 Auth /user 응답으로 확인한다."""
    try:
        payload = token.split(".")[1]
        body = json.loads(base64.urlsafe_b64decode(payload+"="*(-len(payload)%4)))
        expiry = float(body["exp"])
        return expiry if expiry < time.time()+86400*30 else 0
    except (ValueError, TypeError, KeyError, IndexError):
        return 0


class AccountAuth:
    def __init__(self, rest=None):
        self.rest = rest
        self.cache = OrderedDict()
        self.refreshes = OrderedDict()
        self.lock = threading.RLock()

    @property
    def configured(self):
        return self.rest is not None or bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SECRET_KEY"))

    def request(self, path, payload=None, token=None):
        if not self.configured:
            raise HTTPException(503, "이메일 인증 서버 연결 설정이 필요합니다.")
        if self.rest is None:
            self.rest = SupabaseREST()
        headers = {**self.rest.headers}
        if token:
            headers["Authorization"] = "Bearer "+token
        try:
            response = self.rest.client.request("GET" if payload is None else "POST",
                self.rest.url+"/auth/v1/"+path, headers=headers, json=payload)
        except httpx.HTTPError:
            raise HTTPException(503, "이메일 인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도하세요.") from None
        if response.is_success:
            try:
                return response.json() if response.content else {}
            except ValueError:
                raise HTTPException(503, "인증 응답을 확인하지 못했습니다.") from None
        try:
            code = response.json().get("code", response.json().get("error_code", ""))
        except (ValueError, AttributeError):
            code = ""
        if code == "email_address_not_authorized":
            raise HTTPException(503, "인증메일 발송 서비스 설정을 확인해 주세요.")
        if response.status_code == 429 or code in ("over_email_send_rate_limit", "over_request_rate_limit"):
            raise HTTPException(429, "인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.")
        if path == "verify":
            raise HTTPException(400, "인증번호가 올바르지 않거나 만료됐습니다. 최신 메일을 확인해 주세요.")
        if path == "user" or path.startswith("token"):
            raise HTTPException(401, "로그인이 만료됐습니다. 이메일로 다시 인증해 주세요.")
        raise HTTPException(503, "인증메일을 보내지 못했습니다. 발신 도메인·SMTP 연결 상태를 확인해 주세요.")

    def user(self, token):
        if not token or len(token) > 16000 or token_expiry(token) <= time.time():
            raise HTTPException(401, "이메일로 다시 인증해 주세요.")
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock:
            cached = self.cache.get(digest)
            if cached and cached[0] > time.monotonic():
                self.cache.move_to_end(digest)
                return cached[1]
        result = self.request("user", token=token)
        try:
            uid = str(uuid.UUID(result["id"]))
            email = result["email"]
            if not result.get("email_confirmed_at") or result.get("is_anonymous") or not isinstance(email, str):
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise HTTPException(401, "이메일 인증을 완료해 주세요.") from None
        user = Account(uid, email)
        with self.lock:
            self.cache[digest] = (time.monotonic()+max(0, min(30, token_expiry(token)-time.time())), user)
            while len(self.cache) > 256:
                self.cache.popitem(last=False)
        return user

    def authenticate(self, request):
        access, refresh = request.cookies.get(ACCESS_COOKIE), request.cookies.get(REFRESH_COOKIE)
        if access:
            try:
                return self.user(access), None
            except HTTPException as exc:
                if exc.status_code != 401 or not refresh:
                    raise
        if not refresh:
            return None, None
        if len(refresh) > 4096:
            raise HTTPException(401, "이메일로 다시 인증해 주세요.")
        digest = hashlib.sha256(refresh.encode()).hexdigest()
        # 같은 인스턴스의 병렬 갱신은 한 번만 수행한다. 원문은 짧은 메모리 캐시에만 둔다.
        with self.lock:
            cached = self.refreshes.get(digest)
            if cached and cached[0] > time.monotonic():
                tokens = cached[1]
            else:
                tokens = self.request("token?grant_type=refresh_token", {"refresh_token": refresh})
                self.validate_tokens(tokens)
                self.refreshes[digest] = (time.monotonic()+8, tokens)
                while len(self.refreshes) > 64:
                    self.refreshes.popitem(last=False)
        return self.user(tokens["access_token"]), tokens

    @staticmethod
    def validate_tokens(tokens):
        if not isinstance(tokens, dict) or not all(isinstance(tokens.get(k), str) and tokens[k] for k in ("access_token", "refresh_token")):
            raise HTTPException(503, "로그인 세션을 확인하지 못했습니다.")

    def send(self, email):
        self.request("otp", {"email": email, "create_user": True})

    def verify(self, email, code):
        tokens = self.request("verify", {"email": email, "token": code, "type": "email"})
        self.validate_tokens(tokens)
        user = self.user(tokens["access_token"])
        if user.email.lower() != email.lower():
            raise HTTPException(401, "인증한 이메일이 일치하지 않습니다.")
        return user, tokens

    def logout(self, request, refreshed=None):
        access = refreshed["access_token"] if refreshed else request.cookies.get(ACCESS_COOKIE)
        refresh = refreshed["refresh_token"] if refreshed else request.cookies.get(REFRESH_COOKIE)
        with self.lock:
            for token in (access, request.cookies.get(ACCESS_COOKIE)):
                if token:
                    self.cache.pop(hashlib.sha256(token.encode()).hexdigest(), None)
            for token in (refresh, request.cookies.get(REFRESH_COOKIE)):
                if token:
                    self.refreshes.pop(hashlib.sha256(token.encode()).hexdigest(), None)
        if access:
            try:
                self.request("logout?scope=local", {}, token=access)
            except HTTPException:
                pass  # 공급자 오류여도 브라우저의 인증 쿠키는 제거한다.


def set_auth_cookies(response, tokens, secure):
    if not tokens:
        return
    remaining = max(1, min(3600, int(token_expiry(tokens["access_token"])-time.time())))
    for name, value, age in ((ACCESS_COOKIE, tokens["access_token"], remaining),
                             (REFRESH_COOKIE, tokens["refresh_token"], 86400*30)):
        response.set_cookie(name, value, max_age=age, httponly=True, secure=secure, samesite="lax", path="/")


def clear_auth_cookies(response, secure):
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        response.delete_cookie(name, httponly=True, secure=secure, samesite="lax", path="/")
