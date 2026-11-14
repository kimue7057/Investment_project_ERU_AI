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
import gzip
import time
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


def supabase_request(method, params=None, payload=None, table="eru_market_bundles"):
    url = os.environ["SUPABASE_URL"].rstrip("/")
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443)):
        raise ValueError("Invalid Supabase server URL")
    key = os.environ["SUPABASE_SECRET_KEY"]
    if not key.startswith("sb_secret_") or any(c.isspace() for c in key):
        raise ValueError("A server-only Supabase secret key is required")
    if table not in ("eru_market_bundles", "eru_game_sessions"):
        raise ValueError("Unexpected private build table")
    endpoint = url + "/rest/v1/" + table
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


def prepare_bitcoin():
    """새 원본은 기존 서버 전용 JSON 저장소의 별도 불변 레코드로 보관한다."""
    report_path = ROOT / "data/metadata/bitcoin_cycles_validation.json"
    if not report_path.exists():
        return  # 이전 보관 브랜치의 빌드와 호환한다.
    report = json.loads(report_path.read_text(encoding="utf-8"))
    sid = "c406fc9b-0818-5ea9-a632-4e12ef447abc"
    params = {"environment":"eq.production", "id":"eq."+sid, "select":"state"}
    rows = supabase_request("GET", params, table="eru_game_sessions")
    if not rows:
        packed = (ROOT/"data/bootstrap/bitcoin_cycles.csv.gz").read_bytes()
        content = gzip.decompress(packed)
        if hashlib.sha256(content).hexdigest() != report["sha256"]:
            raise ValueError("BTC bootstrap checksum failed")
        private_engine=(ROOT/"data/private/bitcoin_engine_impl.py").read_bytes()
        if hashlib.sha256(private_engine).hexdigest()!=report["engine_sha256"]:
            raise ValueError("BTC private engine checksum failed")
        supabase_request("POST", payload={"environment":"production", "id":sid,"revision":1,
            "last_seen":time.time(),"state":{"mode":"bitcoin_market_bundle", "sha256":report["sha256"],
            "body_base64":base64.b64encode(packed).decode(),"engine_sha256":report["engine_sha256"],
            "engine_base64":base64.b64encode(private_engine).decode()}},table="eru_game_sessions")
        rows = supabase_request("GET",params,table="eru_game_sessions")
    if not rows or rows[0]["state"].get("mode")!="bitcoin_market_bundle":
        raise ValueError("BTC private build data is unavailable")
    saved=rows[0]["state"]
    body=gzip.decompress(base64.b64decode(saved["body_base64"],validate=True))
    if saved["sha256"]!=report["sha256"] or hashlib.sha256(body).hexdigest()!=report["sha256"]:
        raise ValueError("BTC private build checksum failed")
    private_engine=base64.b64decode(saved["engine_base64"],validate=True)
    if saved["engine_sha256"]!=report["engine_sha256"] or hashlib.sha256(private_engine).hexdigest()!=report["engine_sha256"]:
        raise ValueError("BTC private engine checksum failed")
    private_path=ROOT/"data/private/bitcoin_engine_impl.py"
    private_path.parent.mkdir(parents=True,exist_ok=True)
    private_path.write_bytes(private_engine)
    target=ROOT/"data/normalized/bitcoin_cycles.csv"
    target.write_bytes(body)
    import sys
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    from scripts.collect_bitcoin_cycles import validate_rows
    import csv
    validate_rows(list(csv.DictReader(body.decode("utf-8").splitlines())))
    print(json.dumps({"btc_data_verified":True,"rows":report["rows"]}))


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
    prepare_bitcoin()
    print(json.dumps({"data_verified": True, "rows": {a: r["rows"] for a, r in result["assets"].items()}}))


if __name__ == "__main__":
    main()
