"""리스크 가드 결과·회사 소개 발송. 본문과 첨부는 서버에서만 구성한다."""
import base64
import hashlib
import html
import os
from html import escape
from email.utils import parseaddr
from pathlib import Path

import httpx
from fastapi import HTTPException
from reportlab.platypus.doctemplate import LayoutError
from .display_currency import sgd_money, KRW_PER_SGD, REFERENCE_DATE
from .result_report import Labels, selected_scenes, chart_png, review_pdf, FONT

COMPANY_PDF = Path(__file__).resolve().parents[2]/"data/company/eruty-company-introduction.pdf"
REPORT_VERSION="review-2"
BEAR_REPORT_VERSION="bear-review-3"

def report_version(report):
    return BEAR_REPORT_VERSION if report.get("model_version")=="btc-bear-2" else REPORT_VERSION


def money(value):
    return f"{value:,.0f}원"


def report_content(report):
    labels=Labels(report.get("locale","ko"),report.get("model_version")=="btc-bear-2");t=labels.t;fmt=labels.money
    hold=t("Buy & hold","단순 보유");guard=t("Risk Guard","리스크 가드")
    plain=[t("ERU AI Bitcoin results & response review","ERU AI 비트코인 결과와 대응 복기"),t("Starting capital: ","시작 투자금: ")+fmt(report["amount"]),""]
    blocks=[]
    for i,cycle in enumerate(report["cycles"]):
        m=cycle["metrics"];h=m["hold"];g=m["guard"];name=labels.cycle(i)
        scenes=selected_scenes(cycle)
        timeline=[]
        plain.extend([name+" / "+cycle["start"]+" - "+cycle["end"],f"{hold}: {fmt(h['value'])} / MDD {h['mdd_pct']:.1f}%",f"{guard}: {fmt(g['value'])} / MDD {g['mdd_pct']:.1f}%",t("Final difference (guard - hold): ","최종 자산 차이 (가드 - 단순 보유): ")+labels.signed(m["difference"])])
        for number,e in scenes:
            execution=t("No order","주문 없음") if e["kind"]=="wait" else t("Executed ","체결 ")+e["at"]
            detail=t("Trade ","거래금액 ")+fmt(e["trade_value"])+t(" / Fee "," / 수수료 ")+fmt(e["fee"])
            detail+=f" / BTC {e['btc_weight']:.1f}%"
            after=t("Assets at daily close: ","해당 일봉 종가 자산: ")+f"{hold} {fmt(e['hold_value'])} / {guard} {fmt(e['guard_value'])}"
            timeline.append(f'''<tr><td style="padding:16px 0;border-top:1px solid #2b394e"><table role="presentation" width="100%"><tr><td width="35" valign="top" style="color:#edc17d;font-size:13px">{number:02}</td><td>
            <strong style="color:#edf2fa;font-size:13px">{labels.kind(e)} · {e['at']}</strong><p style="margin:7px 0;color:#b7c7de;font-size:12px;line-height:1.8">{escape(labels.action(e))}</p>
            <p style="margin:0;color:#8199ba;font-size:10px;line-height:1.9">{t('Signal ','판단 ')}{e['signal_at']} · {execution}<br>{detail}<br>{after}</p></td></tr></table></td></tr>''')
            plain.extend([f"{number:02} / {labels.kind(e)} / {e['at']}",labels.signal(e),labels.action(e),t("Signal ","판단 ")+e["signal_at"]+" / "+execution,detail,after])
        basis=""
        if cycle.get("preparation"):
            prep=cycle["preparation"];f=m["frozen_allocation"]
            cash_scenes=[e for e in prep["events"] if e["kind"]=="sell"][-2:]
            preparation=t("Cash preparation ","사전 현금 확보 ")+prep["start"]+" - "+prep["end"]
            note=t(f"Inherited cash {f['initial_cash_pct']:.1f}%. Both accounts are independently rebased to {fmt(report['amount'])} at the bear start. Earlier gains are excluded. This is not a fresh 100% Bitcoin investment.",f"기존 현금 {f['initial_cash_pct']:.1f}%를 이어받고 하락 시작일에 각 계좌를 {fmt(report['amount'])}로 환산했어요. 이전 수익은 제외하며, BTC 100%로 새로 투자한 결과가 아니에요.")
            fixed=t(f"Unchanged starting mix: {f['return_pct']:.1f}% / {fmt(f['value'])}. Additional trading is not always better.",f"시작 비중 고정 보유: {f['return_pct']:.1f}% / {fmt(f['value'])}. 추가 매매가 항상 더 유리하지는 않아요.")
            actions=" / ".join(e["signal_at"]+t(" signal → "," 판단 → ")+e["at"]+t(" sell"," 분할 매도") for e in cash_scenes)
            basis=f'<div style="border:1px solid #6d604b;border-radius:12px;padding:15px;margin:0 0 18px"><b style="font-size:12px;color:#edc17d">{preparation}</b><p style="font-size:11px;line-height:1.8;color:#a5b6ce">{note}</p><p style="font-size:10px;line-height:1.8;color:#8199ba">{actions}<br>{fixed}</p></div>'
            plain.extend([preparation,note,actions,fixed])
        image=f'''<img src="cid:riskguard-cycle-{i+1}" width="600" alt="{escape(name+' / '+t('Asset changes: buy & hold and Risk Guard','단순 보유와 리스크 가드의 자산 변화'))}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:12px">''' if cycle.get("history") else f"<p>{t('Asset history is not available.','자산 이력이 없습니다.')}</p>"
        total=len(cycle.get("all_events",cycle.get("events",[])))
        blocks.append(f'''<tr><td style="padding:0 20px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#161f2e" style="background:#161f2e;border:1px solid #26344a;border-radius:22px"><tr><td style="padding:25px 22px 20px">
        <p style="margin:0 0 8px;color:#edc17d;font-size:10px;letter-spacing:1.5px">CYCLE {i+1:02}</p><h2 style="margin:0 0 6px;color:#edf2fa;font-size:21px">{name}</h2><p style="margin:0 0 22px;color:#758daf;font-size:11px">{cycle['start']} - {cycle['end']}</p>{basis}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" style="padding-right:10px"><span style="color:#f17d88;font-size:11px">● {hold}</span><p style="margin:9px 0;color:#edf2fa;font-size:18px;font-weight:bold;overflow-wrap:anywhere">{fmt(h['value'])}</p><span style="font-size:11px;color:#8a9db9">{t('Max drawdown','최대 낙폭')} {h['mdd_pct']:.1f}%</span></td><td width="50%" style="padding-left:13px;border-left:1px solid #2d3b51"><span style="color:#4bcaa6;font-size:11px">● {guard}</span><p style="margin:9px 0;color:#d5eee6;font-size:18px;font-weight:bold;overflow-wrap:anywhere">{fmt(g['value'])}</p><span style="font-size:11px;color:#8a9db9">{t('Max drawdown','최대 낙폭')} {g['mdd_pct']:.1f}%</span></td></tr></table>
        <p style="margin:17px 0 20px;padding-top:14px;border-top:1px solid #2d3b51;color:#8b9fbe;font-size:11px">{t('Final difference (guard - hold)','최종 차이 (가드 - 단순 보유)')} <b style="color:{'#4bcaa6' if m['difference']>=0 else '#f17d88'}">{labels.signed(m['difference'])}</b></p>{image}
        <h3 style="font-size:14px;color:#edc17d;margin:24px 0 8px">{t('When Risk Guard responded','리스크 가드는 언제 움직였을까요?')}</h3><p style="margin:0 0 12px;font-size:11px;color:#7c93b4;line-height:1.8">{t(f'{len(scenes)} representative scenes from {len(cycle.get("events",[]))} highlights. Full review and all {total} responses are in the attached report.',f'주요 {len(cycle.get("events",[]))}장면 중 대표 {len(scenes)}장면입니다. 전체 복기와 {total}개 대응 내역은 첨부 보고서에 담았어요.')}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{''.join(timeline)}</table></td></tr></table></td></tr>''')
        plain.append("")
    explanation=t(f"Fixed SGD display rate: {REFERENCE_DATE}, S$1 = KRW {KRW_PER_SGD:.2f}. Both accounts start with 100% Bitcoin, independently for each cycle. Trading fee 0.05% per side; decisions use completed daily candles and trades execute at the next daily open. Historical FX movements, cash interest and slippage are excluded. Lower drawdown does not guarantee higher final assets. Scene-to-scene changes include market movements and intervening trades, not the isolated contribution of one action. Past results do not predict future performance.",f"표시 환산율은 {REFERENCE_DATE} 기준 S$1 = {KRW_PER_SGD:.2f}원으로 고정합니다. 두 계좌는 각 사이클에서 같은 자금·비트코인 100%로 독립 시작해요. 편도 수수료 0.05%, 확정 일봉 판단 후 다음 일봉 시가 체결 기준이며 과거 환율 변동·현금 이자·슬리피지는 미반영해요. 낙폭 축소가 더 높은 최종 자산을 뜻하지는 않아요. 장면 사이의 변화에는 시장 가격과 중간 대응이 함께 반영되며 특정 대응 하나의 확정 기여액이 아니에요. 과거 결과는 미래 성과를 예측하지 않아요.")
    if labels.bear:
        explanation=t(f"Bear periods were selected retrospectively, one largest closing-price peak-to-trough decline from each original cycle. Preparation shows the original continuous-run strategy. At each bear start, accounts are independently rebased to equal capital with inherited cash and no new trade. Earlier gains are excluded; fees include only bear-period trades. The unchanged-mix benchmark separates existing cash from subsequent trading. Fixed SGD rate dated {REFERENCE_DATE}: S$1 = KRW {KRW_PER_SGD:.2f}. Trades use the next daily open after completed-candle signals. Historical FX movements, cash interest and slippage are excluded. Full-cycle outcomes are separate and may favor buy-and-hold. These dates and future returns were not predicted.",f"각 원래 사이클의 가장 큰 종가 고점·저점 하락 구간을 사후 선정했습니다. 사전 현금 확보 과정은 원래 연속 운용 기록입니다. 하락 시작일에 기존 현금 비중을 이어받은 각 계좌를 동일 금액으로 환산하며 새 매매는 하지 않습니다. 이전 수익은 제외하고 하락 구간 매매 수수료만 반영합니다. 비중 고정 계좌로 기존 현금과 추가 매매 효과를 구분합니다. {REFERENCE_DATE} 기준 S$1 = {KRW_PER_SGD:.2f}원으로 고정하며, 완료 일봉 판단 후 다음 일봉 시가에 체결합니다. 과거 환율·현금 이자·슬리피지는 미반영합니다. 전체 사이클 결과는 별개이며 단순 보유가 유리할 수 있습니다. 하락 날짜와 미래 수익을 예측한 결과가 아닙니다.")
    company=t("ERUTY connects investment analysis with system development. We design systems for analysis, monitoring and service integration using market data and investment workflows.","ERUTY는 투자 분석과 시스템 개발을 연결합니다. 시장 데이터와 투자 흐름을 바탕으로 분석·모니터링·서비스 연동을 위한 맞춤형 시스템을 설계합니다.")
    title=t("Your capital.<br>The full journey.","내 자산이 지나온<br>시장의 흐름.")
    body=f'''<!doctype html><html lang="{labels.locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head><body bgcolor="#080d17" style="margin:0;padding:0;background:#080d17;color:#edf2fa;font-family:Arial,'Apple SD Gothic Neo',sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">{t('Your asset charts, Risk Guard responses and detailed review report.','자산 변화 그래프와 리스크 가드 대응, 상세 복기 보고서가 도착했어요.')}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#080d17"><tr><td align="center"><table role="presentation" width="680" cellpadding="0" cellspacing="0" bgcolor="#0c121e" style="width:100%;max-width:680px;background:#0c121e">
    <tr><td style="padding:34px 30px 28px"><p style="margin:0 0 30px;font-size:13px;font-weight:bold;color:#edc17d;letter-spacing:1px">ERU AI / RISK GUARD</p><p style="margin:0 0 12px;color:#7188a8;font-size:10px;letter-spacing:2px">SIMULATION REPORT</p><h1 style="font-size:30px;line-height:1.35;margin:0 0 25px;letter-spacing:-.7px">{title}</h1>
    <p style="font-size:11px;color:#8b9fbe;margin:0 0 8px">{t('STARTING CAPITAL','시작 투자금')}</p><p style="font-size:30px;font-weight:bold;color:#edf2fa;margin:0">{fmt(report['amount'])}</p><p style="color:#7188a8;font-size:12px;line-height:1.8;margin:15px 0 0">{(t('Cash preparation and three representative Bitcoin declines.','현금 확보 과정과 세 번의 대표 비트코인 하락장을 비교했어요.') if labels.bear else t('Three independent cycles. Buy & hold and Risk Guard, side by side.','독립된 세 사이클에서 단순 보유와 리스크 가드를 함께 비교했어요.'))}</p></td></tr>
    <tr><td style="padding:0 20px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#272b31;border:1px solid #6d604b;border-radius:16px"><tr><td style="padding:18px 21px"><b style="color:#edc17d;font-size:13px">{t('Two PDFs, ready to keep','PDF 두 개로 보관하세요')}</b><p style="margin:9px 0 0;color:#b0bdd1;font-size:11px;line-height:1.9">{t('1. Detailed results & full response review<br>2. ERUTY company introduction (original Korean edition)','1. 상세 결과와 전체 대응 복기 보고서<br>2. ERUTY 회사 소개 자료 (원본 한국어)')}</p></td></tr></table></td></tr>
    {''.join(blocks)}<tr><td style="padding:8px 28px 25px"><h2 style="font-size:16px;color:#edc17d;margin:0 0 12px">{t('Reading your results','결과를 읽는 기준')}</h2><p style="font-size:11px;line-height:1.9;color:#7e94b4;margin:0">{explanation}</p></td></tr>
    <tr><td style="padding:0 20px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#161f2e" style="background:#161f2e;border-radius:20px"><tr><td style="padding:24px"><h2 style="font-size:18px;margin:0 0 12px;color:#edf2fa">{t('About ERUTY','회사 소개 / ERUTY')}</h2><p style="font-size:12px;line-height:1.9;color:#9bafcd;margin:0 0 19px">{company}</p><a href="https://www.eruty.co.kr" style="display:inline-block;background:#edc17d;color:#182233;text-decoration:none;font-size:12px;font-weight:bold;padding:13px 19px;border-radius:12px">{t('Meet ERUTY','ERUTY 알아보기')} ↗</a><p style="font-size:10px;line-height:1.8;color:#6e87aa;margin:16px 0 0">{t('The brochure covers a different portfolio from this Bitcoin-only comparison.','회사 소개 자료의 포트폴리오 성과와 이 비트코인 단독 결과는 계산 대상이 달라요.')}</p></td></tr></table></td></tr>
    <tr><td style="padding:0 28px 32px;color:#566d91;font-size:10px;line-height:1.9">{t('Sent once at your request. No marketing subscription.<br>This is a simulation, not a real deposit or exchange order.','요청하신 보고서와 회사 소개를 1회 발송했습니다. 마케팅 구독은 하지 않아요.<br>실제 입금이나 거래소 주문 없이 계산한 모의 결과입니다.')}<br>© ERUTY · <a href="mailto:yusung@eruty.co.kr" style="color:#8da2c1">yusung@eruty.co.kr</a></td></tr></table></td></tr></table></body></html>'''
    plain.extend([explanation,"",t("About ERUTY","회사 소개 / ERUTY"),company,"https://www.eruty.co.kr",t("Attachments: detailed results & full review PDF; company introduction PDF.","첨부: 상세 결과·전체 복기 PDF, 회사 소개 PDF.")])
    return body,"\n".join(plain)


