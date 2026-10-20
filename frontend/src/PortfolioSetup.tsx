import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {aliases,assetName,money,type Allocation,type Asset,type Discussion,type RiskRule,type SetupContext} from './model';
import {RiskSummary} from './RiskRules';
import {profiles} from './setup';
import {absorbReplies,consultationContext,consultationReady,restoreConsultation} from './conversation';

export default function PortfolioSetup({sessionId,catalog,total,annualRate,policy,terms,busy,messages,onChange,onReview,discussion}:{
  sessionId:string;catalog:Asset[];total:number;annualRate:number;policy:string;terms:string;busy:boolean;messages:Discussion[];
  onChange:(w:Allocation)=>void;onReview:(w:Allocation,rules:RiskRule[])=>void;discussion:(context:SetupContext)=>ReactNode;
}){
  const key='eru-consult-v1-'+sessionId;
  const confirmation=useRef<HTMLElement>(null);
  const [plan,setPlan]=useState(()=>restoreConsultation(localStorage.getItem(key)));
  const [confirm,setConfirm]=useState(false),[consent,setConsent]=useState(false);
  useEffect(()=>{setPlan(s=>absorbReplies(s,messages));},[messages]);
  useEffect(()=>{localStorage.setItem(key,JSON.stringify(plan));},[key,plan]);
  useEffect(()=>{if(plan.allocation)onChange(plan.allocation);},[plan.allocation,onChange]);
  useEffect(()=>{setConsent(false);setConfirm(false);},[plan.profile,plan.cash,plan.allocation,plan.rules]);
  useEffect(()=>{if(confirm)confirmation.current?.scrollIntoView({behavior:'smooth',block:'start'});},[confirm]);
  const context=useMemo(()=>consultationContext(plan),[plan]);
  const ready=consultationReady(plan),allocation=plan.allocation;
  const profile=profiles.find(p=>p.id===plan.profile);
  return <div className="preparation consultation-flow">
    <div className="page-title"><div className="eyebrow">ERU AI와 함께 시작하는 투자</div><h1>이야기하며 만드는 나의 투자 계획</h1><p>어떤 투자를 하고 싶은지부터 들려주세요. 자금 배분과 투자 종목, 다시 판단할 조건까지 함께 정해요.</p></div>
    <div className="consultation-layout">
      <div className="consultation-chat">{discussion(context)}</div>
      <aside className="panel consultation-plan" aria-label="함께 정리한 투자 계획">
        <div className="section-title"><h2>함께 정리한 계획</h2><span className="rules-status">승인 전 초안</span></div>
        <p className="fine">대화에서 나온 제안이 여기에 모여요. 바꾸고 싶은 부분도 ERU AI에게 이야기해 주세요.</p>
        <div className="consultation-total"><small>함께 운용할 자금</small><strong>{money(total)}</strong></div>
        <section className="consultation-topic"><h3>나에게 맞는 투자 방식</h3>{profile?<><b>{profile.name}</b><p>현금 {plan.cash}% · 투자 {Number((100-plan.cash).toFixed(2))}%</p></>:<p className="plan-empty">투자 경험과 감수할 수 있는 변동을 이야기하며 함께 찾아가요.</p>}</section>
        <section className="consultation-topic" aria-label="상담한 자산 배분"><h3>현금과 투자할 자산</h3>{allocation?<><div className="consultation-allocation">{(['cash',...aliases] as const).filter(a=>allocation[a]>0).map(a=><div key={a}><span>{a==='cash'?'현금 (이자 수익)':assetName(a)}</span><b>{allocation[a]}%</b><small>{money(total*allocation[a]/100)}</small></div>)}</div><small>현금 현재 연 {annualRate}% · 교육용 세전 단리</small></>:<p className="plan-empty">현금의 역할과 코인의 특징을 함께 살펴보고 배분을 정해요.</p>}</section>
        <section className="consultation-topic" aria-label="상담한 리스크 조건"><h3>언제 함께 다시 판단할까요?</h3>{plan.rules===null?<p className="plan-empty">걱정되는 상황과 감수 가능한 손실을 바탕으로 알림 조건도 대화에서 함께 만들어요.</p>:<RiskSummary rules={plan.rules}/>}</section>
        {ready?<><div className="consultation-ready"><b>함께 확인할 계획이 모였어요</b><p>내용을 검토하거나 대화를 이어가며 수정할 수 있어요.</p></div><button className="btn primary wide" disabled={busy} onClick={()=>setConfirm(true)}>함께 만든 계획 확인</button></>:<p className="fine">성향·자금 배분·리스크 조건이 대화에서 정리되면 계획 전체를 확인할 수 있어요.</p>}
        <details className="consultation-reference"><summary>투자 가능한 자산 살펴보기</summary>{catalog.map(a=><div key={a.alias}><b>{a.name}</b><p>{a.overview}</p></div>)}</details>
      </aside>
    </div>
    {confirm&&ready&&allocation&&plan.rules!==null&&<section ref={confirmation} className="panel consultation-confirm" aria-label="상담 계획 최종 확인"><div className="eyebrow">이제 나의 계획으로 확정할까요?</div><h2>함께 만든 계획을 확인해요</h2><p>{profile?.name} · 총자금 {money(total)}</p><div className="consultation-allocation">{(['cash',...aliases] as const).map(a=><div key={a}><span>{a==='cash'?'현금 (이자 수익)':assetName(a)}</span><b>{allocation[a]}%</b><small>{money(total*allocation[a]/100)}</small></div>)}</div><RiskSummary rules={plan.rules}/><p className="fine">승인한 초기 매수 예산은 수수료 0.05%를 포함하며 다음 일봉 시가에 체결돼요. 현금 100% 계획에는 초기 코인 주문이 없어요.</p><details><summary>현금 이자 운용 조건</summary><p>{policy}</p><p>{terms}</p></details><label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>함께 논의한 구성과 현금 이자, 리스크 조건을 확인했어요. 이후 매매 제안도 직접 승인할게요.</span></label><div className="setup-navigation"><button className="btn secondary" disabled={busy} onClick={()=>setConfirm(false)}>상담 계속하기</button><button className="btn primary" disabled={busy||!consent} onClick={()=>onReview(allocation,plan.rules!)}>이 계획으로 투자 시작</button></div></section>}
  </div>;
}
