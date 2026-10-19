"""Upload only validated real data to this project's private Blob store."""
import io
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env.local")
    from validate_data import validate
    if not validate()["passed"]:
        raise SystemExit("Real data validation failed")
    from backend.app.blob_store import PrivateBlob
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for a in "ABCD":
            p = ROOT / f"data/normalized/{a}_upbit_ohlcv_daily.csv"
            z.write(p, p.name)
    result = PrivateBlob().put("market/alpha-v1.zip", out.getvalue(), overwrite=True)
    print(json.dumps({"uploaded": True, "access": "private", "bytes": len(out.getvalue())}))