class ResultMailer:
    def __init__(self,client=None):
        self.client=client or httpx.Client(timeout=25,follow_redirects=False)

    @property
    def configured(self):
        sender=os.environ.get("RESEND_FROM_EMAIL","")
        name,address=parseaddr(sender)
        return bool(os.environ.get("RESEND_API_KEY","").startswith("re_") and "@" in address
                    and not any(c in sender for c in "\r\n") and COMPANY_PDF.is_file() and FONT.is_file())

    def send(self,recipient,report):
        if not self.configured:
            raise HTTPException(503,"결과 메일 발송을 준비하고 있어요. 결과와 복기는 화면에서 계속 확인할 수 있어요.")
        if report.get("status")!="finished" or not all(c.get("completed") for c in report["cycles"]):
            raise HTTPException(400,"비교를 마친 후 결과 메일을 받을 수 있어요.")
        try:
            charts={i:chart_png(c,report.get("locale","ko")) for i,c in enumerate(report["cycles"])}
            full_review=review_pdf(report,charts)
            body,text=report_content(report)
        except (OSError,ValueError,KeyError,LayoutError):
            raise HTTPException(503,"상세 보고서를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.") from None
        attachments=[{"filename":"ERUTY_Company_Introduction.pdf","content":base64.b64encode(COMPANY_PDF.read_bytes()).decode()},
            {"filename":"ERU_RiskGuard_Results_Review.pdf","content":base64.b64encode(full_review).decode()}]
        attachments.extend({"filename":f"riskguard-cycle-{i+1}.png","content_type":"image/png","content_id":f"riskguard-cycle-{i+1}","content":base64.b64encode(png).decode()} for i,png in charts.items())
        identity=hashlib.sha256(recipient.encode()).hexdigest()
        payload={"from":os.environ["RESEND_FROM_EMAIL"],"to":[recipient],
            "subject":"[ERU AI] Your Bitcoin comparison & full review" if report.get("locale")=="en" else "[ERU AI] 비트코인 자산 변화와 대응 복기","html":body,"text":text,
            "attachments":attachments}
        try:
            response=self.client.post("https://api.resend.com/emails",json=payload,headers={
                "Authorization":"Bearer "+os.environ["RESEND_API_KEY"],"Content-Type":"application/json",
                "Idempotency-Key":"bitcoin-result/"+report["id"]+"/"+report_version(report)+"/"+identity})
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
