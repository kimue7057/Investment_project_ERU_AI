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
    monkeypatch.delenv("RESEND_API_KEY",raising=False)
    monkeypatch.delenv("RESEND_FROM_EMAIL",raising=False)
    wall=[1800000000.0]
    monkeypatch.setattr(main.bitcoin_service,"clock",lambda:wall[0])
    with TestClient(main.app) as client:
        yield client,wall,db
    db.close()


def start(c,amount=100000000):
    r=c.post('/api/bitcoin/sessions',json={"amount":amount,"email":"reader@example.test","consent":True,"locale":"ko"})
    assert r.status_code==200,r.text
    return r.json()['id']


def test_fixed_report_requires_saved_email_and_rejects_client_capital(btc_app):
    c,_,_=btc_app
    assert c.post('/api/bitcoin/reports',json={'locale':'ko'}).status_code==400
    assert c.post('/api/bitcoin/reports',json={'locale':'ko','amount':1}).status_code==422
    assert c.post('/api/bitcoin/reports',json={'locale':'zh'}).status_code==422


@pytest.mark.parametrize('locale',['ko','en'])
def test_fixed_report_finishes_immediately_with_fixed_capital_and_owner_cache(btc_app,monkeypatch,locale):
    from decimal import Decimal
    from backend.app.display_currency import KRW_PER_SGD
    c,_,db=btc_app
    monkeypatch.setenv('ERU_LOCAL_PREVIEW','1')
    assert c.post('/api/bitcoin/contact',json={'email':'reader@example.test','consent':True}).status_code==200
    r=c.post('/api/bitcoin/reports',json={'locale':locale})
    assert r.status_code==200,r.text
    report=r.json()
    expected=Decimal('100000000') if locale=='ko' else (Decimal('100000')*KRW_PER_SGD).quantize(Decimal('.01'))
    assert report['amount']==float(expected)
    assert report['status']=='finished' and report['elapsed']==300
    assert report['report_mode']=='fixed_result'
    assert report['report_delivery']=={'status':'preview','recipient':'r***@example.test','locale':locale}
    assert all(cycle['summary'] and cycle['recovery'] and cycle['all_events'] for cycle in report['cycles'])
    assert 'reader@example.test' not in r.text and 'visitor_hash' not in r.text
    again=c.post('/api/bitcoin/reports',json={'locale':locale})
    assert again.json()==report
    saved=[json.loads(row[0]) for row in db.execute('SELECT state FROM sessions')]
    assert len([s for s in saved if s.get('report_mode')=='fixed_result'])==1
    with TestClient(main.app) as other:
        assert other.get('/api/bitcoin/sessions/'+report['id']).status_code==404


def test_fixed_report_uses_existing_automatic_mail_once(btc_app,monkeypatch):
    c,_,_=btc_app
    monkeypatch.delenv('ERU_LOCAL_PREVIEW',raising=False)
    monkeypatch.setenv('RESEND_API_KEY','re_test_only')
    monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    sent=[]
    def handler(req):
        payload=json.loads(req.content)
        assert payload['to']==['reader@example.test'] and len(payload['attachments'])==7
        assert {a['filename'] for a in payload['attachments'] if 'content_id' not in a}=={'ERUTY_Company_Introduction.pdf'}
        assert len([a for a in payload['attachments'] if 'content_id' in a])==6
        assert '상승장' in payload['html'] and '상세 복기' not in payload['html']
        assert '/screen-results-1/' in req.headers['Idempotency-Key']
        sent.append(payload)
        return httpx.Response(200,json={'id':'fixed-report-message'})
    monkeypatch.setattr(main.bitcoin_service.mailer,'client',httpx.Client(transport=httpx.MockTransport(handler)))
    c.post('/api/bitcoin/contact',json={'email':'reader@example.test','consent':True})
    first=c.post('/api/bitcoin/reports',json={'locale':'ko'})
    assert first.status_code==200 and first.json()['report_delivery']['status']=='accepted'
    assert c.post('/api/bitcoin/reports',json={'locale':'ko'}).json()['id']==first.json()['id']
    assert len(sent)==1


