import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { aliases, assetName, assetShort, money, validWeights, type Alias, type Allocation, type Asset, type SetupContext, type RiskRule, type SetupPreference } from './model';
import { buildAllocation, emptyShares, equalShares, profiles, sharesFromAllocation } from './setup';
import RiskRules, {defaultRiskRules, validRules, RiskSummary} from './RiskRules';

type Setup = SetupContext;
const labels = ['성향 정하기','현금·투자 배분','투자 종목 선택','리스크 조건 상담','최종 확인'];
function restore(key:string):Setup {
  try {
    const s = JSON.parse(localStorage.getItem(key) || 'null');
    if (s && (s.profile===null || profiles.some(p=>p.id===s.profile)) && Number.isInteger(s.step) && s.step>=0 && s.step<=4 &&
        Number.isFinite(s.cash) && s.cash>=0 && s.cash<=100 && Array.isArray(s.selected) &&
        s.selected.every((a:Alias)=>aliases.includes(a)) && new Set(s.selected).size===s.selected.length &&
        s.shares && aliases.every(a=>Number.isFinite(s.shares[a]) && s.shares[a]>=0 && s.shares[a]<=100 &&
          (s.selected.includes(a) || s.shares[a]===0))) return {...s,risk_rules:validRules(s.risk_rules)?s.risk_rules:defaultRiskRules};
  } catch {/* 저장된 설정을 읽을 수 없으면 첫 안내부터 시작 */}
  return {profile:null,step:0,cash:30,shares:emptyShares(),selected:[],risk_rules:defaultRiskRules};
}

