"""Private Vercel Blob storage with origin reads and ETag compare-and-swap.

Uses the protocol implemented by Vercel's official @vercel/blob SDK. The Python
SDK does not yet expose conditional writes. No token or object URL is public.
"""
import json
import os
import re
from urllib.parse import quote

import httpx


class StorageConflict(Exception):
    pass


class PrivateBlob:
    def __init__(self, token=None, store_id=None, client=None):
        self.token = token or os.environ["BLOB_READ_WRITE_TOKEN"]
        self.store_id = store_id or os.environ.get("BLOB_STORE_ID") or self.token.split("_")[3]
        self.store_id = self.store_id.removeprefix("store_")
        if not re.fullmatch(r"[A-Za-z0-9]+", self.store_id):
            raise ValueError("Invalid private store identifier")
        self.client = client or httpx.Client(timeout=20, follow_redirects=False)

    def read(self, path):
        url = f"https://{self.store_id.lower()}.private.blob.vercel-storage.com/{quote(path, safe='/')}"
        r = self.client.get(url, params={"cache": "0"}, headers={"Authorization": "Bearer " + self.token,
                           "Accept-Encoding": "identity"})
        if r.status_code == 404:
            return None
        r.raise_for_status()
        # CDN compression can weaken the delivery validator while keeping the
        # same underlying object tag; writes require the object's strong tag.
        return r.content, r.headers["etag"].removeprefix("W/")

    def put(self, path, body, etag=None, overwrite=False):
        headers = {"Authorization": "Bearer " + self.token, "x-api-version": "13",
                   "x-vercel-blob-access": "private", "x-add-random-suffix": "0",
                   "x-allow-overwrite": "1" if overwrite else "0",
                   "x-content-type": "application/octet-stream", "x-cache-control-max-age": "60"}
        if etag is not None:
            headers["x-if-match"] = etag
        r = self.client.put("https://blob.vercel-storage.com/", params={"pathname": path}, content=body, headers=headers)
        if r.status_code in (409, 412):
            raise StorageConflict()
        # Never propagate provider bodies containing credentials/URLs into API errors.
        r.raise_for_status()
        return r.json()


class BlobSessions:
    def __init__(self, blob=None, prefix=None):
        self.blob = blob or PrivateBlob()
        self.prefix = prefix or "sessions/" + os.environ.get("VERCEL_ENV", "development")

    def path(self, sid):
        if not re.fullmatch(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}", sid):
            raise ValueError("Invalid session identifier")
        return f"{self.prefix}/{sid}.json"

    def read(self, sid):
        result = self.blob.read(self.path(sid))
        if result is None:
            return None
        body, etag = result
        return json.loads(body), etag

    def probe(self):
        # 존재하지 않아도 404면 저장소에 접근 가능하다. 검사로 객체를 쓰지 않는다.
        self.blob.read("health/connection.json")

    def write(self, sid, state, wall_time, etag=None):
        payload = json.dumps({"state": state, "last_seen": wall_time}, separators=(",", ":")).encode()
        self.blob.put(self.path(sid), payload, etag=etag, overwrite=etag is not None)
