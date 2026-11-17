"""대표 하락장 정규화·장부·미래 공개 경계 회귀 검증."""
import copy
import json
from dataclasses import replace
from decimal import Decimal as D

import pytest

from backend.app.bitcoin_engine import BitcoinEngine,FEE
from backend.app.bitcoin_bear_engine import BitcoinBearEngine,SCENARIOS
from backend.app.result_mail import report_content,report_version,BEAR_REPORT_VERSION


@pytest.fixture(scope="module")
def engine():return BitcoinBearEngine()


def state(elapsed=300,status="finished"):
    return dict(id="bear-test",amount="100000000",elapsed=elapsed,speed=4,status=status,created_at=1,model_version="btc-bear-2")


def test_representative_periods_and_returns_match_verified_analysis(engine):
    expected=[(-83.8015349610509,-55.108029921663864),(-76.67059828725817,-28.986505493881385),(-49.65446224421422,-17.41930684867622)]
    report=engine.public(state())
    for i,c in enumerate(report['cycles']):
        assert (c['start'],c['end'])==SCENARIOS[i][3:]
        assert c['metrics']['hold']['return_pct']==pytest.approx(expected[i][0])
        assert c['metrics']['guard']['return_pct']==pytest.approx(expected[i][1])
        assert c['history'][0]['hold']==c['history'][0]['guard']==100000000
        assert c['preparation']['start']==SCENARIOS[i][2]
        assert c['preparation']['end']==c['start']
        assert c['metrics']['hold']['value']<c['metrics']['guard']['value']
        assert c['full_cycle_context']['hold_value']>c['full_cycle_context']['guard_value']


def test_completed_summary_reconciles_drawdown_pairs_and_all_decision_counts(engine):
    from backend.app.bitcoin_bear_engine import maximum_drop
    report=engine.public(state())
    for i,c in enumerate(report['cycles']):
        rows=engine.runs[i]['bear']['history']
        for key in ('hold','guard'):
            dd,peak,trough=maximum_drop(rows,key)
            summary=c['summary'][key]
            assert (summary['peak_date'],summary['trough_date'])==(peak,trough)
            assert summary['peak_value']==float((next(r[key] for r in rows if r['date']==peak)*D('100000000')).quantize(D('.01')))
            assert summary['trough_value']==float((next(r[key] for r in rows if r['date']==trough)*D('100000000')).quantize(D('.01')))
            assert summary['max_drawdown_pct']==pytest.approx(float(dd*100))
            assert summary['trough_value']*summary['recovery_multiple']==pytest.approx(summary['peak_value'],abs=.05)
            assert summary['end_value']==c['metrics'][key]['value']
        counts=c['summary']['counts']
        assert counts['decisions']==len(c['all_events'])
        for kind in ('sell','buy','wait'):
            assert counts[kind]==sum(e['kind']==kind for e in c['all_events'])
        assert counts['trades']==counts['sell']+counts['buy']


def test_recovery_uses_same_market_trough_and_verified_next_peak_without_new_trades(engine):
    from decimal import localcontext
    before=copy.deepcopy(engine.runs)
    report=engine.public(state())
    prices={c.day:c.close for c in engine.base.candles}
    assert engine.base.candles[-1].day=='2026-05-31'
    for i,c in enumerate(report['cycles']):
        r=c['recovery']
        end=SCENARIOS[i+1][3] if i<2 else engine.base.candles[-1].day
        assert (r['start'],r['end'])==(c['end'],end)
        assert r['basis']==('next_cycle_peak' if i<2 else 'last_confirmed_close')
        with localcontext() as ctx:
            ctx.prec=34
            multiple=prices[end]/prices[c['end']]
            assert r['market_return_pct']==float((multiple-1)*100)
            for key in ('hold','guard'):
                assert r[key]['starting_value']==c['metrics'][key]['value']
                start=D(str(r[key]['starting_value']))
                assert r[key]['end_value']==float((start*multiple).quantize(D('.01')))
                assert r[key]['profit']==pytest.approx(r[key]['end_value']-r[key]['starting_value'],abs=.0001)
            candles=[candle for candle in engine.base.candles if r['start']<=candle.day<=r['end']]
            assert len(r['history'])==len(candles)
            assert r['history'][0]['position']==0 and r['history'][-1]['position']==100
            for point,candle in zip(r['history'],candles):
                assert set(point)=={'date','position','hold','guard'}
                assert point['date']==candle.day
                for key in ('hold','guard'):
                    expected=(D(str(r[key]['starting_value']))*candle.close/prices[r['start']]).quantize(D('.01'))
                    assert point[key]==float(expected)
            for key in ('hold','guard'):
                assert r['history'][0][key]==r[key]['starting_value']
                assert r['history'][-1][key]==r[key]['end_value']
        assert r['ending_gap']==pytest.approx(r['guard']['end_value']-r['hold']['end_value'],abs=.0001)
        assert r['gap_growth']==pytest.approx(r['ending_gap']-r['starting_gap'],abs=.0001)
    assert engine.runs==before


def test_unfinished_game_does_not_publish_completed_summary_or_recovery(engine):
    for elapsed in (0,50,100,250,299):
        for cycle in engine.public(state(elapsed,'running'))['cycles']:
            assert 'summary' not in cycle and 'recovery' not in cycle


