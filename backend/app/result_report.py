"""종료된 공개 스냅샷으로만 메일 그래프와 상세 복기 PDF를 생성한다."""
import io
from decimal import Decimal
from functools import lru_cache
from html import escape
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as PdfImage, PageBreak, KeepTogether

from .display_currency import sgd_money, KRW_PER_SGD, REFERENCE_DATE

ROOT=Path(__file__).resolve().parents[2]
FONT=ROOT/"data/company/fonts/NanumGothic-Regular.ttf"
BG="#0c121e"; PANEL="#161f2e"; TEXT="#edf2fa"; MUTED="#8b9fbe"; GOLD="#edc17d"; RED="#f17d88"; GREEN="#4bcaa6"


class Labels:
    def __init__(self,locale="ko",bear=False):
        self.locale=locale
        self.bear=bear

    def t(self,en,ko):return en if self.locale=="en" else ko
    def money(self,value):return sgd_money(value) if self.locale=="en" else f"{value:,.0f}원"
    def signed(self,value):return ("+" if value>0 else "")+self.money(value)
    def cycle(self,i):return self.t(f"Bear market {i+1}",f"{i+1}차 하락장") if self.bear else self.t(f"Cycle {i+1}",f"{i+1}차 사이클")
    def kind(self,e):return {"sell":self.t("SELL","분할 매도"),"buy":self.t("BUY BACK","재매수"),"wait":self.t("WAIT","매수 보류")}[e["kind"]]
    def action(self,e):
        return {"sell":self.t("Sold part of the Bitcoin position at the next daily open and raised cash.","다음 일봉 시가에 비트코인 일부를 매도하고 현금을 확보했어요."),
            "buy":self.t("Used part of the cash to buy Bitcoin at the next daily open.","다음 일봉 시가에 현금 일부로 비트코인을 다시 매수했어요."),
            "wait":self.t("Re-entry conditions were not met. Held Bitcoin and cash without a new order.","재진입 조건을 충족하지 않아 새 주문 없이 비트코인과 현금을 유지했어요.")}[e["kind"]]
    def signal(self,e):
        return {"sell":self.t("A sell signal was confirmed on a completed daily candle.","완료된 일봉에서 매도 신호를 확인했어요."),
            "buy":self.t("Re-entry conditions were confirmed on a completed daily candle.","완료된 일봉에서 재진입 조건을 확인했어요."),
            "wait":self.t("The market was falling, but re-entry conditions were not met.","하락 중이지만 재진입 조건은 충족되지 않았어요.")}[e["kind"]]


def selected_scenes(cycle):
    """성과 크기가 아닌 대응 종류와 시간 순서로 대표 장면을 고른다."""
    events=cycle.get("events",[])
    if not events:return []
    picks={len(events)-1}
    for kind in ("sell","wait","buy"):
        index=next((i for i,e in enumerate(events) if e["kind"]==kind),None)
        if index is not None:picks.add(index)
    return [(i+1,events[i]) for i in sorted(picks)]


def following_scene(cycle,index):
    events=cycle.get("events",[])
    current=events[index]
    if index+1<len(events):
        point=events[index+1]
        return point["at"],point["guard_value"],Decimal(str(point["guard_value"]))-Decimal(str(current["guard_value"]))
    end=cycle["metrics"]["guard"]["value"]
    return cycle["end"],end,Decimal(str(end))-Decimal(str(current["guard_value"]))


def _axis(value,labels):
    n=float(Decimal(str(value))/KRW_PER_SGD) if labels.locale=="en" else value
    if labels.locale=="en":
        return "S$"+(f"{n/1e9:.1f}B" if n>=1e9 else f"{n/1e6:.1f}M" if n>=1e6 else f"{n/1e3:.0f}K" if n>=1e3 else f"{n:.0f}")
    return f"{n/1e8:.1f}억" if n>=1e8 else f"{n/1e4:.0f}만" if n>=1e4 else f"{n:.0f}원"