export default function PortfolioSetup({sessionId,catalog,total,annualRate,policy,terms,busy,onChange,onReview,discussion}:{
  sessionId:string; catalog:Asset[]; total:number; annualRate:number; policy:string; terms:string; busy:boolean;
  onChange:(w:Allocation)=>void; onReview:(w:Allocation,rules:RiskRule[])=>void; discussion:(apply:(w:Allocation)=>void,context:SetupContext,applyRisk:(rules:RiskRule[])=>void,applyPreference:(p:SetupPreference)=>void)=>ReactNode;
}) {
  const key = 'eru-setup-v4-' + sessionId;
  const [state,setState] = useState<Setup>(()=>restore(key));
  const [consent,setConsent] = useState(false), [feedback,setFeedback] = useState('');
  const {profile,step,cash,shares,selected} = state;
  const rules=state.risk_rules ?? defaultRiskRules;
  const allocation = useMemo(()=>buildAllocation(cash,shares),[cash,shares]);
  const preference = profiles.find(p=>p.id===profile);
  const investment = total*(100-cash)/100;
  const sharesTotal = aliases.reduce((sum,a)=>sum+shares[a],0);
  useEffect(()=>{localStorage.setItem(key,JSON.stringify(state));},[key,state]);
  useEffect(()=>{if (allocation) onChange(allocation);},[allocation,onChange]);
  useEffect(()=>{setConsent(false);},[cash,shares,profile,state.risk_rules]);
  function applyRisk(risk_rules:RiskRule[]) {
    if (!validRules(risk_rules)) return;
    setState(s=>({...s,risk_rules}));
    setFeedback('AI가 제안한 리스크 조건을 초안에 담았어요. 리스크 조건 단계에서 확인하고 시작할 때 함께 확정해요.');
  }
  function applyPreference(p:SetupPreference) {
    setState(s=>({...s,profile:p.profile,cash:p.cash}));
    setFeedback('상담한 성향과 현금·투자 배분을 초안에 담았어요. 종목과 리스크 조건도 함께 정해요.');
  }
  function updateCash(n:number) {
    if (!Number.isFinite(n)) return;
    setState(s=>({...s,cash:Math.round(Math.max(0,Math.min(100,n))*100)/100}));
  }
  function toggle(a:Alias) {
    const next = selected.includes(a) ? selected.filter(v=>v!==a) : [...selected,a];
    setState(s=>({...s,selected:next,shares:equalShares(next)}));
  }
  function apply(w:Allocation) {
    if (!validWeights(w)) return;
    setState(s=>({...s,profile:s.profile ?? (w.cash>=45 ? 'cautious' : w.cash>=20 ? 'balanced':'active'),
      cash:w.cash,selected:aliases.filter(a=>w[a]>0),shares:sharesFromAllocation(w)}));
    setFeedback('제안한 구성을 설정에 담았어요. 비중과 종목을 확인한 뒤에만 시작해요.');
  }
  const coach = step===0 ? '먼저, 어떤 방식으로 투자하고 싶은지 알려주세요. 성향을 정하면 현금과 투자할 금액부터 함께 나눠볼게요.'
    : step===1 ? '좋아요. 종목을 고르기 전에 자금의 역할을 먼저 정해볼게요. 현금은 이자를 얻으며 보유하고, 투자금은 다음 단계에서 종목을 골라 운용해요.'
    : step===2 ? investment===0 ? '전액 현금으로 보유하는 계획이네요. 코인 주문 없이 이자 수익을 확인할 수 있어요.'
      : '이제 투자금 ' + money(investment) + ' 안에서 무엇을 담을지 정해볼게요. 관심 있는 종목을 고르면 같은 비중으로 나눠드릴게요. 이후 직접 조정할 수 있어요.'
    : step===3 ? '어떤 상황에서 함께 다시 판단할까요? 감수할 수 있는 손실이나 걱정되는 상황을 AI에게 말해보세요. 종목마다 다른 조건도 만들 수 있어요.'
    : '성향, 현금과 투자 비중, 선택한 종목과 리스크 조건을 함께 확인해볼게요. 최종 승인 전에는 주문되지 않아요.';
  return <div className="preparation setup-flow">
    <ol className="setup-progress" aria-label="투자 준비 단계">{labels.map((label,i)=><li key={label} aria-current={step===i ? 'step':undefined} className={step===i ? 'current' : step>i ? 'complete':''}><span>{i+1}</span>{label}</li>)}</ol>
    <div className="page-title"><div className="eyebrow">AI와 함께 만드는 나의 첫 포트폴리오</div><h1>{['어떤 투자 방식이 나에게 맞을까요?','현금과 투자, 먼저 나눠볼까요?','투자금으로 무엇을 담을까요?','어떤 상황에서 다시 판단할까요?','함께 만든 계획을 확인해요'][step]}</h1><p>성향부터 종목, 리스크 조건까지 AI와 상담하고 나의 계획으로 확정해요.</p></div>
    <div className="setup-layout">
      <aside className="setup-coach panel">
        <div className="coach-identity"><span className="coach-avatar" aria-hidden="true">E</span><div><b>ERU 투자 도우미</b><small>단계별 안내 · 아래에서 AI와 논의</small></div></div>
        <div className="coach-message" aria-live="polite"><p>{coach}</p></div>
        <div className="setup-mini-summary"><span>{preference?.name ?? '성향 선택 전'}</span><b>총자금 {money(total)}</b>{profile && <small>현금 {cash}% · 투자 {Number((100-cash).toFixed(2))}%</small>}</div>
        <div className="setup-questions">{discussion(apply,state,applyRisk,applyPreference)}</div>
        {feedback && <p className="fine" role="status">{feedback}</p>}
      </aside>
      <section className="panel setup-options">
        {step===0 && <><h2>나의 투자 성향</h2><p className="setup-caption">가까운 성향을 골라주세요. 다음 단계에서 비중을 조정할 수 있어요.</p><div className="profile-options">{profiles.map(p=><button className={'profile-option ' + (profile===p.id ? 'selected':'')} aria-label={p.name} aria-pressed={profile===p.id} disabled={busy} key={p.id} onClick={()=>setState(s=>({...s,profile:p.id,cash:p.cash}))}><span className="profile-name">{p.name}<span className="profile-choice" aria-hidden="true">{profile===p.id ? '✓':'○'}</span></span><p>{p.description}</p><span className="profile-ratio">현금 {p.cash}% <i/> 투자 {100-p.cash}%</span></button>)}</div><p className="fine">안정 성향은 현금 비중에 반영해요. 안정형도 투자한 코인에서 손실이 발생할 수 있어요.</p></>}
        {step===1 && <><h2>자금의 역할 정하기</h2><div className="bucket-cards"><div className="cash-bucket"><small>필요할 때 투자할 수 있는</small><h3>현금 (이자 수익)</h3><strong>{money(total*cash/100)}</strong><p>현재 연 {annualRate}% · 교육용 세전 단리</p></div><div className="invest-bucket"><small>가격 변화에 참여하는</small><h3>투자</h3><strong>{money(investment)}</strong><p>다음 단계에서 투자할 종목을 정해요</p></div></div><div className="bucket-bar" aria-label="현금과 투자 배분"><span style={{flex:cash}}/><span style={{flex:100-cash}}/></div><label className="bucket-slider"><span>현금 비중 <b>{cash}%</b></span><input type="range" aria-label="현금 비중 슬라이더" min="0" max="100" step="1" value={cash} disabled={busy} onChange={e=>updateCash(Number(e.target.value))}/></label><div className="bucket-inputs"><label>현금 (%)<input type="number" aria-label="현금 비중" min="0" max="100" step="1" value={cash} disabled={busy} onChange={e=>updateCash(Number(e.target.value))}/></label><label>투자 (%)<input type="number" aria-label="투자 비중" min="0" max="100" step="1" value={Number((100-cash).toFixed(2))} disabled={busy} onChange={e=>updateCash(100-Number(e.target.value))}/></label></div><p className="fine">현금과 투자의 합계는 항상 100%예요. 별도 채권·안전자산 상품을 매수하는 구성은 아니에요.</p></>}
        {step===2 && <><div className="section-title"><h2>투자할 종목 고르기</h2><span className="investment-budget">투자금 {money(investment)}</span></div>{investment===0 ? <div className="coach-message"><h3>현금 100%로 시작해요</h3><p>지금은 코인을 선택하지 않아도 돼요. 투자 비중을 늘리려면 이전 단계로 돌아가 주세요.</p></div> : <><p className="setup-caption">종목을 고른 뒤 투자금 안에서 비중을 정해주세요.</p><div className="setup-assets">{catalog.map(a=><article key={a.alias} className={'setup-asset ' + (selected.includes(a.alias as Alias) ? 'selected':'')}><label className="setup-asset-select"><input type="checkbox" aria-label={assetName(a.alias)+' 선택'} checked={selected.includes(a.alias as Alias)} disabled={busy} onChange={()=>toggle(a.alias as Alias)}/><span className={'asset-badge asset-'+a.alias}>{assetShort(a.alias)}</span><b>{a.name}</b></label><p>{a.overview}</p><details><summary>특징과 위험 확인</summary><p>{a.technology}</p><p>{a.supply}</p><ul>{a.risks?.map(r=><li key={r}>{r}</li>)}</ul></details>{selected.includes(a.alias as Alias) && <><label className="inside-share">투자금 안에서<input type="number" aria-label={assetName(a.alias)+' 투자 내 비중'} min="0" max="100" step=".01" value={shares[a.alias as Alias]} disabled={busy} onChange={e=>setState(s=>({...s,shares:{...s.shares,[a.alias]:Number(e.target.value)}}))}/><span>%</span></label><small>전체 자산 {allocation?.[a.alias as Alias] ?? '—'}% · {allocation ? money(total*allocation[a.alias as Alias]/100):'비중 합계를 확인해 주세요'}</small></>}</article>)}</div><div className="allocation-total" aria-live="polite"><b>투자 내 비중 합계 {Number(sharesTotal.toFixed(2))}%</b><span>{allocation ? '전체 자산에 반영할 준비가 됐어요':'투자금 안에서 합계를 100%로 맞춰주세요'}</span></div><button className="btn secondary" disabled={busy || !selected.length} onClick={()=>setState(s=>({...s,shares:equalShares(s.selected)}))}>선택한 종목에 균등 배분</button></>}</>}
        {step===3 && <><h2>나의 리스크 알림 조건</h2><RiskRules rules={rules} onChange={risk_rules=>setState(s=>({...s,risk_rules}))} busy={busy}/><RiskSummary rules={rules}/></>}
        {step===4 && allocation && <><div className="section-title"><h2>{preference?.name} 기반{cash!==preference?.cash ? ' · 직접 조정':''} 계획</h2><span className="rules-status">아직 주문 전</span></div><div className="setup-final-buckets"><div><small>현금 (이자 수익)</small><strong>{cash}%</strong><span>{money(total*cash/100)}</span></div><div><small>투자</small><strong>{Number((100-cash).toFixed(2))}%</strong><span>{money(investment)}</span></div></div><h3>실제 주문할 종목</h3>{aliases.filter(a=>allocation[a]>0).map(a=><div className="setup-review-row" key={a}><b>{assetName(a)}</b><span>투자금 내 {Number(shares[a].toFixed(2))}% · 전체 {allocation[a]}%</span><strong>{money(total*allocation[a]/100)}</strong></div>)}{investment===0 && <p className="fine">현금 100%이므로 초기 매수 주문은 없어요.</p>}<p className="fine">매수 예산은 수수료 0.05%를 포함해요. 실제 체결 수량·비중은 다음 시가에 따라 달라져요.</p><details><summary>현금 이자 운용 조건</summary><p>{policy}</p><p>{terms}</p></details><h3>함께 정한 리스크 조건</h3><RiskSummary rules={rules}/><label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/><span>함께 만든 구성, 현금 이자 운용 방식과 리스크 알림 조건을 확인했어요. 이후 매매 제안은 다시 승인할게요.</span></label></>}
        <div className="setup-navigation">{step>0 && <button className="btn secondary" disabled={busy} onClick={()=>setState(s=>({...s,step:s.step-1}))}>이전 단계</button>}{step<4 ? <button className="btn primary" disabled={busy || !profile || step===2 && !allocation || step===3 && !validRules(rules)} onClick={()=>setState(s=>({...s,step:s.step+1}))}>{['이 성향으로 계속','투자할 종목 고르기','리스크 조건 상담하기','이 구성 확인하기'][step]}</button> : <button className="btn primary" disabled={busy || !consent || !allocation || !validRules(rules)} onClick={()=>allocation && onReview(allocation,rules)}>이 구성으로 투자 시작</button>}</div>
      </section>
    </div>
  </div>;
}
