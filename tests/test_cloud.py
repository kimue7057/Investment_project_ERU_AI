import copy
import json
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.blob_store import BlobSessions, PrivateBlob, StorageConflict


class MemoryCloud:
    def __init__(self):
        self.records = {}
        self.writes = 0
        self.fail_once = False

    def read(self, sid):
        return copy.deepcopy(self.records.get(sid))

    def probe(self):
        pass

    def write(self, sid, state, wall_time, etag=None):
        if self.fail_once:
            self.fail_once = False
            raise StorageConflict()
        if etag is not None and etag != self.records[sid][1]:
            raise StorageConflict()
        self.writes += 1
        self.records[sid] = ({"state": copy.deepcopy(state), "last_seen": wall_time}, str(self.writes))


@pytest.fixture
def cloud(monkeypatch):
    store = MemoryCloud()
    wall = [1000.0]
    monkeypatch.setattr(main, "IS_CLOUD", True)
    monkeypatch.setattr(main, "cloud_store", store)
    monkeypatch.setattr(main.time, "time", lambda: wall[0])
    with TestClient(main.app) as client:
        yield client, store, wall


def start_cloud(client):
    s = client.post("/api/sessions").json()
    url = f"/api/sessions/{s['id']}"
    r = client.post(url + "/start", json={"weights": {"cash": 100, "A": 0, "B": 0, "C": 0, "D": 0}})
    assert r.status_code == 200
    return url


def test_paper_cloud_recovery_and_no_automatic_alerts(cloud):
    c, store, wall = cloud
    s = c.post("/api/paper-sessions", json={}).json()
    url = f"/api/sessions/{s['id']}"
    assert c.post(url + "/play", json={}).json()["pending"] is None
    for _ in range(5):
        wall[0] += 10
        state = c.get(url).json()
        assert state["status"] == "running" and "alerts" not in state and "research" not in state
    main.anchors.clear()
    recovered = c.get(url).json()
    assert recovered["mode"] == "paper" and recovered["cash"] == 100000000
    assert c.post(url + "/pause", json={}).status_code == 200
    assert c.post(url + "/orders", json={"asset": "C", "side": "buy", "amount": 1000000}).status_code == 200
    assert c.post(url + "/resume", json={}).status_code == 200
    wall[0] += 1
    filled = c.get(url).json()
    assert len(filled["trades"]) == 1 and filled["cash"] == 99000000


