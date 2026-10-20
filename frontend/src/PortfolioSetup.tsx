import {useEffect,useRef,useState,type ReactNode} from 'react';
import {aliases,assetName,money,type Allocation,type Asset,type Discussion,type RiskRule,type SetupContext,type SetupPhase} from './model';
import {profiles} from './setup';
import {RiskSummary} from './RiskRules';
import {ProfileChoices,CoinChoices,CoinRatios} from './SetupChoices';
import RuleDirections from './RuleDirections';
import {setupPhases,setupLabels,restoreManualPlan,manualAllocation,profileReady,selectProfile,changeCash,toggleCoin,changeShare,shareEqually,moveManualPhase,canChooseRule,chooseRule,manualReady,manualContext} from './manualSetup';

export default function PortfolioSetup({sessionId,catalog,total,annualRate,policy,terms,busy,messages,onChange,onReview,onDiscussRules,discussion}:{
  sessionId:string;catalog:Asset[];total:number;annualRate:number;policy:string;terms:string;busy:boolean;messages:Discussion[];
  onChange:(w:Allocation)=>void;onReview:(w:Allocation,rules:RiskRule[])=>void;onDiscussRules:(q:string,context:SetupContext)=>Promise<void>;
  discussion:(context:SetupContext,messages:Discussion[],renderProposal:(m:Discussion)=>ReactNode)=>ReactNode;
}){
  const key='eru-manual-setup-v1-'+sessionId;
  const [plan,setPlan]=useState(()=>restoreManualPlan(localStorage.getItem(key)));
  const [confirm,setConfirm]=useState(false),[consent,setConsent]=useState(false);
  const confirmation=useRef<HTMLElement>(null),ruleChat=useRef<HTMLDivElement>(null);
  const allocation=manualAllocation(plan),context=manualContext(plan),profile=profiles.find(p=>p.id===plan.profile);
  // 같은 배분값으로 부모의 초안을 반복 갱신하지 않는다.
  const allocationKey=allocation?JSON.stringify(allocation):'';
  useEffect(()=>{localStorage.setItem(key,JSON.stringify(plan));},[key,plan]);
  useEffect(()=>{if(allocationKey)onChange(JSON.parse(allocationKey));},[allocationKey,onChange]);
  useEffect(()=>{setConsent(false);setConfirm(false);},[plan.phase,allocationKey,plan.profile,plan.ruleId]);
  useEffect(()=>{if(confirm)confirmation.current?.scrollIntoView({behavior:'smooth',block:'start'});},[confirm]);
  const phaseMessages=messages.filter(m=>m.phase==='rules');
  const latestProposal=[...phaseMessages].reverse().find(m=>canChooseRule(plan,m));
  const settled=!latestProposal||!!plan.choices[latestProposal.id];
  const ready=manualReady(plan)&&settled&&plan.phase==='rules';
  const index=setupPhases.indexOf(plan.phase);
  function go(phase:SetupPhase){setPlan(s=>moveManualPhase(s,phase));window.scrollTo({top:0,behavior:'smooth'});}
  function proposal(m:Discussion){
    if(m.source!=='ai'||m.phase!=='rules'||m.risk_rules===undefined)return null;
    const choice=plan.choices[m.id],eligible=canChooseRule(plan,m);
    return <div className="consultation-proposal"><h3>ERU AI의 조건 제안</h3><RiskSummary rules={m.risk_rules}/><p className="fine">{choice==='accepted'?(plan.ruleId===m.id?'사용자가 선택한 조건이에요.':'이전에 선택한 조건이에요. 현재 계획을 기준으로 새 제안을 요청해 주세요.'):choice==='declined'?'선택하지 않은 조건이에요. 다른 방향으로 논의를 이어가세요.':eligible?'직접 선택하기 전에는 적용되지 않아요.':'성향이나 자산 비율이 바뀌었어요. 현재 구성에 맞는 새 조건을 요청해 주세요.'}</p>{!choice&&<div className="proposal-actions"><button className="btn primary" disabled={busy||!eligible} onClick={()=>setPlan(s=>chooseRule(s,m,'accepted'))}>이 제안 선택</button><button className="btn secondary" disabled={busy||!eligible} onClick={()=>setPlan(s=>chooseRule(s,m,'declined'))}>선택하지 않기</button></div>}</div>;
  }
  function allocationSummary(){
    return allocation?<div className="consultation-allocation">{(['cash',...aliases] as const).filter(a=>a==='cash'||allocation[a]>0).map(a=><div key={a}><span>{a==='cash'?'현금 (이자 수익)':assetName(a)}</span><b>{allocation[a]}%</b><small>{money(total*allocation[a]/100)}</small></div>)}</div>:<p className="plan-empty">투자할 코인을 선택하고 투자금 내 비중 합계를 100%로 맞춰 주세요.</p>;
  }
  return <div className="preparation consultation-flow manual-setup">
    <ol className="consultation-pages" aria-label="투자 준비 단계">{setupPhases.map((phase,i)=><li key={phase} aria-current={phase===plan.phase?'step':undefined} className={phase===plan.phase?'current':''}><span>{i+1}</span>{setupLabels[phase]}</li>)}</ol>
    <div className="page-title"><div className="eyebrow">내가 만드는 투자 계획 · {index+1}/3</div><h1>{({portfolio:'어떤 포트폴리오로 시작할까요?',assets:'어떤 자산에 투자할까요?',rules:'어떤 조건에서 다시 판단할까요?'})[plan.phase]}</h1><p>{({portfolio:'유형별 특징을 비교하고 나에게 맞는 현금·투자 비중을 직접 선택해요.',assets:'코인의 특징과 위험을 읽고, 투자할 종목과 비율을 직접 정해요.',rules:'직접 만든 포트폴리오에 맞춰 매수·매도 판단 조건을 AI와 논의해요.'})[plan.phase]}</p></div>
    <div className={'consultation-layout manual-'+plan.phase}>
      <div className={plan.phase==='rules'?'consultation-chat':'manual-choices'}>
        {plan.phase==='portfolio'&&<ProfileChoices plan={plan} total={total} busy={busy} onProfile={p=>setPlan(s=>selectProfile(s,p))} onCash={v=>setPlan(s=>changeCash(s,v))}/>}
        {plan.phase==='assets'&&<CoinChoices plan={plan} catalog={catalog} busy={busy} onToggle={a=>setPlan(s=>toggleCoin(s,a))}/>}
        {plan.phase==='rules'&&<><RuleDirections busy={busy} onAsk={q=>{ruleChat.current?.scrollIntoView({behavior:'smooth',block:'start'});void onDiscussRules(q,context);}}/><div ref={ruleChat} className="asset-consultation-chat">{discussion(context,phaseMessages,proposal)}</div></>}
      </div>
      <aside className="manual-plan-column">
        {plan.phase==='assets'&&<CoinRatios plan={plan} total={total} busy={busy} onShare={(a,v)=>setPlan(s=>changeShare(s,a,v))} onEqual={()=>setPlan(s=>shareEqually(s))}/>}
        <section className="panel consultation-plan" aria-label="사용자가 선택한 투자 계획">
          <div className="section-title"><h2>내가 선택한 계획</h2><span className="rules-status">투자 시작 전</span></div><p className="fine">성향과 코인 비중은 직접 선택하고, 조건은 AI 제안을 검토해 선택해요.</p>
          <div className="consultation-total"><small>운용할 자금</small><strong>{money(total)}</strong></div>
          <section className="consultation-topic"><h3>나의 투자 방식</h3>{profile?<><b>{profile.name}</b><p>현금 {plan.cash||'—'}% · 투자 {plan.cash!==''?Number((100-Number(plan.cash)).toFixed(2)):'—'}%</p></>:<p className="plan-empty">균형형·안정형·공격형·기타 중 선택해 주세요.</p>}</section>
          {plan.phase!=='portfolio'&&<section className="consultation-topic" aria-label="선택한 자산 배분"><h3>현금과 투자할 코인</h3>{allocationSummary()}<small>현금 현재 연 {annualRate}% · 교육용 세전 단리</small></section>}
          <section className="consultation-topic" aria-label="선택한 매매 판단 조건"><h3>다시 판단할 조건</h3>{plan.rules===null?<p className="plan-empty">마지막 단계에서 조건의 목적을 고르고 AI 제안을 검토해요.</p>:<RiskSummary rules={plan.rules}/>}</section>
          {ready&&<><div className="consultation-ready"><b>계획과 조건 선택을 마쳤어요</b><p>투자 시작 전에 전체 내용을 확인해 주세요.</p></div><button className="btn primary wide" disabled={busy} onClick={()=>setConfirm(true)}>전체 계획 확인</button></>}
        </section>
      </aside>
    </div>
    <div className="setup-navigation consultation-page-navigation">{index>0&&<button className="btn secondary" disabled={busy} onClick={()=>go(setupPhases[index-1])}>이전 단계로</button>}{index<2&&<button className="btn primary" disabled={busy||(index===0?!profileReady(plan):!allocation)} onClick={()=>go(setupPhases[index+1])}>{index===0?'투자할 코인 고르기':'선택한 구성으로 조건 상담하기'}</button>}</div>
    {confirm&&ready&&allocation&&plan.rules!==null&&<section ref={confirmation} className="panel consultation-confirm" aria-label="투자 계획 최종 확인"><div className="eyebrow">내가 정한 계획으로 시작해요</div><h2>투자 계획을 확인해요</h2><p>{profile?.name} · 총자금 {money(total)}</p>{allocationSummary()}<RiskSummary rules={plan.rules}/><p className="fine">초기 매수 예산은 수수료 0.05%를 포함하며 다음 일봉 시가에 체결돼요. 현금 100% 계획에는 초기 코인 주문이 없어요.</p><details><summary>현금 이자 운용 조건</summary><p>{policy}</p><p>{terms}</p></details><label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>직접 정한 구성과 현금 이자, 선택한 조건을 확인했어요. 이후 매매도 직접 승인할게요.</span></label><div className="setup-navigation"><button className="btn secondary" disabled={busy} onClick={()=>setConfirm(false)}>계획 수정하기</button><button className="btn primary" disabled={busy||!consent} onClick={()=>onReview(allocation,plan.rules!)}>이 계획으로 투자 시작</button></div></section>}
  </div>;
}
