"""기존 불변 장부를 사용하는 사전 운용·대표 하락장 두 단계 비교.

고점/저점은 사후에 고정한 교육용 구간이다. 매매 규칙이나 체결 시점을
바꾸지 않고, 하락 시작 종가의 각 계좌 평가액을 1로 정규화한다.
"""
from decimal import Decimal as D, localcontext
from datetime import date

from .bitcoin_engine import BitcoinEngine, maximum_drop

MODEL_VERSION="btc-bear-2"
PREPARATION_SHARE=30
SCENARIOS=(
    ("cycle-1","1차 하락장","2016-07-01","2017-12-16","2018-12-15"),
    ("cycle-2","2차 하락장","2020-05-01","2021-11-08","2022-11-21"),
    ("cycle-3","3차 하락장","2023-07-01","2025-10-06","2026-02-05"),
)
CYCLES=tuple((sid,name,start,end) for sid,name,_,start,end in SCENARIOS)


def highlights(events,limit=20):
    if len(events)<=limit:return list(events)
    picks={0,len(events)-1}
    for kind in ("sell","buy","wait"):
        found=[i for i,e in enumerate(events) if e["kind"]==kind]
        if found:picks.update((found[0],found[-1]))
    for n in range(limit):
        if len(picks)>=limit:break
        picks.add(round(n*(len(events)-1)/(limit-1)))
    for i in range(len(events)):
        if len(picks)>=limit:break
        picks.add(i)
    return [events[i] for i in sorted(picks)]