def legacy_start(c):
    """기존 수신 주소 미등록 기록의 수동 발송 호환성을 검증한다."""
    sid=start(c)
    _,db=main.bitcoin_service.provider()
    state=json.loads(db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0])
    state.pop('report_delivery')
    state['model_version']='btc-guard-1'
    db.execute('UPDATE sessions SET state=? WHERE id=?',(json.dumps(state),sid));db.commit()
    return sid


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
    assert records[0]['id']==sid and set(records[0])=={'id','amount','elapsed','status','created_at','model_version'}


def test_next_scene_reveals_the_selected_event_at_daily_boundary(btc_app):
    c,_,_=btc_app;sid=start(c);url='/api/bitcoin/sessions/'+sid
    c.post(url+'/playback',json={"action":"pause"})
    expected=main.bitcoin_service.engine.runs[0]['highlights'][0]
    result=c.post(url+'/playback',json={"action":"next"})
    assert result.status_code==200
    visible=result.json()['cycles'][0]['events']
    assert any(e['id']==expected['id'] for e in visible)
    assert result.json()['status']=='paused'


@pytest.mark.parametrize('position',[0,150,300])
def test_removed_seek_requests_cannot_move_or_finish_a_session(btc_app,position):
    c,wall,db=btc_app;sid=start(c)
    before=db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0]
    wall[0]+=2
    r=c.post('/api/bitcoin/sessions/'+sid+'/playback',json={'action':'seek','position':position})
    assert r.status_code==422
    assert db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0]==before


def test_email_unconfigured_is_truthful_and_requires_consent(btc_app,monkeypatch):
    c,_,_=btc_app;sid=start(c);url='/api/bitcoin/sessions/'+sid+'/email'
    monkeypatch.delenv('RESEND_FROM_EMAIL',raising=False)
    assert c.post(url,json={"email":"a@example.test","consent":False}).status_code==422
    assert c.post(url,json={"email":"bad","consent":True}).status_code==422
    assert c.post(url,json={"email":"a@example.test","consent":True,"website":"bot"}).status_code==422
    assert c.post(url,json={"email":"a@example.test","consent":True}).status_code==503
    assert c.post(url,json={"email":"a@example.test","consent":True,"locale":"zh"}).status_code==422


def test_sgd_capital_and_report_locale_preserve_canonical_ledger(btc_app,monkeypatch):
    c,_,_=btc_app
    r=c.post('/api/bitcoin/sessions',json={"amount":"103807249.23","email":"sgd@example.test","consent":True,"locale":"en"})
    assert r.status_code==200
    sid=r.json()['id'];base='/api/bitcoin/sessions/'+sid
    result=c.post(base+'/playback',json={"action":"finish"}).json()
    assert result['amount']==103807249.23
    monkeypatch.setenv('RESEND_API_KEY','re_test_only')
    monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    sent=[]
    def handler(req):
        payload=json.loads(req.content)
        assert 'S$100,000.00' in payload['html'] and 'lang="en"' in payload['html']
        assert 'Your Bitcoin comparison' in payload['subject']
        sent.append(payload)
        return httpx.Response(200,json={"id":"test-sgd-report"})
    monkeypatch.setattr(main.bitcoin_service.mailer,'client',httpx.Client(transport=httpx.MockTransport(handler)))
    assert c.post(base+'/email',json={"email":"sgd@example.test","consent":True,"locale":"en"}).status_code==200
    after=c.get(base).json()
    assert after['amount']==result['amount'] and after['cycles']==result['cycles'] and len(sent)==1


def test_report_is_server_generated_idempotent_and_not_an_open_relay(btc_app,monkeypatch):
    c,_,db=btc_app;sid=legacy_start(c);base='/api/bitcoin/sessions/'+sid
    monkeypatch.setenv('RESEND_API_KEY','re_test_only')
    monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    sent=[]
    def handler(req):
        payload=json.loads(req.content)
        assert req.url.host=='api.resend.com'
        assert payload['to']==['reader@example.test']
        assert len(payload['attachments'])==5
        assert {a['filename'] for a in payload['attachments'] if 'content_id' not in a}=={'ERUTY_Company_Introduction.pdf','ERU_RiskGuard_Results_Review.pdf'}
        assert len({a['content_id'] for a in payload['attachments'] if 'content_id' in a})==3
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
    c,_,db=btc_app;sid=legacy_start(c);base='/api/bitcoin/sessions/'+sid
    c.post(base+'/playback',json={"action":"finish"})
    monkeypatch.setenv('RESEND_API_KEY','re_test_only')
    monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    monkeypatch.setattr(main.bitcoin_service.mailer,'client',httpx.Client(transport=httpx.MockTransport(lambda req:httpx.Response(500,json={"secret":"do-not-return"}))))
    r=c.post(base+'/email',json={"email":"reader@example.test","consent":True})
    assert r.status_code==503 and 'do-not-return' not in r.text
    s=json.loads(db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0])
    assert not s.get('email_receipts') and not s.get('email_pending')


