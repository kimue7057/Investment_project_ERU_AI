import {useEffect,useRef,useState} from 'react';
import {aliases,assetName,money,type Allocation,type Asset} from './model';
import {profiles} from './setup';
import {BuiltInGuardSummary} from './RiskRules';
import {ProfileChoices,CoinChoices,CoinRatios} from './SetupChoices';
import {setupPhases,setupLabels,restoreManualPlan,manualAllocation,profileReady,selectProfile,changeCash,toggleCoin,changeShare,shareEqually,moveManualPhase,type ManualPlan} from './manualSetup';

export default function PortfolioSetup({sessionId,catalog,total,annualRate,policy,terms,busy,onChange,onReview,initialPlan,onDraftChange,saveStatus}:{
  sessionId:string;catalog:Asset[];total:number;annualRate:number;policy:string;terms:string;busy:boolean;
  onChange:(w:Allocation)=>void;onReview:(w:Allocation)=>void;
  initialPlan?:ManualPlan|null;onDraftChange?:(plan:ManualPlan)=>void;saveStatus?:string;
}){
  const key='eru-manual-setup-v2-'+sessionId;
  const [plan,setPlan]=useState(()=>restoreManualPlan(initialPlan?JSON.stringify(initialPlan):localStorage.getItem(key)||localStorage.getItem('eru-manual-setup-v1-'+sessionId)));
  const [confirm,setConfirm]=useState(false),[consent,setConsent]=useState(false);
  const confirmation=useRef<HTMLElement>(null);
  const allocation=manualAllocation(plan),profile=profiles.find(p=>p.id===plan.profile);
  const allocationKey=allocation?JSON.stringify(allocation):'';
  useEffect(()=>{localStorage.setItem(key,JSON.stringify(plan));},[key,plan]);
  useEffect(()=>{onDraftChange?.(plan);},[plan,onDraftChange]);
  useEffect(()=>{if(allocationKey)onChange(JSON.parse(allocationKey));},[allocationKey,onChange]);
  useEffect(()=>{setConsent(false);setConfirm(false);},[plan.phase,allocationKey,plan.profile]);
  useEffect(()=>{if(confirm)confirmation.current?.scrollIntoView({behavior:'smooth',block:'start'});},[confirm]);
  const ready=!!allocation&&plan.phase==='assets',index=setupPhases.indexOf(plan.phase);
  function allocationSummary(){
    return allocation?<div className="consultation-allocation">{(['cash',...aliases] as const).filter(a=>a==='cash'||allocation[a]>0).map(a=><div key={a}><span>{a==='cash'?'현금 (이자 수익)':assetName(a)}</span><b>{allocation[a]}%</b><small>{money(total*allocation[a]/100)}</small></div>)}</div>:<p className="plan-empty">투자할 코인을 선택하고 투자금 내 비중 합계를 100%로 맞춰 주세요.</p>;
  }
  return <div className="preparation consultation-flow manual-setup">
    {saveStatus&&<p className="account-draft-status" role="status">{saveStatus}</p>}
    <ol className="consultation-pages" aria-label="투자 준비 단계">{setupPhases.map((phase,i)=><li key={phase} aria-current={phase===plan.phase?'step':undefined} className={phase===plan.phase?'current':''}><span>{i+1}</span>{setupLabels[phase]}</li>)}</ol>
    <div className="page-title"><div className="eyebrow">내가 만드는 투자 계획 · {index+1}/2</div><h1>{plan.phase==='portfolio'?'어떤 포트폴리오로 시작할까요?':'어떤 자산에 투자할까요?'}</h1><p>{plan.phase==='portfolio'?'유형별 특징을 비교하고 나에게 맞는 현금·투자 비중을 직접 선택해요.':'코인의 특징과 위험을 읽고, 투자할 종목과 비율을 직접 정해요.'}</p></div>
    <div className={'consultation-layout manual-'+plan.phase}>
      <div className="manual-choices">
        {plan.phase==='portfolio'?<ProfileChoices plan={plan} total={total} busy={busy} onProfile={p=>setPlan(s=>selectProfile(s,p))} onCash={v=>setPlan(s=>changeCash(s,v))}/>:<CoinChoices plan={plan} catalog={catalog} busy={busy} onToggle={a=>setPlan(s=>toggleCoin(s,a))}/>}
      </div>
      <aside className="manual-plan-column">
        {plan.phase==='assets'&&<CoinRatios plan={plan} total={total} busy={busy} onShare={(a,v)=>setPlan(s=>changeShare(s,a,v))} onEqual={()=>setPlan(s=>shareEqually(s))}/>}
        <section className="panel consultation-plan" aria-label="사용자가 선택한 투자 계획">
          <div className="section-title"><h2>내가 선택한 계획</h2><span className="rules-status">투자 시작 전</span></div><p className="fine">성향과 코인 비중을 선택한 뒤 전체 계획을 확인하고 시작해요.</p>
          <div className="consultation-total"><small>운용할 자금</small><strong>{money(total)}</strong></div>
          <section className="consultation-topic"><h3>나의 투자 방식</h3>{profile?<><b>{profile.name}</b><p>현금 {plan.cash||'—'}% · 투자 {plan.cash!==''?Number((100-Number(plan.cash)).toFixed(2)):'—'}%</p></>:<p className="plan-empty">균형형·안정형·공격형·기타 중 선택해 주세요.</p>}</section>
          {plan.phase==='assets'&&<section className="consultation-topic" aria-label="선택한 자산 배분"><h3>현금과 투자할 코인</h3>{allocationSummary()}<small>현금 현재 연 {annualRate}% · 교육용 세전 단리</small></section>}
          <section className="consultation-topic"><h3>기본 리스크 가드</h3><BuiltInGuardSummary/></section>
          {ready&&<button className="btn primary wide" disabled={busy} onClick={()=>setConfirm(true)}>전체 계획 확인</button>}
        </section>
      </aside>
    </div>
    <div className="setup-navigation consultation-page-navigation">{index>0?<button className="btn secondary" disabled={busy} onClick={()=>{setPlan(s=>moveManualPhase(s,'portfolio'));window.scrollTo({top:0,behavior:'smooth'});}}>이전 단계로</button>:<button className="btn primary" disabled={busy||!profileReady(plan)} onClick={()=>{setPlan(s=>moveManualPhase(s,'assets'));window.scrollTo({top:0,behavior:'smooth'});}}>투자할 코인 고르기</button>}</div>
    {confirm&&ready&&allocation&&<section ref={confirmation} className="panel consultation-confirm" aria-label="투자 계획 최종 확인"><div className="eyebrow">내가 정한 계획으로 시작해요</div><h2>투자 계획을 확인해요</h2><p>{profile?.name} · 총자금 {money(total)}</p>{allocationSummary()}<BuiltInGuardSummary/><p className="fine">초기 매수 예산은 수수료 0.05%를 포함하며 다음 일봉 시가에 체결돼요. 현금 100% 계획에는 초기 코인 주문이 없어요.</p><details><summary>현금 이자 운용 조건</summary><p>{policy}</p><p>{terms}</p></details><label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>직접 정한 구성과 현금 이자, 기본 리스크 가드를 확인했어요. 이후 매매도 직접 승인할게요.</span></label><div className="setup-navigation"><button className="btn secondary" disabled={busy} onClick={()=>setConfirm(false)}>계획 수정하기</button><button className="btn primary" disabled={busy||!consent} onClick={()=>onReview(allocation)}>이 계획으로 투자 시작</button></div></section>}
  </div>;
}