class BitcoinBearEngine:
    def __init__(self,base=None):
        self.base=base or BitcoinEngine()
        self.fingerprint=self.base.fingerprint
        with localcontext() as context:
            context.prec=34
            self.runs=tuple(self.build(i) for i in range(3))

    def build(self,index):
        sid,name,prep_start,start,end=SCENARIOS[index]
        original=self.base.runs[index]
        source=original["history"]
        baseline=next(row for row in source[1:] if row["date"]==start)
        pre=[dict(row) for row in source if row["date"]<=start]
        bear=[]
        for row in source[1:]:
            if not start<=row["date"]<=end:continue
            bear.append({"date":row["date"],"hold":row["hold"]/baseline["hold"],
                "guard":row["guard"]/baseline["guard"],"cash":row["cash"]/baseline["guard"],
                "exposure":row["exposure"],"fees":(row["fees"]-baseline["fees"])/baseline["guard"]})
        if not bear or bear[-1]["date"]!=end:raise ValueError("Missing bear-market boundary")
        preparation={"start":prep_start,"end":start,"history":pre,"events":[],"phase":"preparation"}
        decline={"start":start,"end":end,"history":bear,"events":[],"phase":"bear"}
        for phase in (preparation,decline):
            for event in original["events"]:
                if phase is preparation:
                    if event["at"]>start:continue
                    copy=dict(event)
                else:
                    if not start<event["at"]<=end:continue
                    copy=dict(event)
                    for key in ("fee","cash_before","cash_after","trade_value","value_before","value_after","quantity_internal"):
                        if key in copy:copy[key]/=baseline["guard"]
                if phase is decline:
                    copy["at_idx"]=next(j for j,row in enumerate(phase["history"]) if row["date"]==copy["at"])
                copy["phase"]=phase["phase"]
                local=copy["at_idx"]/(len(phase["history"])-1)*100
                copy["position"]=local*.3 if phase is preparation else 30+local*.7
                phase["events"].append(copy)
            phase["highlights"]=highlights(phase["events"])
        events=preparation["events"]+decline["events"]
        timeline=preparation["highlights"]+decline["highlights"]
        return {"id":sid,"name":name,"start":prep_start,"end":end,
            "history":pre+bear,"events":events,"highlights":timeline,
            "preparation":preparation,"bear":decline,"baseline":baseline,
            "context":original}

    def metrics(self,history,amount,phase):
        last=history[-1];result={}
        for key in ("hold","guard"):
            dd,peak,trough=maximum_drop(history,key)
            result[key]={"value":float((last[key]*amount).quantize(D('.01'))),
                "profit":float(((last[key]-1)*amount).quantize(D('.01'))),
                "return_pct":float((last[key]-1)*100),"mdd_pct":float(dd*100),
                "mdd_peak_date":peak,"mdd_trough_date":trough,
                "recovery_pct":float((1/(1+dd)-1)*100)}
        result.update(difference=round(result["guard"]["value"]-result["hold"]["value"],2),
            guard_cash=float((last["cash"]*amount).quantize(D('.01'))),
            guard_btc_weight=float(last["exposure"]*100),guard_fees=float((last["fees"]*amount).quantize(D('.01'))))
        if phase=="bear":
            first=history[0]
            frozen=first["cash"]+first["exposure"]*last["hold"]
            result["frozen_allocation"]={"value":float((frozen*amount).quantize(D('.01'))),
                "return_pct":float((frozen-1)*100),"initial_cash_pct":float(first["cash"]*100)}
        return result

    def public_phase(self,index,phase,amount,progress,finished=False,include_history=True):
        run=self.runs[index][phase];count=len(run["history"])-1
        at=count if progress>=100 else int(max(0,progress)/100*count)
        rows=run["history"][:at+1]
        result={"start":run["start"],"end":run["end"],"date":rows[-1]["date"],
            "phase":phase,"completed":progress>=100,"metrics":self.metrics(rows,amount,phase),
            "history":[],"events":[]}
        visible=[e for e in run["highlights"] if e["at_idx"]<=at]
        for event in visible:
            item=self.base.public_event(event,amount,run)
            item["phase"]=phase
            result["events"].append(item)
        # 주요 장면과 별개로 이미 진행된 모든 대응을 명시적 공개 필드로 제공한다.
        # 아직 체결되지 않은 미래 대응은 포함하지 않는다.
        result["response_log"]=[]
        known=[e for e in run["events"] if e["at_idx"]<=at]
        for event in known:
            item=self.base.public_event(event,amount,run)
            item["phase"]=phase
            result["response_log"].append(item)
        if include_history:
            picks={0,at}|{e["at_idx"] for e in known}
            for n in range(min(220,at+1)):
                picks.add(round(n*at/max(1,min(220,at+1)-1)))
            for key in ("hold","guard"):
                _,peak,trough=maximum_drop(rows,key)
                picks.update(j for j,row in enumerate(rows) if row["date"] in (peak,trough))
            def point(j):return {"date":rows[j]["date"],"position":round(j/count*100,6),
                "hold":float((rows[j]["hold"]*amount).quantize(D('.01'))),
                "guard":float((rows[j]["guard"]*amount).quantize(D('.01'))),
                "cash":float((rows[j]["cash"]*amount).quantize(D('.01'))),
                "btc_weight":float(rows[j]["exposure"]*100)}
            result["history"]=[point(j) for j in sorted(picks)]
        if finished:
            result["all_events"]=[]
            for event in run["events"]:
                item=self.base.public_event(event,amount,run);item["phase"]=phase
                result["all_events"].append(item)
            if phase=="bear":
                summary={}
                for key in ("hold","guard"):
                    dd,peak,trough=maximum_drop(rows,key)
                    peak_row=next(row for row in rows if row['date']==peak)
                    low_row=next(row for row in rows if row['date']==trough)
                    summary[key]={"peak_date":peak,"trough_date":trough,
                        "peak_value":float((peak_row[key]*amount).quantize(D('.01'))),
                        "trough_value":float((low_row[key]*amount).quantize(D('.01'))),
                        "max_drawdown_pct":float(dd*100),"recovery_multiple":float(1/(1+dd)),
                        "end_value":result['metrics'][key]['value']}
                counts={kind:sum(e['kind']==kind for e in run['events']) for kind in ('sell','buy','wait')}
                counts.update(decisions=len(run['events']),trades=counts['sell']+counts['buy'])
                summary['counts']=counts
                result['summary']=summary
        return result

    def public_cycle(self,index,amount,progress,include_history=True,finished=False):
        phase="preparation" if progress<PREPARATION_SHARE else "bear"
        local=progress/PREPARATION_SHARE*100 if phase=="preparation" else (progress-PREPARATION_SHARE)/(100-PREPARATION_SHARE)*100
        result=self.public_phase(index,phase,amount,local,finished,include_history)
        sid,name,prep_start,start,end=SCENARIOS[index]
        result.update(id=sid,name=name,scenario_kind="bear",bear_start=start,bear_end=end,
            preparation_start=prep_start,progress=round(progress,3),phase_progress=round(local,3),completed=progress>=100)
        if phase=="bear":
            result["preparation"]=self.public_phase(index,"preparation",amount,100,finished,include_history)
        if finished:
            last=self.runs[index]["context"]["history"][-1]
            result["full_cycle_context"]={"start":self.runs[index]["context"]["start"],
                "end":self.runs[index]["context"]["end"],
                "hold_value":float((last["hold"]*amount).quantize(D('.01'))),
                "guard_value":float((last["guard"]*amount).quantize(D('.01')))}
            result['recovery']=self.recovery_comparison(index,amount)
        return result

    def recovery_comparison(self,index,amount):
        start=SCENARIOS[index][4]
        end=SCENARIOS[index+1][3] if index+1<len(SCENARIOS) else self.base.candles[-1].day
        prices={c.day:c.close for c in self.base.candles}
        multiple=prices[end]/prices[start]
        last=self.runs[index]['bear']['history'][-1]
        result={"start":start,"end":end,"basis":"next_cycle_peak" if index+1<len(SCENARIOS) else "last_confirmed_close",
                "market_return_pct":float((multiple-1)*100),"market_multiple":float(multiple)}
        starts={};ends={}
        for key in ('hold','guard'):
            starting=(last[key]*amount).quantize(D('.01'))
            ending=(starting*multiple).quantize(D('.01'))
            starts[key]=starting;ends[key]=ending
            result[key]={"starting_value":float(starting),"profit":float(ending-starting),"end_value":float(ending),
                         "total_return_pct":float((ending/amount-1)*100)}
        result['starting_gap']=float(starts['guard']-starts['hold'])
        result['ending_gap']=float(ends['guard']-ends['hold'])
        result['gap_growth']=float((ends['guard']-ends['hold'])-(starts['guard']-starts['hold']))
        # 종료된 비교에서만 공개한다. 실제 확정 일봉 경로에 두 출발 잔액을
        # 동일 비율로 적용하며 새로운 가드 매매나 시세를 생성하지 않는다.
        days=(date.fromisoformat(end)-date.fromisoformat(start)).days
        result['history']=[{
            'date':c.day,
            'position':round((date.fromisoformat(c.day)-date.fromisoformat(start)).days/max(1,days)*100,6),
            **{key:float((starts[key]*c.close/prices[start]).quantize(D('.01'))) for key in ('hold','guard')}
        } for c in self.base.candles if start<=c.day<=end]
        return result

    def public(self,state,view=None):
        elapsed=min(300,max(0,float(state["elapsed"])));active=min(2,int(elapsed//100))
        view=active if view is None else min(active,max(0,view));finished=state["status"]=="finished"
        result={"id":state["id"],"amount":float(state["amount"]),"elapsed":round(elapsed,3),
            "speed":state["speed"],"status":state["status"],"created_at":state["created_at"],
            "model_version":MODEL_VERSION,"current_cycle":active,"view_cycle":view,
            "initial_policy":"bear_start_equal_value_with_inherited_cash","email_sent":bool(state.get("email_receipts")),"cycles":[]}
        with localcontext() as context:
            context.prec=34
            for i,(sid,name,prep_start,start,end) in enumerate(SCENARIOS):
                progress=min(100,max(0,elapsed-i*100))
                if i>active and not finished:
                    result["cycles"].append({"id":sid,"name":name,"start":start,"end":end,
                        "bear_start":start,"bear_end":end,"preparation_start":prep_start,
                        "scenario_kind":"bear","progress":0,"completed":False,"history":[],"events":[]})
                else:
                    result["cycles"].append(self.public_cycle(i,D(state["amount"]),progress,finished or i==view,finished))
        if finished:
            result["method"]={"source":"Coinbase Exchange BTC-USD 공식 일봉","fee_rate":.0005,
                "execution":"완료 일봉 판단 후 다음 일봉 시가 체결","cash_interest":False,
                "selection":"각 전체 사이클에서 사후 선정한 최대 종가 하락 구간",
                "initial":"사전 운용 계좌의 현금 비중을 이어받고 하락 시작 종가에서 각 계좌를 같은 금액으로 정규화",
                "baseline":"하락 시작 BTC·현금 비중 고정 계좌를 별도로 비교"}
        return result