def test_old_email_receipt_allows_one_upgraded_report_then_deduplicates(btc_app,monkeypatch):
    import hashlib
    from backend.app.result_mail import REPORT_VERSION
    c,_,db=btc_app;sid=legacy_start(c);base='/api/bitcoin/sessions/'+sid
    c.post(base+'/playback',json={"action":"finish"})
    state=json.loads(db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0])
    digest=hashlib.sha256(b'reader@example.test').hexdigest()
    state['email_receipts']={digest:{'at':1794794400,'id':'legacy-basic-report'}}
    db.execute('UPDATE sessions SET state=? WHERE id=?',(json.dumps(state),sid));db.commit()
    monkeypatch.setenv('RESEND_API_KEY','re_test_only');monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    sent=[]
    def handler(req):
        sent.append(req)
        assert '/'+REPORT_VERSION+'/' in req.headers['Idempotency-Key']
        return httpx.Response(200,json={'id':'upgraded-report'})
    monkeypatch.setattr(main.bitcoin_service.mailer,'client',httpx.Client(transport=httpx.MockTransport(handler)))
    body={'email':'reader@example.test','consent':True,'locale':'ko'}
    assert c.post(base+'/email',json=body).json()['already_sent'] is False
    assert c.post(base+'/email',json=body).json()['already_sent'] is True
    assert len(sent)==1


def test_start_requires_email_consent_and_never_exposes_private_registration(btc_app):
    c,_,db=btc_app
    body={"amount":100000000,"email":" Reader@Example.test ","consent":True,"locale":"en"}
    assert c.post('/api/bitcoin/sessions',json={"amount":100000000}).status_code==400
    for bad in [{**body,"email":"bad"},{**body,"consent":False},{**body,"website":"bot"},{**body,"locale":"zh"}]:
        assert c.post('/api/bitcoin/sessions',json=bad).status_code==422
    r=c.post('/api/bitcoin/sessions',json=body);assert r.status_code==200
    g=r.json();d=g['report_delivery']
    assert d=={"status":"scheduled","recipient":"r***@example.test","locale":"en"}
    assert 'reader@example.test' not in r.text
    saved=json.loads(db.execute('SELECT state FROM sessions WHERE id=?',(g['id'],)).fetchone()[0])
    assert saved['report_delivery']['email']=='reader@example.test'
    assert saved['report_delivery']['consented_at']
    assert 'consented_at' not in r.text and 'all_events' not in r.text
    assert all('report_delivery' not in x for x in c.get('/api/bitcoin/records').json()['records'])


@pytest.mark.parametrize('completion',['finish','clock','next'])
def test_registered_report_sends_automatically_once_after_completion(btc_app,monkeypatch,completion):
    c,wall,db=btc_app
    sent=[]
    monkeypatch.setenv('RESEND_API_KEY','re_test_only');monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    def handler(req):
        payload=json.loads(req.content);sent.append(payload)
        assert payload['to']==['reader@example.test']
        assert len(payload['attachments'])==5 and '최대 낙폭' in payload['html']
        return httpx.Response(200,json={'id':'automatic-report'})
    monkeypatch.setattr(main.bitcoin_service.mailer,'client',httpx.Client(transport=httpx.MockTransport(handler)))
    sid=start(c);base='/api/bitcoin/sessions/'+sid
    assert c.get(base).json()['report_delivery']['status']=='scheduled' and not sent
    if completion=='clock':
        for _ in range(8):wall[0]+=10;result=c.get(base)
    elif completion=='next':
        for _ in range(130):
            result=c.post(base+'/playback',json={'action':'next'})
            if result.json()['status']=='finished':break
    else:result=c.post(base+'/playback',json={'action':'finish'})
    assert result.status_code==200 and result.json()['status']=='finished'
    assert result.json()['report_delivery']['status']=='accepted' and len(sent)==1
    assert c.get(base).json()['report_delivery']['status']=='accepted'
    assert c.post(base+'/playback',json={'action':'finish'}).status_code==200
    assert c.post(base+'/delivery/retry',json={}).json()['report_delivery']['status']=='accepted'
    assert len(sent)==1
    stored=db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0]
    assert 'reader@example.test' not in stored and 'automatic-report' not in result.text