def test_existing_ledger_fills_are_preserved_and_scaled_without_new_trades(engine):
    for i,run in enumerate(engine.runs):
        baseline=run['baseline'];bear=run['bear'];original=engine.base.runs[i]
        assert bear['history'][0]['fees']==0
        assert bear['history'][0]['hold']==bear['history'][0]['guard']==1
        assert abs(bear['history'][0]['cash']+bear['history'][0]['exposure']-1)<D('1e-26')
        for e in bear['events']:
            source=next(x for x in original['events'] if x['id']==e['id'])
            assert e['signal_at']==source['signal_at'] and e['at']==source['at']
            assert e['at']>SCENARIOS[i][3]
            assert abs(e['fee']*baseline['guard']-source['fee'])<D('1e-25')
            assert abs(e['value_before']-e['value_after']-e['fee'])<D('1e-25')
            if e['kind']!='wait':assert abs(e['fee']-e['trade_value']*FEE)<D('1e-26')
        assert abs(bear['history'][-1]['fees']-sum(e['fee'] for e in bear['events']))<D('1e-25')


@pytest.mark.parametrize('elapsed',[0,15,29.99,30,50,99,100,129,130,250])
def test_each_phase_reveals_only_known_rows_and_no_future_baseline(engine,elapsed):
    public=engine.public(state(elapsed,'running'))
    active=public['current_cycle'];c=public['cycles'][active]
    assert all(r['date']<=c['date'] for r in c['history'])
    assert all(0<=r['btc_weight']<=100 and 0<=r['cash']<=r['guard']+.01 for r in c['history'])
    assert all(e['at']<=c['date'] for e in c['events'])
    for phase in (c,c.get('preparation')):
        if not phase:continue
        source=engine.runs[active][phase['phase']]['events']
        expected=[e['id'] for e in source if e['at']<=phase['date']]
        assert [e['id'] for e in phase['response_log']]==expected
        assert all(e['at']<=phase['date'] and e['signal_at']<=e['at'] for e in phase['response_log'])
        assert {e['at'] for e in phase['response_log']}<={r['date'] for r in phase['history']}
    if c['phase']=='preparation':
        assert 'preparation' not in c and 'frozen_allocation' not in c['metrics']
    else:
        assert c['preparation']['date']<=c['date']
        assert not c['preparation'].get('all_events')
    for future in public['cycles'][active+1:]:
        assert not future['history'] and not future['events'] and 'metrics' not in future and 'preparation' not in future
        assert not future.get('response_log')
    text=json.dumps(public)
    for forbidden in ('all_events','full_cycle_context','quantity_internal','visitor_hash','upper','lower','https://'):
        assert forbidden not in text


def test_future_market_changes_do_not_affect_visible_preparation(engine):
    cutoff='2017-01-01'
    changed=[replace(c,opened=c.opened*3,high=c.high*3,low=c.low*3,close=c.close*3) if c.day>=cutoff else c for c in engine.base.candles]
    other=BitcoinBearEngine(BitcoinEngine(changed))
    assert engine.public(state(4,'running'))==other.public(state(4,'running'))


def test_live_activity_keeps_all_known_responses_and_preparation_history(engine):
    public=engine.public(state(50,'paused'))
    current=public['cycles'][0]
    assert current['phase']=='bear'
    prep=current['preparation']
    assert len(prep['response_log'])==len(engine.runs[0]['preparation']['events'])>len(prep['events'])
    assert not prep.get('all_events')
    allowed={'id','kind','at','signal_at','stage','position','title','signal','action','after',
             'btc_weight','fee','trade_value','cash_before','cash_after','value_before','value_after',
             'hold_value','guard_value','phase'}
    for phase in (prep,current):
        for e in phase['response_log']:
            assert set(e)<=allowed
    final=engine.public(state())
    for c in final['cycles']:
        for phase in (c,c['preparation']):
            assert phase['response_log']==phase['all_events']


def test_frozen_allocation_baseline_and_sampling_are_reconciled(engine):
    public=engine.public(state())
    for i,c in enumerate(public['cycles']):
        f=c['metrics']['frozen_allocation'];row=engine.runs[i]['bear']['history'][0]
        expected=(row['cash']+row['exposure']*(1+D(str(c['metrics']['hold']['return_pct']))/100))*100000000
        assert f['value']==pytest.approx(float(expected),abs=.01)
        for phase in (c,c['preparation']):
            assert len(phase['history'])<=300 and len(phase['events'])<=20
            dates={r['date'] for r in phase['history']}
            for key in ('hold','guard'):
                assert phase['metrics'][key]['mdd_peak_date'] in dates
                assert phase['metrics'][key]['mdd_trough_date'] in dates
            assert [e['at'] for e in phase['events']]==sorted(e['at'] for e in phase['events'])
    assert public['cycles'][1]['metrics']['frozen_allocation']['value']>public['cycles'][1]['metrics']['guard']['value']


@pytest.mark.parametrize('locale',['ko','en'])
def test_bear_email_uses_selected_periods_and_cash_preparation(engine,locale):
    report={**engine.public(state()),'locale':locale};original=copy.deepcopy(report)
    html,text=report_content(report)
    assert report_version(report)==BEAR_REPORT_VERSION
    for _,_,prep,start,end in SCENARIOS:
        assert prep in html and start in html and end in html
    assert ('independently rebased' if locale=='en' else '각 계좌를') in html
    assert ('Unchanged starting mix' if locale=='en' else '시작 비중 고정') in html
    assert ('selected retrospectively' if locale=='en' else '사후 선정') in text
    assert report==original and len(html.encode())<80000


def test_bear_pdf_includes_six_phase_charts_and_preserves_snapshot(engine):
    from backend.app.result_report import chart_png,review_pdf
    report={**engine.public(state()),'locale':'ko'}
    original=copy.deepcopy(report)
    charts={i:chart_png(c,'ko') for i,c in enumerate(report['cycles'])}
    pdf=review_pdf(report,charts)
    assert pdf.startswith(b'%PDF-') and pdf.rstrip().endswith(b'%%EOF')
    assert pdf.count(b'/Subtype /Image')>=6
    assert report==original
