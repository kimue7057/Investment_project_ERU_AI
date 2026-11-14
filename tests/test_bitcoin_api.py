import copy
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.bitcoin_service import COOKIE


@pytest.fixture
def btc_app(tmp_path,monkeypatch):
    db=sqlite3.connect(tmp_path/"btc.sqlite3",check_same_thread=False)
    db.execute("CREATE TABLE sessions(id TEXT PRIMARY KEY,state TEXT NOT NULL)")
    monkeypatch.setattr(main,"db",db)
    monkeypatch.setattr(main,"cloud_store",None)
    wall=[1800000000.0]
    monkeypatch.setattr(main.bitcoin_service,"clock",lambda:wall[0])
    with TestClient(main.app) as client:
        yield client,wall,db
    db.close()


def start(c,amount=100000000):
    r=c.post('/api/bitcoin/sessions',json={"amount":amount})
    assert r.status_code==200,r.text
    return r.json()['id']


def test_anonymous_start_cookie_and_private_owner_boundary(btc_app):
    c,wall,db=btc_app
    sid=start(c)
    cookie=next(x for x in c.cookies.jar if x.name==COOKIE)
    assert cookie.has_nonstandard_attr('HttpOnly')
    original=db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0]
    wall[0]+=2
    with TestClient(main.app) as other:
        assert other.get('/api/bitcoin/sessions/'+sid).status_code==404
        assert other.post('/api/bitcoin/sessions/'+sid+'/playback',json={"action":"finish"}).status_code==404
        assert other.get('/api/bitcoin/records').json()=={"records":[]}
    assert db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0]==original
    assert c.post('/api/guided-sessions',json={}).status_code==401


def test_server_clock_speed_pause_and_offline_gap(btc_app):
    c,wall,_=btc_app;sid=start(c);url='/api/bitcoin/sessions/'+sid
    wall[0]+=2
    assert c.get(url).json()['elapsed']==8
    wall[0]+=1
    assert c.post(url+'/playback',json={"action":"pause"}).json()['elapsed']==12
    wall[0]+=100
    assert c.get(url).json()['elapsed']==12
    c.post(url+'/playback',json={"action":"speed","speed":8})
    c.post(url+'/playback',json={"action":"resume"})
    wall[0]+=1
    assert c.get(url).json()['elapsed']==20
    wall[0]+=16
    after=c.get(url).json()
    assert after['status']=='paused' and after['elapsed']==20


def test_input_validation_finish_and_records_do_not_accept_client_results(btc_app):
    c,_,_=btc_app
    for amount in [0,-1,10000000001,'NaN']:
        assert c.post('/api/bitcoin/sessions',json={"amount":amount}).status_code==422
    sid=start(c);url='/api/bitcoin/sessions/'+sid
    assert c.post(url+'/playback',json={"action":"finish","elapsed":300}).status_code==422
    g=c.post(url+'/playback',json={"action":"finish"}).json()
    assert g['status']=='finished' and len(g['cycles'])==3
    assert all(x['completed'] and x['all_events'] for x in g['cycles'])
    records=c.get('/api/bitcoin/records').json()['records']
    assert records[0]['id']==sid and set(records[0])=={'id','amount','elapsed','status','created_at'}


def test_next_scene_reveals_the_selected_event_at_daily_boundary(btc_app):
    c,_,_=btc_app;sid=start(c);url='/api/bitcoin/sessions/'+sid
    c.post(url+'/playback',json={"action":"pause"})
    expected=main.bitcoin_service.engine.runs[0]['highlights'][0]
    result=c.post(url+'/playback',json={"action":"next"})
    assert result.status_code==200
    visible=result.json()['cycles'][0]['events']
    assert any(e['id']==expected['id'] for e in visible)
    assert result.json()['status']=='paused'


def test_email_unconfigured_is_truthful_and_requires_consent(btc_app,monkeypatch):
    c,_,_=btc_app;sid=start(c);url='/api/bitcoin/sessions/'+sid+'/email'
    monkeypatch.delenv('RESEND_FROM_EMAIL',raising=False)
    assert c.post(url,json={"email":"a@example.test","consent":False}).status_code==422
    assert c.post(url,json={"email":"bad","consent":True}).status_code==422
    assert c.post(url,json={"email":"a@example.test","consent":True,"website":"bot"}).status_code==422
    assert c.post(url,json={"email":"a@example.test","consent":True}).status_code==503


def test_report_is_server_generated_idempotent_and_not_an_open_relay(btc_app,monkeypatch):
    c,_,db=btc_app;sid=start(c);base='/api/bitcoin/sessions/'+sid
    monkeypatch.setenv('RESEND_API_KEY','re_test_only')
    monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    sent=[]
    def handler(req):
        payload=json.loads(req.content)
        assert req.url.host=='api.resend.com'
        assert payload['to']==['reader@example.test']
        assert len(payload['attachments'])==1 and payload['attachments'][0]['filename'].endswith('.pdf')
        assert '최대 낙폭' in payload['html'] and '회사 소개' in payload['html']
        assert req.headers['Idempotency-Key'].startswith('bitcoin-result/'+sid+'/')
        sent.append(payload)
        return httpx.Response(200,json={"id":"test-message-1"})
    monkeypatch.setattr(main.bitcoin_service.mailer,'client',httpx.Client(transport=httpx.MockTransport(handler)))
    body={"email":" Reader@Example.test ","consent":True}
    assert c.post(base+'/email',json=body).status_code==400
    c.post(base+'/playback',json={"action":"finish"})
    with TestClient(main.app) as other:
        assert other.post(base+'/email',json=body).status_code==404
    assert c.post(base+'/email',json={**body,"html":"forged"}).status_code==422
    first=c.post(base+'/email',json=body)
    assert first.status_code==200 and first.json()['status']=='accepted'
    assert c.post(base+'/email',json=body).json()['already_sent'] is True
    assert len(sent)==1
    stored=db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0]
    assert 'reader@example.test' not in stored and 're_test_only' not in stored


def test_email_provider_failure_does_not_claim_success_or_leak_body(btc_app,monkeypatch):
    c,_,db=btc_app;sid=start(c);base='/api/bitcoin/sessions/'+sid
    c.post(base+'/playback',json={"action":"finish"})
    monkeypatch.setenv('RESEND_API_KEY','re_test_only')
    monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    monkeypatch.setattr(main.bitcoin_service.mailer,'client',httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(500,json={"secret":"do-not-return"}))))
    r=c.post(base+'/email',json={"email":"reader@example.test","consent":True})
    assert r.status_code==503 and 'do-not-return' not in r.text
    s=json.loads(db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0])
    assert not s.get('email_receipts') and not s.get('email_pending')