def test_failed_auto_delivery_preserves_results_and_retries_registered_address_only(btc_app,monkeypatch):
    c,_,_=btc_app;sid=start(c);base='/api/bitcoin/sessions/'+sid
    monkeypatch.setenv('RESEND_API_KEY','re_test_only');monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    attempts=[]
    def handler(req):
        payload=json.loads(req.content);attempts.append(payload)
        if len(attempts)==1:return httpx.Response(500,json={'secret':'provider-private'})
        assert payload['to']==['reader@example.test']
        return httpx.Response(200,json={'id':'retry-report'})
    monkeypatch.setattr(main.bitcoin_service.mailer,'client',httpx.Client(transport=httpx.MockTransport(handler)))
    r=c.post(base+'/playback',json={'action':'finish'})
    assert r.status_code==200 and r.json()['status']=='finished'
    assert r.json()['report_delivery']['status']=='failed' and 'provider-private' not in r.text
    assert c.get(base).json()['report_delivery']['status']=='failed' and len(attempts)==1
    with TestClient(main.app) as other:
        assert other.post(base+'/delivery/retry',json={}).status_code==404
    assert c.post(base+'/delivery/retry',json={'email':'forged@example.test'}).status_code==422
    retry=c.post(base+'/delivery/retry',json={})
    assert retry.json()['report_delivery']['status']=='accepted' and len(attempts)==2
    assert retry.json()['cycles']==r.json()['cycles']


def test_delivery_active_lease_and_stale_lease_recovery(btc_app,monkeypatch):
    c,wall,db=btc_app;sid=start(c);base='/api/bitcoin/sessions/'+sid
    saved=json.loads(db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0])
    saved.update(status='finished',elapsed=300)
    saved['report_delivery'].update(status='sending',lease='another-worker',started_at=wall[0])
    db.execute('UPDATE sessions SET state=? WHERE id=?',(json.dumps(saved),sid));db.commit()
    sent=[]
    monkeypatch.setattr(main.bitcoin_service,'email',lambda request,sid,body:sent.append(body.email))
    assert c.get(base).json()['report_delivery']['status']=='sending' and not sent
    wall[0]+=61
    assert c.get(base).json()['report_delivery']['status']=='accepted' and sent==['reader@example.test']
    assert c.get(base).json()['report_delivery']['status']=='accepted' and len(sent)==1


def test_separate_email_setup_persists_without_starting_or_exposing_address(btc_app):
    c,_,db=btc_app
    assert c.get('/api/bitcoin/contact').json()=={'registered':False}
    assert c.post('/api/bitcoin/contact',json={'email':'reader@example.test','consent':False}).status_code==422
    r=c.post('/api/bitcoin/contact',json={'email':' Reader@Example.test ','consent':True})
    assert r.status_code==200 and r.json()=={'registered':True,'recipient':'r***@example.test'}
    assert 'reader@example.test' not in r.text
    assert next(x for x in c.cookies.jar if x.name==COOKIE).has_nonstandard_attr('HttpOnly')
    assert c.get('/api/bitcoin/contact').json()==r.json()
    assert c.get('/api/bitcoin/records').json()=={'records':[]}
    assert db.execute("SELECT count(*) FROM sessions WHERE json_extract(state,'$.mode')='bitcoin_v1'").fetchone()[0]==0
    created=c.post('/api/bitcoin/sessions',json={'amount':'103807249.23','locale':'en'})
    assert created.status_code==200 and created.json()['report_delivery']=={'status':'scheduled','recipient':'r***@example.test','locale':'en'}
    with TestClient(main.app) as other:
        assert other.get('/api/bitcoin/contact').json()=={'registered':False}
        assert other.post('/api/bitcoin/sessions',json={'amount':100000000}).status_code==400
        assert other.post('/api/bitcoin/contact',json={'email':'other@example.test','consent':True}).status_code==200
    assert c.get('/api/bitcoin/contact').json()==r.json()