def chart_png(cycle,locale="ko",*,screen=False,reference=None):
    history=cycle.get("history",[])
    if not history:raise ValueError("A completed asset history is required")
    labels=Labels(locale);width,height=1440,650;left,right,top,bottom=220,50,65,140
    w=width-left-right;h=height-top-bottom
    image=Image.new("RGB",(width,height),BG);draw=ImageDraw.Draw(image)
    font=ImageFont.truetype(str(FONT),38);small=ImageFont.truetype(str(FONT),32)
    maximum=max(max(max(p["hold"],p["guard"]) for p in history),reference or 0)*1.12
    def x(position):return left+w*position/100
    def y(value):return top+h-value/maximum*h
    for fraction in (0,.5,1):
        yy=top+h*fraction
        for xx in range(left,width-right,16):draw.line((xx,yy,min(xx+7,width-right),yy),fill="#263348",width=2)
        text=_axis(maximum*(1-fraction),labels);box=draw.textbbox((0,0),text,font=font)
        draw.text((left-22-(box[2]-box[0]),yy-22),text,font=font,fill=MUTED)
    red,green=("#ff8476","#76aaff") if screen else (RED,GREEN)
    if screen and reference:
        yy=y(reference)
        for xx in range(left,width-right,20):draw.line((xx,yy,min(xx+12,width-right),yy),fill=GOLD,width=2)
    for key,color in (("hold",red),("guard",green)):
        points=[(x(p["position"]),y(p[key])) for p in history]
        if len(points)>1:draw.line(points,fill=color,width=5,joint="curve")
    placed=[]
    for number,event in ([] if screen else selected_scenes(cycle)):
        ax,ay=x(event["position"]),y(event["guard_value"]);cx,cy=ax,ay
        for offset in (0,-72,72,-144,144):
            candidate=max(top+34,min(top+h-34,ay+offset))
            if all((cx-px)**2+(candidate-py)**2>70**2 for px,py in placed):cy=candidate;break
        placed.append((cx,cy));draw.line((ax,ay,cx,cy),fill=MUTED,width=2)
        draw.ellipse((cx-30,cy-30,cx+30,cy+30),fill=GOLD)
        text=str(number);box=draw.textbbox((0,0),text,font=small)
        draw.text((cx-(box[2]-box[0])/2,cy-22),text,font=small,fill=BG)
    draw.text((left,top+h+24),cycle["start"],font=small,fill=MUTED)
    end=cycle["end"];box=draw.textbbox((0,0),end,font=small)
    draw.text((width-right-(box[2]-box[0]),top+h+24),end,font=small,fill=MUTED)
    draw.line((left,height-40,left+40,height-40),fill=red,width=5);draw.text((left+54,height-58),labels.t("Buy & hold","단순 보유"),font=font,fill=TEXT)
    draw.line((left+390,height-40,left+430,height-40),fill=green,width=5);draw.text((left+444,height-58),labels.t("Risk Guard","리스크 가드"),font=font,fill=TEXT)
    output=io.BytesIO();image.save(output,format="PNG",optimize=True);return output.getvalue()


@lru_cache(maxsize=1)
def register_font():
    pdfmetrics.registerFont(TTFont("ERUNanum",str(FONT)))


