"""빌드 시에만 비공개 시세 원본을 받아 검토된 CSV 해시를 검증한다."""
import base64
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = {f"{a}_upbit_ohlcv_daily.csv" for a in "ABCD"}


def verified_files(bundle, manifest):
    with zipfile.ZipFile(io.BytesIO(bundle)) as z:
        if set(z.namelist()) != EXPECTED or len(z.namelist()) != len(EXPECTED):
            raise ValueError("Unexpected files in private market bundle")
        bodies = {name: z.read(name) for name in EXPECTED}
    for name, body in bodies.items():
        if hashlib.sha256(body).hexdigest() != manifest["assets"][name[0]]["sha256"]:
            raise ValueError("Private market bundle does not match the reviewed manifest")
    return bodies


def supabase_request(method, params=None, payload=None):
    url = os.environ["SUPABASE_URL"].rstrip("/")
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443)):
        raise ValueError("Invalid Supabase server URL")
    key = os.environ["SUPABASE_SECRET_KEY"]
    if not key.startswith("sb_secret_") or any(c.isspace() for c in key):
        raise ValueError("A server-only Supabase secret key is required")
    endpoint = url + "/rest/v1/eru_market_bundles"
    if params:
        endpoint += "?" + urllib.parse.urlencode(params)
    headers = {"apikey": key, "Content-Type": "application/json"}
    if method == "POST":
        headers["Prefer"] = "resolution=ignore-duplicates,return=minimal"
    request = urllib.request.Request(endpoint, method=method, headers=headers,
        data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Private market store request failed (HTTP {exc.code})") from None
    except urllib.error.URLError:
        raise RuntimeError("Private market store connection failed") from None
    return json.loads(body) if body else None


def supabase_bundle(manifest):
    rows = supabase_request("GET", {"id": "eq.alpha-v1", "select": "body_base64,sha256"})
    if rows:
        bundle = base64.b64decode(rows[0]["body_base64"], validate=True)
        if hashlib.sha256(bundle).hexdigest() != rows[0]["sha256"]:
            raise ValueError("Private market bundle checksum failed")
        verified_files(bundle, manifest)
        return bundle
    # 최초 이전 배포만 검증된 로컬 CSV를 비공개 배포 소스로 포함한다.
    # CSV가 없는 이후 Git 배포에서는 DB의 빌드 원본을 읽는다.
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(EXPECTED):
            z.writestr(name, (ROOT / "data/normalized" / name).read_bytes())
    bundle = out.getvalue()
    verified_files(bundle, manifest)  # 검토된 해시와 다르면 업로드하지 않는다.
    supabase_request("POST", payload={"id": "alpha-v1", "body_base64": base64.b64encode(bundle).decode(),
                                     "sha256": hashlib.sha256(bundle).hexdigest()})
    # 중복 생성 경쟁이 있어도 실제 저장된 원본을 다시 읽고 검증한다.
    stored = supabase_request("GET", {"id": "eq.alpha-v1", "select": "body_base64,sha256"})
    if not stored:
        raise RuntimeError("Private market bundle was not persisted")
    result = base64.b64decode(stored[0]["body_base64"], validate=True)
    if hashlib.sha256(result).hexdigest() != stored[0]["sha256"]:
        raise ValueError("Private market bundle checksum failed")
    verified_files(result, manifest)
    return result


def download_bundle(manifest):
    if os.environ.get("ERU_STORAGE_BACKEND") == "supabase" or any(
            os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY")):
        return supabase_bundle(manifest)
    token = os.environ["BLOB_READ_WRITE_TOKEN"]
    store = os.environ.get("BLOB_STORE_ID", token.split("_")[3]).removeprefix("store_").lower()
    url = f"https://{store}.private.blob.vercel-storage.com/market/alpha-v1.zip?cache=0"
    request = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def main():
    manifest = json.loads((ROOT / "data/metadata/validation.json").read_text(encoding="utf-8"))
    bundle = download_bundle(manifest)
    bodies = verified_files(bundle, manifest)
    target = ROOT / "data/normalized"
    target.mkdir(parents=True, exist_ok=True)
    for name, body in bodies.items():
        (target / name).write_bytes(body)
    import sys
    sys.path.insert(0, str(ROOT / "scripts"))
    from validate_data import validate
    result = validate()
    if not result["passed"]:
        raise ValueError("Historical market validation failed")
    print(json.dumps({"data_verified": True, "rows": {a: r["rows"] for a, r in result["assets"].items()}}))


if __name__ == "__main__":
    main()
