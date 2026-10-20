import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {aliases,assetName,money,type Allocation,type Asset,type Discussion,type RiskRule,type SetupContext,type SetupPhase} from './model';
import {RiskSummary} from './RiskRules';
import {profiles} from './setup';
import {canChoose,chooseProposal,hasProposal,phaseNames,phases,phaseReady,movePhase,consultationContext,consultationReady,restoreConsultation} from './conversation';

export default function PortfolioSetup({sessionId,catalog,total,annualRate,policy,terms,busy,messages,onChange,onReview,discussion}:{
  sessionId:string;catalog:Asset[];total:number;annualRate:number;policy:string;terms:string;busy:boolean;messages:Discussion[];
  onChange:(w:Allocation)=>void;onReview:(w:Allocation,rules:RiskRule[])=>void;discussion:(context:SetupContext,messages:Discussion[],renderProposal:(m:Discussion)=>ReactNode)=>ReactNode;
}){
  const key='eru-consult-v2-'+sessionId;
  const confirmation=useRef<HTMLElement>(null);
  const [plan,setPlan]=useState(()=>restoreConsultation(localStorage.getItem(key)));
  const [confirm,setConfirm]=useState(false),[consent,setConsent]=useState(false);
  useEffect(()=>{localStorage.setItem(key,JSON.stringify(plan));},[key,plan]);
  useEffect(()=>{if(plan.allocation)onChange(plan.allocation);},[plan.allocation,onChange]);
  useEffect(()=>{setConsent(false);setConfirm(false);},[plan.phase,plan.profile,plan.cash,plan.allocation,plan.rules]);
  useEffect(()=>{if(confirm)confirmation.current?.scrollIntoView({behavior:'smooth',block:'start'});},[confirm]);
  const context=useMemo(()=>consultationContext(plan),[plan]);
  const allocation=plan.allocation;
  const phaseMessages=messages.filter(m=>m.phase===plan.phase);
  const latestProposal=[...phaseMessages].reverse().find(m=>canChoose(plan,m));
  const settled=!latestProposal||!!plan.choices[latestProposal.id];
  const ready=consultationReady(plan)&&settled&&plan.phase==='rules';
  const index=phases.indexOf(plan.phase);
  function go(phase:SetupPhase){setPlan(s=>movePhase(s,phase));window.scrollTo({top:0,behavior:'smooth'});}
  function proposal(m:Discussion){
    if(!hasProposal(m,plan.phase))return null;
    const choice=plan.choices[m.id],eligible=canChoose(plan,m);
    return <div className="consultation-proposal"><h3>ERU AI의 제안</h3>{plan.phase==='portfolio'&&m.setup_preference&&<p><b>{profiles.find(p=>p.id===m.setup_preference!.profile)?.name}</b> · 현금 {m.setup_preference.cash}% · 투자 {Number((100-m.setup_preference.cash).toFixed(2))}%</p>}{plan.phase==='assets'&&m.weights&&<div className="suggested-weights">{Object.entries(m.weights).map(([a,w])=><span key={a}>{assetName(a)} <b>{w}%</b></span>)}</div>}{plan.phase==='rules'&&m.risk_rules&&<RiskSummary rules={m.risk_rules}/>}<p className="fine">{choice==='accepted'?(plan.selected[plan.phase]===m.id?'사용자가 선택한 제안이에요.':'이전에 선택한 제안이에요. 현재 선택은 옆에서 확인하세요.'):choice==='declined'?'선택하지 않은 제안이에요. 다른 방향으로 상담을 이어가세요.':eligible?'선택하기 전에는 계획에 반영되지 않아요.':'이전 페이지의 선택이 바뀌었어요. 현재 선택에 맞는 새 제안을 요청하세요.'}</p>{!choice&&<div className="proposal-actions"><button className="btn primary" disabled={busy||!eligible} onClick={()=>setPlan(s=>chooseProposal(s,m,'accepted'))}>이 제안 선택</button><button className="btn secondary" disabled={busy||!eligible} onClick={()=>setPlan(s=>chooseProposal(s,m,'declined'))}>선택하지 않기</button></div>}</div>;
  }
  const profile=profiles.find(p=>p.id===plan.profile);
  return <div className="preparation consultation-flow">
    <ol className="consultation-pages" aria-label="AI 상담 페이지">{phases.map((phase,i)=><li key={phase} aria-current={phase===plan.phase?'step':undefined} className={phase===plan.phase?'current':''}><span>{i+1}</span>{phaseNames[phase]}</li>)}</ol><div className="page-title"><div className="eyebrow">ERU AI와 함께 시작하는 투자 · {index+1}/3</div><h1>{({portfolio:'어떤 포트폴리오로 시작할까요?',assets:'어떤 자산에 투자할까요?',rules:'어떤 조건에서 다시 판단할까요?'})[plan.phase]}</h1><p>{({portfolio:'투자 성향과 현금·투자 비중을 상담하고, 마음에 드는 제안을 직접 선택해 주세요.',assets:'앞에서 선택한 자금 배분을 바탕으로 자산의 특징과 매수 판단을 논의해요.',rules:'선택한 자산 구성에 맞춰 조건을 논의하고, 사용할 제안을 직접 선택해 주세요.'})[plan.phase]}</p></div>
    <div className="consultation-layout">
      <div className="consultation-chat">{discussion(context,phaseMessages,proposal)}</div>
      <aside className="panel consultation-plan" aria-label="사용자가 선택한 투자 계획">
        <div className="section-title"><h2>내가 선택한 계획</h2><span className="rules-status">승인 전 초안</span></div>
        <p className="fine">각 상담에서 직접 선택한 내용만 여기에 반영돼요. AI의 제안은 선택 전까지 반영되지 않아요.</p>
        <div className="consultation-total"><small>함께 운용할 자금</small><strong>{money(total)}</strong></div>
        <section className="consultation-topic"><h3>나에게 맞는 투자 방식</h3>{profile?<><b>{profile.name}</b><p>현금 {plan.cash}% · 투자 {Number((100-plan.cash).toFixed(2))}%</p></>:<p className="plan-empty">투자 경험과 감수할 수 있는 변동을 이야기하며 함께 찾아가요.</p>}</section>
        <section className="consultation-topic" aria-label="상담한 자산 배분"><h3>현금과 투자할 자산</h3>{allocation?<><div className="consultation-allocation">{(['cash',...aliases] as const).filter(a=>allocation[a]>0).map(a=><div key={a}><span>{a==='cash'?'현금 (이자 수익)':assetName(a)}</span><b>{allocation[a]}%</b><small>{money(total*allocation[a]/100)}</small></div>)}</div><small>현금 현재 연 {annualRate}% · 교육용 세전 단리</small></>:<p className="plan-empty">현금의 역할과 코인의 특징을 함께 살펴보고 배분을 정해요.</p>}</section>
        <section className="consultation-topic" aria-label="상담한 리스크 조건"><h3>언제 함께 다시 판단할까요?</h3>{plan.rules===null?<p className="plan-empty">걱정되는 상황과 감수 가능한 손실을 바탕으로 알림 조건도 대화에서 함께 만들어요.</p>:<RiskSummary rules={plan.rules}/>}</section>
        {ready?<><div className="consultation-ready"><b>세 상담에서 선택을 마쳤어요</b><p>투자 시작 전에 전체 계획을 확인해 주세요.</p></div><button className="btn primary wide" disabled={busy} onClick={()=>setConfirm(true)}>전체 계획 확인</button></>:<p className="fine">현재 상담에서 제안을 직접 선택하면 다음 상담으로 진행할 수 있어요.</p>}
        <details className="consultation-reference"><summary>투자 가능한 자산 살펴보기</summary>{catalog.map(a=><div key={a.alias}><b>{a.name}</b><p>{a.overview}</p></div>)}</details>
      </aside>
    </div><div className="setup-navigation consultation-page-navigation">{index>0&&<button className="btn secondary" disabled={busy} onClick={()=>go(phases[index-1])}>이전 상담으로</button>}{index<2&&<button className="btn primary" disabled={busy||!phaseReady(plan)||!settled} onClick={()=>go(phases[index+1])}>선택한 내용으로 {index===0?'투자 자산':'조건'} 상담하기</button>}</div>
    {confirm&&ready&&allocation&&plan.rules!==null&&<section ref={confirmation} className="panel consultation-confirm" aria-label="상담 계획 최종 확인"><div className="eyebrow">이제 나의 계획으로 확정할까요?</div><h2>함께 만든 계획을 확인해요</h2><p>{profile?.name} · 총자금 {money(total)}</p><div className="consultation-allocation">{(['cash',...aliases] as const).map(a=><div key={a}><span>{a==='cash'?'현금 (이자 수익)':assetName(a)}</span><b>{allocation[a]}%</b><small>{money(total*allocation[a]/100)}</small></div>)}</div><RiskSummary rules={plan.rules}/><p className="fine">승인한 초기 매수 예산은 수수료 0.05%를 포함하며 다음 일봉 시가에 체결돼요. 현금 100% 계획에는 초기 코인 주문이 없어요.</p><details><summary>현금 이자 운용 조건</summary><p>{policy}</p><p>{terms}</p></details><label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>함께 논의한 구성과 현금 이자, 리스크 조건을 확인했어요. 이후 매매 제안도 직접 승인할게요.</span></label><div className="setup-navigation"><button className="btn secondary" disabled={busy} onClick={()=>setConfirm(false)}>상담 계속하기</button><button className="btn primary" disabled={busy||!consent} onClick={()=>onReview(allocation,plan.rules!)}>이 계획으로 투자 시작</button></div></section>}
  </div>;
}
