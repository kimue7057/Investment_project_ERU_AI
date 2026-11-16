import base64
import copy
import io
from decimal import Decimal

import httpx
import pytest
from fastapi import HTTPException
from PIL import Image

from backend.app.bitcoin_engine import BitcoinEngine
from backend.app.result_report import chart_png, selected_scenes, following_scene, review_pdf
from backend.app.result_mail import report_content, ResultMailer, REPORT_VERSION


@pytest.fixture(scope="module")
def finished_report():
    return BitcoinEngine().public(dict(id="report-test",amount="100000000",elapsed=300,speed=4,status="finished",created_at=1794794400))


def test_real_asset_charts_and_pdf_preserve_the_snapshot(finished_report):
    original=copy.deepcopy(finished_report)
    charts={i:chart_png(c,"ko") for i,c in enumerate(finished_report["cycles"])}
    for png in charts.values():
        image=Image.open(io.BytesIO(png));image.verify()
        assert image.format=="PNG" and image.size==(1440,650)
    pdf=review_pdf(finished_report,charts)
    assert pdf.startswith(b"%PDF-") and pdf.rstrip().endswith(b"%%EOF")
    assert pdf.count(b"/Type /Page")>10
    assert finished_report==original
    with pytest.raises(ValueError):chart_png({"history":[]})


def test_scenes_use_time_and_response_type_not_profit(finished_report):
    for cycle in finished_report["cycles"]:
        picks=selected_scenes(cycle)
        assert 1<=len(picks)<=4
        assert [n for n,_ in picks]==sorted(n for n,_ in picks)
        assert picks[-1][1]==cycle["events"][-1]
        assert {e["kind"] for _,e in picks}=={e["kind"] for e in cycle["events"]}
        until,value,change=following_scene(cycle,0)
        assert until==cycle["events"][1]["at"]
        assert value==cycle["events"][1]["guard_value"]
        assert change==Decimal(str(value))-Decimal(str(cycle["events"][0]["guard_value"]))


@pytest.mark.parametrize("locale",["ko","en"])
def test_email_contains_chart_references_and_real_response_details(finished_report,locale):
    report={**finished_report,"locale":locale}
    body,text=report_content(report)
    assert len(body.encode())<80000
    assert body.count('src="cid:riskguard-cycle-')==3
    assert 'background:#0c121e' in body
    assert '<script' not in body and 'src="http' not in body
    for c in report["cycles"]:
        for _,e in selected_scenes(c):
            assert e["signal_at"] in body and e["at"] in body
    assert ("full response review" if locale=="en" else "전체 대응 복기") in body
    assert ("S$" if locale=="en" else "원") in text


def test_send_uses_private_inline_images_and_two_pdf_attachments(finished_report,monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY","re_test_only")
    monkeypatch.setenv("RESEND_FROM_EMAIL","ERU AI <noreply@example.test>")
    sent=[]
    def handler(request):
        import json
        payload=json.loads(request.content);sent.append(payload)
        assert REPORT_VERSION in request.headers["Idempotency-Key"]
        assert payload["to"]==["reader@example.test"]
        attachments=payload["attachments"]
        assert len(attachments)==5
        for a in attachments:
            data=base64.b64decode(a["content"],validate=True)
            if a["filename"].endswith('.pdf'):assert data.startswith(b'%PDF-')
            else:
                assert a["content_type"]=="image/png"
                assert 'cid:'+a["content_id"] in payload["html"]
                Image.open(io.BytesIO(data)).verify()
        return httpx.Response(200,json={"id":"test-rich-report"})
    mailer=ResultMailer(httpx.Client(transport=httpx.MockTransport(handler)))
    assert mailer.send("reader@example.test",finished_report)=="test-rich-report"
    with pytest.raises(HTTPException) as error:mailer.send("reader@example.test",{**finished_report,"status":"running"})
    assert error.value.status_code==400 and len(sent)==1