def test_settings_change_applies_to_unsent_and_future_reports_not_sent_history(btc_app,monkeypatch):
    c,wall,db=btc_app
    c.post('/api/bitcoin/contact',json={'email':'first@example.test','consent':True})
    sid=c.post('/api/bitcoin/sessions',json={'amount':100000000,'locale':'ko'}).json()['id']
    base='/api/bitcoin/sessions/'+sid
    c.post(base+'/playback',json={'action':'pause'})
    original=db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0]
    wall[0]+=100
    assert c.post('/api/bitcoin/contact',json={'email':'changed@example.test','consent':True}).json()['recipient']=='c***@example.test'
    assert db.execute('SELECT state FROM sessions WHERE id=?',(sid,)).fetchone()[0]==original
    recipients=[]
    def send(email,report):
        assert report['status']=='finished' and report['locale']=='ko'
        recipients.append(email);return 'settings-report'
    monkeypatch.setenv('RESEND_API_KEY','re_test_only');monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    monkeypatch.setattr(main.bitcoin_service.mailer,'send',send)
    finished=c.post(base+'/playback',json={'action':'finish'}).json()
    assert recipients==['changed@example.test'] and finished['report_delivery']['status']=='accepted'
    assert finished['report_delivery']['recipient']=='c***@example.test'
    c.post('/api/bitcoin/contact',json={'email':'future@example.test','consent':True})
    assert c.get(base).json()['report_delivery']==finished['report_delivery'] and len(recipients)==1
    new=c.post('/api/bitcoin/sessions',json={'amount':100000000,'locale':'ko'}).json()
    assert new['report_delivery']['recipient']=='f***@example.test'
    assert all('email' not in r and 'recipient' not in r for r in c.get('/api/bitcoin/records').json()['records'])


def test_retry_after_email_setting_change_uses_new_address(btc_app,monkeypatch):
    c,_,_=btc_app
    c.post('/api/bitcoin/contact',json={'email':'before@example.test','consent':True})
    sid=c.post('/api/bitcoin/sessions',json={'amount':100000000,'locale':'en'}).json()['id']
    base='/api/bitcoin/sessions/'+sid
    assert c.post(base+'/playback',json={'action':'finish'}).json()['report_delivery']['status']=='failed'
    c.post('/api/bitcoin/contact',json={'email':'after@example.test','consent':True})
    recipients=[]
    monkeypatch.setenv('RESEND_API_KEY','re_test_only');monkeypatch.setenv('RESEND_FROM_EMAIL','ERU AI <report@example.test>')
    monkeypatch.setattr(main.bitcoin_service.mailer,'send',lambda email,report:recipients.append(email) or 'retry-new-email')
    retried=c.post(base+'/delivery/retry',json={}).json()
    assert recipients==['after@example.test']
    assert retried['report_delivery']=={'status':'accepted','recipient':'a***@example.test','locale':'en'}


def test_old_full_cycle_record_keeps_original_results_after_bear_deploy(btc_app):
    c,_,_=btc_app;sid=legacy_start(c);base='/api/bitcoin/sessions/'+sid
    g=c.post(base+'/playback',json={'action':'finish'}).json()
    assert g['model_version']=='btc-guard-1'
    assert g['cycles'][0]['start']=='2016-07-01' and g['cycles'][0]['end']=='2020-04-30'
    assert g['cycles'][0]['metrics']['hold']['value']>g['cycles'][0]['metrics']['guard']['value']
    sid_new=start(c)
    new=c.post('/api/bitcoin/sessions/'+sid_new+'/playback',json={'action':'finish'}).json()
    assert new['model_version']=='btc-bear-2' and new['cycles'][0]['start']=='2017-12-16'
    assert new['cycles'][0]['metrics']['hold']['value']<new['cycles'][0]['metrics']['guard']['value']
    assert c.get(base).json()['cycles']==g['cycles']