def review_pdf(report,charts=None):
    labels=Labels(report.get("locale","ko"),report.get("model_version")=="btc-bear-2");register_font()
    output=io.BytesIO();page_w,page_h=A4
    styles={
        "title":ParagraphStyle("title",fontName="ERUNanum",fontSize=23,leading=32,textColor=colors.HexColor(TEXT),spaceAfter=15),
        "head":ParagraphStyle("head",fontName="ERUNanum",fontSize=14,leading=22,textColor=colors.HexColor(GOLD),spaceBefore=12,spaceAfter=12),
        "body":ParagraphStyle("body",fontName="ERUNanum",fontSize=9,leading=15,textColor=colors.HexColor(TEXT),wordWrap="CJK",spaceAfter=7),
        "small":ParagraphStyle("small",fontName="ERUNanum",fontSize=8,leading=13,textColor=colors.HexColor(MUTED),wordWrap="CJK",spaceAfter=6),
    }
    def p(text,style="body"):return Paragraph(escape(str(text)).replace("\n","<br/>"),styles[style])
    def table(rows,widths=None):
        obj=Table([[p(cell,"small" if i==0 else "body") for cell in row] for i,row in enumerate(rows)],colWidths=widths,repeatRows=1,hAlign="LEFT")
        obj.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),colors.HexColor(PANEL)),("LINEBELOW",(0,0),(-1,-1),.4,colors.HexColor("#29374b")),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),9),("RIGHTPADDING",(0,0),(-1,-1),9),("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
        return obj
    width=page_w-88
    def decorate(canvas,doc):
        canvas.setFillColor(colors.HexColor(BG));canvas.rect(0,0,page_w,page_h,fill=1,stroke=0)
        canvas.setFont("ERUNanum",8);canvas.setFillColor(colors.HexColor(GOLD));canvas.drawString(44,page_h-28,"ERU AI / RISK GUARD")
        canvas.setFillColor(colors.HexColor(MUTED));canvas.drawString(44,25,labels.t("Historical simulation / ERUTY","과거 데이터 모의 시뮬레이션 / ERUTY"));canvas.drawRightString(page_w-44,25,str(doc.page))
    story=[p(labels.t("Your Bitcoin journey\nResults & response review","나의 비트코인 시뮬레이션\n결과와 대응 복기"),"title"),p(labels.t("STARTING CAPITAL","시작 투자금"),"small"),p(labels.money(report["amount"]),"title")]
    rows=[[labels.t("Cycle","사이클"),labels.t("Buy & hold","단순 보유"),labels.t("Risk Guard","리스크 가드")]]
    for i,c in enumerate(report["cycles"]):
        m=c["metrics"]
        rows.append([labels.cycle(i)+"\n"+c["start"]+" - "+c["end"],labels.money(m["hold"]["value"])+f"\nMDD {m['hold']['mdd_pct']:.1f}%",labels.money(m["guard"]["value"])+f"\nMDD {m['guard']['mdd_pct']:.1f}%"])
    story.extend([table(rows,[width*.34,width*.33,width*.33]),Spacer(1,20),p(labels.t("Read both outcomes","낙폭과 최종 자산을 함께 확인하세요"),"head"),p(labels.t("The decline dates were selected retrospectively. Preparation is shown before each bear period. Bear-period returns use equal starting values and inherited cash, excluding earlier gains. Full-cycle results may differ. Scenes follow time and response type, not profitability.","하락 구간은 사후 선정했습니다. 각 하락장 앞에 현금 확보 과정을 보여줍니다. 하락장 손익은 이전 수익을 제외하고 같은 시작 평가액과 기존 현금 비중으로 비교하며, 전체 사이클 결과와 다릅니다. 장면은 시간과 대응 종류로 선정했습니다.") if labels.bear else labels.t("A smaller drawdown can come with lower final assets. Each cycle starts independently with the same capital. Response scenes follow time order, not profitability.","낙폭이 줄어도 최종 자산은 단순 보유보다 적을 수 있어요. 각 사이클은 같은 자금으로 독립 시작해요. 복기 장면은 수익 크기가 아닌 시간 순서로 정리했어요.")),p(labels.t("The following pages contain all highlighted scenes and the full simulated response ledger.","다음 페이지에서 주요 복기 장면 전체와 전체 모의 대응 내역을 확인할 수 있어요."))])
    sections=[]
    for i,c in enumerate(report["cycles"]):
        if c.get("preparation"):sections.append((i,c["preparation"]))
        sections.append((i,c))
    for i,c in sections:
        m=c["metrics"];story.extend([PageBreak(),p(labels.cycle(i)+(" / "+labels.t("Cash preparation","현금 확보 과정") if c.get("phase")=="preparation" else " / "+labels.t("Bear-market comparison","하락장 비교") if labels.bear else ""),"title"),p(c["start"]+" - "+c["end"],"small")])
        image=((charts or {}).get(i) if c.get("phase")!="preparation" else None) or (chart_png(c,labels.locale) if c.get("history") else None)
        if image:story.append(PdfImage(io.BytesIO(image),width=width,height=width*650/1440))
        if c.get("phase")=="preparation":
            story.append(p(labels.t("Original continuous-run values before rebasing. Gains from preparation are not added to the following bear-period results.","하락장 환산 전의 원래 연속 운용 금액입니다. 사전 운용 수익은 다음 하락장 손익에 합산하지 않습니다."),"small"))
        if "frozen_allocation" in m:
            frozen=m["frozen_allocation"]
            story.extend([p(labels.t("Equal-value bear-period basis","하락 구간의 동일 평가액 기준"),"head"),p(labels.t(f"Each account is independently rebased to {labels.money(report['amount'])} at the starting close. Risk Guard inherits cash of {frozen['initial_cash_pct']:.1f}%. This is not a fresh 100% Bitcoin investment.",f"하락 시작 종가에서 두 계좌를 각각 {labels.money(report['amount'])}로 환산했습니다. 가드는 기존 현금 {frozen['initial_cash_pct']:.1f}%를 이어받습니다. BTC 100%로 새로 투자한 결과가 아닙니다.")),p(labels.t(f"Unchanged starting BTC/cash mix: {frozen['return_pct']:.1f}% / {labels.money(frozen['value'])}. Additional trading is not always better than holding this mix.",f"시작 BTC·현금 비중을 추가 매매 없이 유지했다면 {frozen['return_pct']:.1f}% / {labels.money(frozen['value'])}입니다. 추가 매매가 비중 고정보다 항상 유리하지는 않습니다."),"small")])
        if c.get("full_cycle_context"):
            context=c["full_cycle_context"]
            story.append(p(labels.t(f"Original full cycle {context['start']} - {context['end']}: hold {labels.money(context['hold_value'])}, guard {labels.money(context['guard_value'])}. Uses original starting capital and is separate from this rebased period.",f"원래 전체 사이클 {context['start']} - {context['end']}: 단순 보유 {labels.money(context['hold_value'])}, 가드 {labels.money(context['guard_value'])}. 원래 시작 자금 기준이며 이번 하락장 환산 잔액과 별개입니다."),"small"))
        data=[[labels.t("Metric","비교 항목"),labels.t("Buy & hold","단순 보유"),labels.t("Risk Guard","리스크 가드")]]
        for key,name,fmt in [("value",labels.t("Final assets","최종 자산"),labels.money),("profit",labels.t("Profit / loss","손익"),labels.signed),("return_pct",labels.t("Return","수익률"),lambda x:f"{x:+.1f}%"),("mdd_pct",labels.t("Maximum drawdown","최대 낙폭"),lambda x:f"{x:.1f}%")]:
            if key in m["hold"]:data.append([name,fmt(m["hold"][key]),fmt(m["guard"][key])])
        story.extend([table(data,[width*.34,width*.33,width*.33]),Spacer(1,15),p(labels.t("Final asset difference (guard - hold): ","최종 자산 차이 (가드 - 단순 보유): ")+labels.signed(m["difference"])),p(labels.t("Chart numbers match representative response scenes. The full highlighted timeline follows.","그래프 번호는 대표 대응 장면과 연결돼요. 다음 페이지에는 주요 복기 장면 전체를 수록했어요."),"small"),PageBreak(),p(labels.t("Response timeline","대응 타임라인"),"title")])
        events=c.get("events",[])
        for j,e in enumerate(events):
            until,value,change=following_scene(c,j)
            block=[p(f"{j+1:02} / {labels.kind(e)} / {e['at']}","head"),p(labels.signal(e)),p(labels.action(e)),p(labels.t("Signal ","판단일 ")+e["signal_at"]+" / "+labels.t("No order","주문 없음") if e["kind"]=="wait" else labels.t("Signal ","판단일 ")+e["signal_at"]+labels.t(" / Next-open execution "," / 다음 일봉 시가 체결 ")+e["at"],"small")]
            block.append(p(labels.t("Trade ","거래금액 ")+labels.money(e["trade_value"])+labels.t(" / Fee "," / 수수료 ")+labels.money(e["fee"])+f" / BTC {e['btc_weight']:.1f}% / "+labels.t("Cash ","현금 ")+labels.money(e["cash_after"]),"small"))
            block.append(p(labels.t("Assets at that daily close: hold ","해당 일봉 종가 자산: 단순 보유 ")+labels.money(e["hold_value"])+labels.t(" / guard "," / 가드 ")+labels.money(e["guard_value"]),"small"))
            block.append(p(labels.t("To the next scene / cycle end ","다음 장면 / 사이클 종료까지 ")+until+": "+labels.money(value)+" ("+labels.signed(change)+")","small"))
            story.append(KeepTogether(block));story.append(Spacer(1,7))
        story.extend([p(labels.t("Changes between scenes include market movements, fees and any intervening responses. They are not the isolated profit or loss caused by one action.","장면 사이의 자산 변화에는 시장 가격·수수료·중간 대응이 함께 반영돼요. 특정 대응 하나만의 확정 손익으로 해석할 수 없어요."),"small"),PageBreak(),p(labels.t("All simulated responses","전체 모의 대응 내역"),"title")])
        ledger=[[labels.t("Signal / execution","판단 / 체결"),labels.t("Response / BTC","대응 / BTC 비중"),labels.t("Trade / fee","거래금액 / 수수료"),labels.t("Cash after","대응 후 현금")]]
        for e in c.get("all_events",events):
            ledger.append([e["signal_at"]+"\n"+(labels.t("No order","주문 없음") if e["kind"]=="wait" else e["at"]),labels.kind(e)+f"\n{e['btc_weight']:.1f}%",labels.money(e["trade_value"])+"\n"+labels.money(e["fee"]),labels.money(e["cash_after"])])
        story.append(table(ledger,[width*.24,width*.23,width*.30,width*.23]))
    story.extend([PageBreak(),p(labels.t("Method & scope","계산 기준과 반영 범위"),"title"),p(labels.t("Both accounts start with 100% Bitcoin. A 0.05% fee per side applies. Decisions use completed daily candles and trades execute at the next daily open. Historical FX movements, cash interest and slippage are excluded.","두 계좌는 비트코인 100%로 시작하며 편도 수수료 0.05%를 반영해요. 확정된 일봉으로 판단하고 다음 일봉 시가에 체결해요. 과거 환율 변동·현금 이자·슬리피지는 미반영해요.")),p(labels.t(f"SGD display uses the fixed ECB cross-rate dated {REFERENCE_DATE}: S$1 = KRW {KRW_PER_SGD:.2f}.",f"표시 환산율은 {REFERENCE_DATE} ECB 기준으로 고정하며 S$1 = {KRW_PER_SGD:.2f}원이에요.")),p(labels.t("This is a simulation, not a forecast. The company brochure describes a different portfolio and is attached separately.","과거 모의 결과로 미래 성과를 예측하지 않아요. 별도 회사 소개 리플렛의 포트폴리오와 이 비트코인 단독 비교의 계산 대상은 달라요."))])
    if labels.bear:
        story.extend([p(labels.t("Bear-period normalization and selection","하락장 정규화와 선정 기준"),"head"),p(labels.t("The 100% Bitcoin start described above belongs to preparation. At each selected bear-market start, existing portfolios are independently rebased to equal capital with no new trade. Earlier gains and fees are not charged again. Bear-period fees cover only trades after that starting close. The largest peak-to-trough closing-price decline in each original cycle was selected retrospectively, not predicted. The unchanged-mix benchmark keeps the same initial Bitcoin and cash without further trading.","위 BTC 100% 출발은 사전 운용 단계입니다. 각 하락 시작 종가에서 기존 포트폴리오를 새로운 매매 없이 동일 금액으로 독립 환산합니다. 이전 수익을 합산하거나 과거 수수료를 다시 부과하지 않습니다. 하락장 수수료에는 시작 종가 이후 매매만 포함합니다. 각 원래 사이클에서 가장 큰 종가 고점·저점 하락 구간을 사후 선정했으며 날짜를 예측한 결과가 아닙니다. 비중 고정 계좌는 같은 시작 BTC·현금을 추가 매매 없이 유지합니다."))])
    SimpleDocTemplate(output,pagesize=A4,rightMargin=44,leftMargin=44,topMargin=58,bottomMargin=46,title=labels.t("ERU AI Bitcoin results and review","ERU AI 비트코인 결과와 복기"),author="ERUTY").build(story,onFirstPage=decorate,onLaterPages=decorate)
    return output.getvalue()
