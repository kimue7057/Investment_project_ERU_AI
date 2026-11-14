"""리스크 가드 결과·회사 소개 발송. 본문과 첨부는 서버에서만 구성한다."""
import base64
import hashlib
import html
import os
from email.utils import parseaddr
from pathlib import Path

import httpx
from fastapi import HTTPException

COMPANY_PDF = Path(__file__).resolve().parents[2]/"data/company/eruty-company-introduction.pdf"


def money(value):
    return f"{value:,.0f}원"


def report_content(report):
    rows=[]
    plain=["ERU AI 비트코인 리스크 가드 비교 결과", "입력 자금: "+money(report["amount"]),""]
    for cycle in report["cycles"]:
        m=cycle["metrics"];h=m["hold"];g=m["guard"]
        rows.append(f'''<tr><td style="padding:18px 8px;border-bottom:1px solid #dce3ee"><b>{html.escape(cycle['name'])}</b><br><small>{cycle['start']} ~ {cycle['end']}</small></td>
        <td style="padding:18px 8px;border-bottom:1px solid #dce3ee">{money(h['value'])}<br><small>최대 낙폭 {h['mdd_pct']:.1f}%</small></td>
        <td style="padding:18px 8px;border-bottom:1px solid #dce3ee">{money(g['value'])}<br><small>최대 낙폭 {g['mdd_pct']:.1f}%</small></td></tr>''')
        plain.extend([cycle["name"]+f" ({cycle['start']} ~ {cycle['end']})",
            f"단순 보유 종료 자산 {money(h['value'])} / 최대 낙폭 {h['mdd_pct']:.1f}%",
            f"가드 적용 종료 자산 {money(g['value'])} / 최대 낙폭 {g['mdd_pct']:.1f}%",
            f"종료 자산 차이(가드 - 단순 보유): {money(m['difference'])}",""])
    explanation=("각 사이클은 같은 자금으로 비트코인 100%에서 독립적으로 시작합니다. "
        "공식 BTC-USD 일봉의 가격 변동률을 원화 자본에 적용하고, 편도 수수료 0.05%를 반영했습니다. "
        "완료된 일봉으로 판단한 뒤 다음 일봉 시가에 체결합니다. 환율 변동·현금 이자·슬리피지는 포함하지 않습니다. "
        "최대 낙폭은 각 계좌 자체 고점 대비 일별 평가액의 하락률입니다. 낙폭 축소와 최종 수익 증가는 같은 의미가 아니며, "
        "첨부 소개 자료의 포트폴리오 성과와 이 BTC 단독 결과는 계산 대상이 다릅니다. 과거 모의 결과가 미래 성과를 보장하지 않습니다.")
    company=("ERUTY는 투자 분석과 시스템 개발을 연결합니다. 시장 데이터와 고객의 투자 흐름을 바탕으로 "
        "분석·모니터링·서비스 연동을 위한 맞춤형 시스템을 설계합니다. 이번 비교는 실제 거래소 주문 없이 실행한 모의 시뮬레이션입니다.")
    body=f'''<!doctype html><html lang="ko"><body style="margin:0;background:#f1f4f9;font-family:Arial,sans-serif;color:#14203b">
    <div style="max-width:680px;margin:auto;background:white"><div style="padding:32px;background:#09142f;color:white">
    <b style="color:#f4b04c;letter-spacing:2px">ERU AI / RISK GUARD</b><h1 style="font-size:25px;line-height:1.5;margin:20px 0 10px">내 투자금으로 지나온 세 사이클</h1>
    <p>입력 자금 {money(report['amount'])} · 비트코인 단독 비교</p></div><div style="padding:28px">
    <table style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.8"><thead><tr><th align="left">사이클</th><th align="left">단순 보유</th><th align="left">리스크 가드</th></tr></thead><tbody>{''.join(rows)}</tbody></table>
    <h2 style="font-size:18px;margin-top:28px">결과를 읽는 기준</h2><p style="font-size:12px;line-height:1.9;color:#657089">{explanation}</p>
    <div style="background:#f1f4f9;padding:22px;margin-top:28px;border-radius:8px"><b>회사 소개 / ERUTY</b><p style="font-size:13px;line-height:1.9">{company}</p>
    <a href="https://www.eruty.co.kr" style="color:#3d5cab">회사 홈페이지</a> · <a href="mailto:yusung@eruty.co.kr" style="color:#3d5cab">도입 문의</a>
    <p style="font-size:11px;color:#657089">첨부한 회사 소개 자료도 함께 확인해 주세요.</p></div>
    <p style="font-size:11px;color:#8a95aa;line-height:1.8;margin-top:25px">요청하신 비교 결과와 회사 소개를 1회 발송했습니다. 별도 뉴스레터 구독이나 마케팅 수신 등록은 하지 않습니다.</p>
    </div></div></body></html>'''
    plain.extend([explanation,"", "회사 소개 / ERUTY",company,"https://www.eruty.co.kr", "도입 문의: yusung@eruty.co.kr"])
    return body,"\n".join(plain)


class ResultMailer:
    def __init__(self,client=None):
        self.client=client or httpx.Client(timeout=25,follow_redirects=False)

    @property
    def configured(self):
        sender=os.environ.get("RESEND_FROM_EMAIL","")
        name,address=parseaddr(sender)
        return bool(os.environ.get("RESEND_API_KEY","").startswith("re_") and "@" in address
                    and not any(c in sender for c in "\r\n") and COMPANY_PDF.is_file())

    def send(self,recipient,report):
        if not self.configured:
            raise HTTPException(503,"결과 메일 발송을 준비하고 있어요. 결과와 복기는 화면에서 계속 확인할 수 있어요.")
        body,text=report_content(report)
        identity=hashlib.sha256(recipient.encode()).hexdigest()
        payload={"from":os.environ["RESEND_FROM_EMAIL"],"to":[recipient],
            "subject":"[ERU AI] 내 비트코인 비교 결과와 회사 소개","html":body,"text":text,
            "attachments":[{"filename":"ERUTY_Company_Introduction.pdf", "content":base64.b64encode(COMPANY_PDF.read_bytes()).decode()}]}
        try:
            response=self.client.post("https://api.resend.com/emails",json=payload,headers={
                "Authorization":"Bearer "+os.environ["RESEND_API_KEY"],"Content-Type":"application/json",
                "Idempotency-Key":"bitcoin-result/"+report["id"]+"/"+identity})
        except httpx.HTTPError:
            raise HTTPException(503,"메일 발송 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.") from None
        if response.status_code==429:
            raise HTTPException(429,"메일 발송 요청이 많아요. 잠시 후 다시 시도해 주세요.")
        if not response.is_success:
            raise HTTPException(503,"메일을 발송하지 못했어요. 발신 주소와 메일 연결 상태를 확인해야 해요.")
        try:
            message_id=response.json()["id"]
            if not isinstance(message_id,str) or len(message_id)>150:
                raise ValueError()
        except (KeyError,ValueError,TypeError):
            raise HTTPException(503,"메일 접수 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.") from None
        return message_id
