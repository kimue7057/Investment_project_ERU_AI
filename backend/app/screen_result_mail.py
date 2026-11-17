"""완료 결과형 화면과 같은 하락장·상승장 차트 및 표만 메일로 구성한다."""
from html import escape

from .result_report import Labels, chart_png

SCREEN_REPORT_VERSION="screen-results-1"


def result_rows(c,amount,labels,stage):
    t=labels.t;fmt=labels.money
    pct=lambda n:('+' if n>0 else '')+f'{n:.1f}%'
    if stage=='bear':
        s=c['summary'];h=s['hold'];g=s['guard']
        return [
            (t('Starting capital','시작 금액'),fmt(amount),fmt(amount)),
            (t('Peak date','고점 발생일'),h['peak_date'],g['peak_date']),
            (t('Trough date','저점 발생일'),h['trough_date'],g['trough_date']),
            (t('Balance at trough','저점에 남은 금액'),fmt(h['trough_value']),fmt(g['trough_value'])),
            (t('Maximum drawdown','최대 낙폭'),pct(h['max_drawdown_pct']),pct(g['max_drawdown_pct'])),
            (t('Multiple to recover peak','고점 회복 필요 배수'),f"{h['recovery_multiple']:.2f}×",f"{g['recovery_multiple']:.2f}×"),
            (t('Period-end balance','구간 끝 금액'),fmt(h['end_value']),fmt(g['end_value'])),
            (t('Period return','구간 수익률'),pct(c['metrics']['hold']['return_pct']),pct(c['metrics']['guard']['return_pct'])),
            (t('Risk Guard activations','리스크 가드 총 발동 횟수'),'—',str(s['counts']['trades'])+t(' times','회')),
        ]
    r=c['recovery'];h=r['hold'];g=r['guard']
    return [
        (t('Capital remaining at market trough','시장 저점에 남은 출발 자금'),fmt(h['starting_value']),fmt(g['starting_value'])),
        (t('Same BTC market return','동일한 BTC 구간 수익률'),pct(r['market_return_pct']),pct(r['market_return_pct'])),
        (t('Gain during this period','상승 구간 손익'),fmt(h['profit']),fmt(g['profit'])),
        (t('Balance after the period','상승 구간 끝 금액'),fmt(h['end_value']),fmt(g['end_value'])),
        (t('Return vs original capital','최초 고정 금액 대비 수익률'),pct(h['total_return_pct']),pct(g['total_return_pct'])),
    ]


def screen_charts(report):
    charts={}
    for i,c in enumerate(report['cycles']):
        for stage,data in (('bear',c),('recovery',c['recovery'])):
            charts[f'screen-{stage}-{i+1}']=chart_png(data,report.get('locale','ko'),screen=True,reference=report['amount'])
    return charts