def test_read_only_checkpoint_retries_without_replaying_orders(cloud, monkeypatch):
    c, store, wall = cloud
    s = c.post("/api/paper-sessions", json={}).json()
    url = f"/api/sessions/{s['id']}"
    c.post(url + "/play", json={})
    original_write = store.write
    calls = []
    def write(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.HTTPStatusError('temporary provider error', request=httpx.Request('PUT', 'https://example.invalid'), response=httpx.Response(400, json={'error': {'code': 'bad_request'}}))
        return original_write(*args, **kwargs)
    monkeypatch.setattr(store, 'write', write)
    wall[0] += 6
    r = c.get(url)
    assert r.status_code == 200 and r.json()["status"] == "running"
    assert r.json()["elapsed"] == 6 and r.json()["trades"] == [] and len(calls) == 2


def test_cold_instances_share_clock_and_state(cloud):
    c, store, wall = cloud
    url = start_cloud(c)
    writes = store.writes
    wall[0] += .03
    first = c.get(url).json()
    main.anchors.clear()
    wall[0] += .03
    second = c.get(url).json()
    assert second["status"] == "running"
    assert second["elapsed"] > first["elapsed"]
    assert second["cash"] == 100000000
    assert store.writes == writes  # Read-only frames do not contend with decisions.


def test_cloud_pause_and_long_inactivity(cloud):
    c, store, wall = cloud
    url = start_cloud(c)
    wall[0] += 30
    paused = c.get(url).json()
    assert paused["status"] == "paused" and paused["elapsed"] == 0
    count = store.writes
    wall[0] += 100
    assert c.get(url).json()["now"] == paused["now"]
    assert store.writes == count
    c.post(url + "/resume", json={})
    wall[0] += .03
    assert c.get(url).json()["elapsed"] > 0


def test_cloud_compare_and_swap_retry(cloud):
    c, store, wall = cloud
    url = start_cloud(c)
    store.fail_once = True
    assert c.post(url + "/pause", json={}).status_code == 200
    assert c.get(url).json()["status"] == "paused"


def test_cloud_only_trusts_exact_configured_host(cloud, monkeypatch):
    c, _, _ = cloud
    host = "eru-ai-investment-simulator.vercel.app"
    monkeypatch.setenv("ERU_ALLOWED_HOSTS", host)
    assert c.get("/api/health", headers={"Host": host, "Origin": "https://"+host}).status_code == 200
    assert c.post("/api/sessions", headers={"Host": host, "Origin": "https://other.vercel.app"}).status_code == 403
    assert c.get("/api/health", headers={"Host": "other.vercel.app"}).status_code == 403


def test_private_origin_reads_and_conditional_write_protocol():
    seen = []
    def handler(request):
        seen.append(request)
        if request.method == "GET":
            assert request.url.params["cache"] == "0"
            return httpx.Response(200, content=b'{"state":{}}', headers={"etag": '"old"'})
        assert request.headers["x-if-match"] == '"old"'
        assert request.url.params["pathname"] == "sessions/check.json"
        return httpx.Response(412)
    b = PrivateBlob(token="vercel_blob_rw_testid_test", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert b.read("sessions/check.json")[1] == '"old"'
    with pytest.raises(StorageConflict):
        b.put("sessions/check.json", b"{}", etag='"old"', overwrite=True)
    assert seen[0].url.host.endswith(".private.blob.vercel-storage.com")


def test_cloud_session_paths_do_not_accept_arbitrary_objects():
    s = BlobSessions(blob=object())
    with pytest.raises(ValueError):
        s.path("../../market/alpha-v1.zip")
    assert s.path(str(uuid.uuid4())).endswith(".json")


def test_guided_interest_checkpoint_reconstruction_and_frozen_dialogue(cloud):
    c, store, wall = cloud
    s = c.post("/api/guided-sessions", json={}).json()
    url = f"/api/sessions/{s['id']}"
    c.post(url+"/start", json={"weights":{"cash":100,"A":0,"B":0,"C":0,"D":0}})
    wall[0] += .5
    first = c.get(url).json()
    assert first["interest_account"]["accrued"] > 0 and first["cash"] == 100000000
    same = c.get(url).json()
    assert same["interest_account"] == first["interest_account"]
    wall[0] += 1
    second = c.get(url).json()
    assert abs(second["interest_account"]["accrued"] / first["interest_account"]["accrued"] - 3) < 1e-8
    stopped = c.post(url+"/pause", json={}).json()
    wall[0] += 100
    recovered = c.get(url).json()
    assert recovered["now"] == stopped["now"]
    assert recovered["interest_account"] == stopped["interest_account"]
    assert recovered["mode"] == "guided" and "research" not in recovered


def test_private_delivery_compression_cannot_break_compare_and_swap():
    def handler(request):
        assert request.headers["accept-encoding"] == "identity"
        return httpx.Response(200, content=b"{}", headers={"etag": 'W/"object-revision"'})
    b = PrivateBlob(token="vercel_blob_rw_testid_test", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert b.read("checks/large.json")[1] == '"object-revision"'


def test_storage_suspension_is_unhealthy_and_create_is_safely_logged(cloud,monkeypatch,caplog):
    c,store,_=cloud
    def denied(*args,**kwargs):
        raise httpx.HTTPStatusError('provider-private-details',request=httpx.Request('GET','https://private.invalid'),response=httpx.Response(403,text='private-token-and-url'))
    monkeypatch.setattr(store,'probe',denied)
    monkeypatch.setattr(store,'write',denied)
    r=c.get('/api/health')
    assert r.status_code==503 and r.json()['status']=='storage_unavailable'
    r=c.post('/api/guided-sessions',json={})
    assert r.status_code==503 and '차단' in r.json()['detail']
    assert 'storage_create_failed' in caplog.text and 'private-token' not in caplog.text and 'private.invalid' not in caplog.text
    assert 'private' not in r.json()['detail']


def test_health_probe_cached_and_recovers_after_expiry(cloud,monkeypatch):
    c,store,_=cloud;calls=[];clock=[100.0]
    monkeypatch.setattr(main.time,'monotonic',lambda:clock[0])
    monkeypatch.setattr(store,'probe',lambda:calls.append(1))
    assert c.get('/api/health').status_code==200
    assert c.get('/api/health').status_code==200 and len(calls)==1
    clock[0]+=61
    assert c.get('/api/health').status_code==200 and len(calls)==2


def test_existing_custom_guard_is_retired_once_and_persisted_on_read(cloud):
    c,store,wall=cloud
    g=c.post('/api/guided-sessions',json={}).json();sid=g['id'];url='/api/sessions/'+sid
    assert c.post(url+'/start',json={'weights':{'cash':30,'A':70,'B':0,'C':0,'D':0}}).status_code==200
    wall[0]+=1
    assert c.get(url).json()['status']=='paused'
    legacy=store.records[sid][0]['state']
    legacy['risk_rules']=[{'metric':'asset_loss','asset':'held','threshold':8,'enabled':True}]
    legacy['risk_rule_state']={'0:A':{'active':True,'last':legacy['now']}}
    legacy['alerts'][-1]['id']='custom-legacy-alert'
    trades=copy.deepcopy(legacy['trades']);cash=legacy['cash'];last_alert=legacy['last_alert']
    writes=store.writes
    g=c.get(url).json()
    assert g['risk_rules'] is None and g['status']=='paused' and g['pending'] is None
    assert g['alerts'][-1]['decision']=='retired' and g['choices'][-1]['action']=='default_guard'
    assert g['trades'] and len(g['trades'])==len(trades)
    durable=store.records[sid][0]['state']
    assert durable['trades']==trades and durable['cash']==cash and durable['last_alert']==last_alert
    assert 'risk_rules' not in durable and 'risk_rule_state' not in durable and store.writes==writes+1
    assert c.get(url).json()['choices']==g['choices'] and store.writes==writes+1
    assert c.post(url+'/resume',json={}).status_code==200
    wall[0]+=.5
    assert c.get(url).json()['status']=='running'  # 기본 90일 대기 동안 즉시 재정지하지 않는다.
