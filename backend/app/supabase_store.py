"""서버 전용 Supabase REST 저장소. 수정은 revision 비교로 원자적으로 처리한다."""
import os
import re
from urllib.parse import urlsplit

import httpx

from .blob_store import StorageConflict


SESSION_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")


class SupabaseREST:
    def __init__(self, url=None, key=None, client=None):
        self.url = (url or os.environ["SUPABASE_URL"]).rstrip("/")
        parsed = urlsplit(self.url)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443)):
            raise ValueError("Invalid Supabase server URL")
        key = key or os.environ["SUPABASE_SECRET_KEY"]
        if not key.startswith("sb_secret_") or any(c.isspace() for c in key):
            raise ValueError("A server-only Supabase secret key is required")
        # 새 secret 키는 JWT가 아니므로 Authorization Bearer에 넣지 않는다.
        self.headers = {"apikey": key, "Content-Type": "application/json"}
        self.client = client or httpx.Client(timeout=20, follow_redirects=False)

    def request(self, method, table, *, params=None, payload=None, prefer=None):
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        return self.client.request(method, self.url + "/rest/v1/" + table,
                                   params=params, json=payload, headers=headers)


class SupabaseSessions:
    storage_name = "supabase_postgres"

    def __init__(self, rest=None, environment=None):
        self.rest = rest or SupabaseREST()
        self.environment = environment or os.environ.get("VERCEL_ENV", "development")
        if self.environment not in ("production", "preview", "development"):
            raise ValueError("Invalid session environment")

    def filters(self, sid):
        if not SESSION_ID.fullmatch(sid):
            raise ValueError("Invalid session identifier")
        return {"environment": "eq." + self.environment, "id": "eq." + sid}

    def probe(self):
        r = self.rest.request("GET", "eru_game_sessions", params={
            "select": "id", "environment": "eq." + self.environment, "limit": "1"})
        r.raise_for_status()

    def read(self, sid):
        params = {**self.filters(sid), "select": "state,last_seen,revision"}
        r = self.rest.request("GET", "eru_game_sessions", params=params)
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return None
        row = rows[0]
        return {"state": row["state"], "last_seen": row["last_seen"]}, str(row["revision"])

    def write(self, sid, state, wall_time, etag=None):
        params = self.filters(sid)
        payload = {"state": state, "last_seen": wall_time}
        if etag is None:
            payload.update(id=sid, environment=self.environment, revision=1)
            r = self.rest.request("POST", "eru_game_sessions", payload=payload)
            if r.status_code == 409 and r.json().get("code") == "23505":
                raise StorageConflict()
        else:
            if not re.fullmatch(r"[1-9][0-9]*", str(etag)):
                raise ValueError("Invalid session revision")
            params.update(revision="eq." + str(etag), select="revision")
            payload["revision"] = int(etag) + 1
            r = self.rest.request("PATCH", "eru_game_sessions", params=params,
                                  payload=payload, prefer="return=representation")
            r.raise_for_status()
            if not r.json():
                raise StorageConflict()
        r.raise_for_status()