def screen_report_content(report):
    labels=Labels(report.get('locale','ko'));t=labels.t;fmt=labels.money
    title=t('Your Bitcoin results, as seen in the app','화면에서 확인한 비트코인 결과')
    plain=[title,t('Fixed capital: ','고정 시작금: ')+fmt(report['amount'])]
    blocks=[]
    for i,c in enumerate(report['cycles']):
        for stage in ('bear','recovery'):
            recovery=stage=='recovery';data=c['recovery'] if recovery else c
            name=t(f'Rising market {i+1}',f'상승장 {i+1}') if recovery else t(f'Bear market {i+1}',f'하락장 {i+1}')
            rows=result_rows(c,report['amount'],labels,stage)
            gap=c['recovery']['ending_gap'] if recovery else c['metrics']['difference']
            gap_label=t('Ending balance difference','상승 후 두 자금 차이') if recovery else t('Period-end balance difference','구간 끝 자산 차이')
            extra=''
            if recovery:
                r=c['recovery']
                basis=t('Next representative cycle peak','다음 대표 사이클 고점까지') if r['basis']=='next_cycle_peak' else t('Next peak unconfirmed · last verified date','다음 고점 미확인 · 마지막 확인일까지')
                note=basis+' · '+t('The same historical BTC return is applied to both remaining balances, with no further Risk Guard trades.','남은 두 자금에 동일한 과거 BTC 수익률을 적용하며 리스크 가드의 추가 매매는 없습니다.')
                extra=f'<tr><th style="{CELL}">{t("Increase in the capital gap","기존 자금 차이의 확대분")}</th><td colspan="2" style="{CELL}">{fmt(r["gap_growth"])}</td></tr>'
            else:
                note=t('Dates describe each account’s maximum-drawdown pair. Activations count actual allocation changes.','고점·저점은 각 계좌의 최대 낙폭 계산 시점이며, 발동 횟수는 실제 비중이 바뀐 대응만 집계합니다.')
            table_rows=''.join(f'<tr><th style="{CELL};text-align:left;font-weight:normal">{escape(str(a))}</th><td style="{CELL};color:#ff9b9f">{escape(str(b))}</td><td style="{CELL};color:#6ae7aa">{escape(str(d))}</td></tr>' for a,b,d in rows)
            blocks.append(f'''<tr><td style="padding:20px 18px 28px;border-top:1px solid #344963">
              <h2 style="font-size:22px;margin:0 0 7px;color:#edf2fa">{name}</h2>
              <p style="font-size:15px;color:#cbd0db;margin:0 0 16px">{data['start']} → {data['end']}</p>
              <img src="cid:screen-{stage}-{i+1}" width="644" alt="{escape(name)}" style="display:block;width:100%;height:auto;border:0;margin-bottom:16px">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed"><thead><tr><th style="{CELL};text-align:left">{t('Metric','항목')}</th><th style="{CELL}">{t('Buy & hold','단순 보유')}</th><th style="{CELL};color:#6ae7aa">Risk Guard</th></tr></thead><tbody>{table_rows}
              <tr><th style="{CELL};text-align:left">{gap_label}</th><td colspan="2" style="{CELL};color:#8cf1ba;font-weight:bold">{fmt(gap)}</td></tr>{extra}</tbody></table>
              <p style="font-size:14px;line-height:1.8;color:#cbd0db;margin:14px 0 0">{note}</p></td></tr>''')
            plain.extend(['',name,data['start']+' → '+data['end'],*[f'{a}: {b} / {d}' for a,b,d in rows],gap_label+': '+fmt(gap),note])
            if recovery:plain.append(t('Increase in the capital gap: ','기존 자금 차이의 확대분: ')+fmt(c['recovery']['gap_growth']))
    company=t('ERUTY connects investment analysis with system development, designing data analysis, monitoring and service integrations.','ERUTY는 투자 분석과 시스템 개발을 연결하며, 데이터 분석·모니터링·서비스 연동을 위한 시스템을 설계합니다.')
    method=t('Historical Bitcoin-only comparison. Each bear-market account is independently rebased to equal capital with inherited cash. Recovery reinvests both remaining balances along the same verified BTC path. Additional entry costs, slippage and FX changes are excluded. Periods were selected retrospectively; the trough was not predicted.','비트코인 단독 과거 비교입니다. 하락 시작일에 기존 현금을 포함한 각 계좌를 같은 금액으로 환산하며, 상승장은 남은 두 자금을 동일한 검증 BTC 경로에 재투자한 비교입니다. 추가 진입 비용·슬리피지·환율 변동은 제외합니다. 구간은 사후 선정했으며 저점을 예측한 결과가 아닙니다.')
    body=f'''<!doctype html><html lang="{labels.locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#070d17;color:#edf2fa;font-family:Arial,'Apple SD Gothic Neo',sans-serif">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#0c1421">
      <tr><td style="padding:30px 22px"><p style="color:#6ae7aa;font-weight:bold;margin:0 0 20px">ERU AI · RISK GUARD</p><h1 style="font-size:26px;line-height:1.5;margin:0 0 16px">{title}</h1><p style="color:#b4c5de">{t('Fixed capital','고정 시작금')} <b style="color:#8cf1ba">{fmt(report['amount'])}</b></p><p style="font-size:15px;line-height:1.8;color:#cbd0db">{t('The app’s three drawdown and recovery charts and result tables.','화면에서 확인한 세 하락장과 상승장의 차트·결과표입니다.')}</p></td></tr>
      {''.join(blocks)}<tr><td style="padding:22px;font-size:14px;line-height:1.9;color:#cbd0db">{method}</td></tr>
      <tr><td style="padding:24px 22px;border-top:1px solid #344963"><h2 style="font-size:19px;color:#e8c488">{t('About ERUTY','회사 소개 / ERUTY')}</h2><p style="font-size:15px;line-height:1.9;color:#b4c5de">{company}</p><a href="https://www.eruty.co.kr" style="color:#e8c488">{t('Meet ERUTY','ERUTY 알아보기')}</a><p style="font-size:14px;color:#cbd0db">{t('Company introduction PDF attached (original Korean edition).','회사 소개 PDF를 첨부했습니다 (원본 한국어).')}</p></td></tr>
      <tr><td style="padding:20px 22px;color:#8197b3;font-size:12px;line-height:1.8">{t('Sent at your request. No marketing subscription. Historical simulation, no real trades.','요청하신 결과와 회사 소개를 발송했습니다. 마케팅 구독은 하지 않습니다. 과거 모의 비교이며 실제 거래가 아닙니다.')}<br>© ERUTY</td></tr></table></td></tr></table></body></html>'''
    plain.extend(['',method,'',t('About ERUTY','회사 소개 / ERUTY'),company,'https://www.eruty.co.kr'])
    return body,'\n'.join(plain)


CELL='padding:12px 7px;border-bottom:1px solid #2b3d55;text-align:right;font-size:15px;line-height:1.7;overflow-wrap:anywhere'
