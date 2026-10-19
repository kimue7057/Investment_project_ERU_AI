"""Download the private, hash-verified data bundle at Vercel build time only."""
import io
import json
import os
import urllib.request
import zipfile
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    manifest = json.loads((ROOT / "data/metadata/validation.json").read_text(encoding="utf-8"))
    token = os.environ["BLOB_READ_WRITE_TOKEN"]
    store = os.environ.get("BLOB_STORE_ID", token.split("_")[3]).removeprefix("store_").lower()
    url = f"https://{store}.private.blob.vercel-storage.com/market/alpha-v1.zip?cache=0"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as response:
        bundle = response.read()
    expected = {f"{a}_upbit_ohlcv_daily.csv" for a in "ABCD"}
    target = ROOT / "data/normalized"
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(bundle)) as z:
        if set(z.namelist()) != expected:
            raise ValueError("Unexpected files in private market bundle")
        for name in expected:
            body = z.read(name)
            if hashlib.sha256(body).hexdigest() != manifest["assets"][name[0]]["sha256"]:
                raise ValueError("Private market bundle does not match the reviewed manifest")
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
