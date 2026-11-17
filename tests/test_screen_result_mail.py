"""현재 화면과 메일의 수치·차트 경계 및 복기 제외 검증."""
import copy

import pytest

from backend.app.bitcoin_bear_engine import BitcoinBearEngine
from backend.app.result_mail import report_content,report_version
from backend.app.screen_result_mail import result_rows,screen_charts,SCREEN_REPORT_VERSION
from backend.app.result_report import Labels


@pytest.fixture(scope='module')
def report():
    data=BitcoinBearEngine().public(dict(id='screen-test',amount='100000000',elapsed=300,speed=4,status='finished',created_at=1))
    data.update(report_mode='fixed_result',locale='ko')
    return data


@pytest.mark.parametrize('locale',['ko','en'])
def test_email_has_exact_result_values_and_no_response_ledger(report,locale):
    data=copy.deepcopy(report);data['locale']=locale
    for c in data['cycles']:
        for e in c['all_events']:e['action']='PRIVATE_REVIEW_NOT_FOR_EMAIL'
    before=copy.deepcopy(data)
    html,text=report_content(data)
    assert report_version(data)==SCREEN_REPORT_VERSION
    assert html.count('<img src="cid:screen-')==6
    assert 'PRIVATE_REVIEW_NOT_FOR_EMAIL' not in html+text
    assert 'Results_Review.pdf' not in html+text and 'full review' not in html+text and '상세 복기' not in html+text
    labels=Labels(locale)
    for c in data['cycles']:
        for stage in ('bear','recovery'):
            for title,a,b in result_rows(c,data['amount'],labels,stage):
                assert title in text and a in text and b in text
        rows=result_rows(c,data['amount'],labels,'bear')
        assert rows[-1][2]==str(c['summary']['counts']['trades'])+labels.t(' times','회')
    assert data==before


def test_screen_charts_do_not_read_or_draw_response_markers(report,monkeypatch):
    from backend.app import result_report
    def unexpected_markers(*args):raise AssertionError('화면 메일에는 대응 점을 그리지 않는다')
    monkeypatch.setattr(result_report,'selected_scenes',unexpected_markers)
    before=copy.deepcopy(report)
    charts=screen_charts(report)
    assert len(charts)==6 and all(png.startswith(b'\x89PNG\r\n') for png in charts.values())
    assert report==before
