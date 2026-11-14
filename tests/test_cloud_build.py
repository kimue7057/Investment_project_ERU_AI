import base64
import hashlib
import io
import zipfile
import gzip
import json

import pytest

from scripts import cloud_build


def test_bitcoin_private_build_bundle_is_verified_and_separate(tmp_path,monkeypatch):
    body=(cloud_build.ROOT/'data/normalized/bitcoin_cycles.csv').read_bytes()
    private_engine=(cloud_build.ROOT/'data/private/bitcoin_engine_impl.py').read_bytes()
    sha=hashlib.sha256(body).hexdigest()
    (tmp_path/'data/metadata').mkdir(parents=True)
    (tmp_path/'data/normalized').mkdir()
    (tmp_path/'data/bootstrap').mkdir()
    (tmp_path/'data/private').mkdir()
    (tmp_path/'data/private/bitcoin_engine_impl.py').write_bytes(private_engine)
    (tmp_path/'data/metadata/bitcoin_cycles_validation.json').write_text(json.dumps({'sha256':sha,'rows':3683,'engine_sha256':hashlib.sha256(private_engine).hexdigest()}))
    (tmp_path/'data/bootstrap/bitcoin_cycles.csv.gz').write_bytes(gzip.compress(body))
    stored=[]
    def request(method,params=None,payload=None,table=None):
        assert table=='eru_game_sessions'
        if method=='GET':
            assert params['environment']=='eq.production'
            return [{'state':stored[0]['state']}] if stored else []
        assert payload['state']['mode']=='bitcoin_market_bundle'
        stored.append(payload)
    monkeypatch.setattr(cloud_build,'ROOT',tmp_path)
    monkeypatch.setattr(cloud_build,'supabase_request',request)
    cloud_build.prepare_bitcoin()
    assert (tmp_path/'data/normalized/bitcoin_cycles.csv').read_bytes()==body
    assert len(stored)==1
    cloud_build.prepare_bitcoin()
    assert len(stored)==1
    stored[0]['state']['sha256']='0'*64
    with pytest.raises(ValueError,match='checksum'):
        cloud_build.prepare_bitcoin()


def bundle_fixture():
    bodies = {name: (name + "-private-test-fixture").encode() for name in cloud_build.EXPECTED}
    manifest = {"assets": {name[0]: {"sha256": hashlib.sha256(body).hexdigest()}
                           for name, body in bodies.items()}}
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, body in bodies.items():
            z.writestr(name, body)
    return out.getvalue(), manifest, bodies


def test_bundle_rejects_modified_market_data_and_extra_paths():
    bundle, manifest, bodies = bundle_fixture()
    assert cloud_build.verified_files(bundle, manifest) == bodies
    manifest["assets"]["A"]["sha256"] = "0" * 64
    with pytest.raises(ValueError, match="reviewed manifest"):
        cloud_build.verified_files(bundle, manifest)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, body in bodies.items():
            z.writestr(name, body)
        z.writestr("../../unexpected.csv", b"private")
    with pytest.raises(ValueError, match="Unexpected files"):
        cloud_build.verified_files(out.getvalue(), manifest)


def test_existing_supabase_bundle_downloads_without_blob_or_local_prices(monkeypatch):
    bundle, manifest, _ = bundle_fixture()
    calls = []
    def request(method, params=None, payload=None):
        calls.append(method)
        return [{"body_base64": base64.b64encode(bundle).decode(), "sha256": hashlib.sha256(bundle).hexdigest()}]
    monkeypatch.setattr(cloud_build, "supabase_request", request)
    monkeypatch.setenv("ERU_STORAGE_BACKEND", "supabase")
    monkeypatch.delenv("BLOB_READ_WRITE_TOKEN", raising=False)
    assert cloud_build.download_bundle(manifest) == bundle and calls == ["GET"]


def test_first_seed_only_uploads_reviewed_data_and_reads_back(monkeypatch, tmp_path):
    _, manifest, bodies = bundle_fixture()
    target = tmp_path / "data/normalized"
    target.mkdir(parents=True)
    for name, body in bodies.items():
        (target / name).write_bytes(body)
    stored = []
    calls = []
    def request(method, params=None, payload=None):
        calls.append(method)
        if method == "POST":
            stored.append(payload)
        else:
            return stored
    monkeypatch.setattr(cloud_build, "ROOT", tmp_path)
    monkeypatch.setattr(cloud_build, "supabase_request", request)
    result = cloud_build.supabase_bundle(manifest)
    assert cloud_build.verified_files(result, manifest) == bodies
    assert calls == ["GET", "POST", "GET"]
    stored.clear()
    calls.clear()
    (target / "A_upbit_ohlcv_daily.csv").write_bytes(b"unreviewed")
    with pytest.raises(ValueError, match="reviewed manifest"):
        cloud_build.supabase_bundle(manifest)
    assert calls == ["GET"] and not stored


def test_corrupted_stored_bundle_cannot_fall_back_to_local_data(monkeypatch):
    bundle, manifest, _ = bundle_fixture()
    monkeypatch.setattr(cloud_build, "supabase_request", lambda *a, **k:
        [{"body_base64": base64.b64encode(bundle).decode(), "sha256": "0" * 64}])
    with pytest.raises(ValueError, match="checksum"):
        cloud_build.supabase_bundle(manifest)
