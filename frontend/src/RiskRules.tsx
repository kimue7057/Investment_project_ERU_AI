import {aliases, assetName, type RiskRule} from './model';

export const defaultRiskRules:RiskRule[] = [
  {metric:'concentration',asset:'held',threshold:60,enabled:true},
  {metric:'asset_loss',asset:'held',threshold:15,enabled:true},
  {metric:'daily_drop',asset:'held',threshold:10,enabled:true},
  {metric:'portfolio_loss',asset:'portfolio',threshold:10,enabled:true},
];
export const riskMetrics = {concentration:'한 종목 쏠림',asset_loss:'매수원가 대비 손실',daily_drop:'하루 가격 하락',portfolio_loss:'전체 자산 손실'};
export function validRules(rules:unknown):rules is RiskRule[] {
  if (!Array.isArray(rules) || rules.length>8) return false;
  const keys=new Set<string>();
  return rules.every(r=>{
    if (!r || Object.keys(r).sort().join(',')!=='asset,enabled,metric,threshold' || !Object.hasOwn(riskMetrics,r.metric) ||
        !['held','portfolio',...aliases].includes(r.asset) || (r.metric==='portfolio_loss')!==(r.asset==='portfolio') ||
        typeof r.enabled!=='boolean' || !Number.isFinite(r.threshold) || r.threshold<=0 || r.threshold>100 || Math.abs(r.threshold*100-Math.round(r.threshold*100))>1e-8) return false;
    const key=r.metric+':'+r.asset;if(keys.has(key))return false;keys.add(key);return true;
  });
}
export function ruleText(r:RiskRule) {
  const target=r.asset==='portfolio'?'전체 자산':r.asset==='held'?'보유한 각 코인':assetName(r.asset);
  const metric={concentration:'전체 자산 내 비중이',asset_loss:'매수원가 대비 평가손실이',daily_drop:'최근 확정 일봉 하락률이',portfolio_loss:'시작 자금 대비 손실이'}[r.metric];
  return `${target}의 ${metric} ${r.threshold}% 이상이면 알림`;
}
export function RiskSummary({rules}:{rules:RiskRule[]|null|undefined}) {
  if (rules==null) return <p className="fine">기존 기본 리스크 가드를 사용 중이에요.</p>;
  const active=rules.filter(r=>r.enabled);
  return <div className="risk-summary">{active.length ? active.map((r,i)=><p key={i}><span aria-hidden="true">●</span> {ruleText(r)}</p>):<p>켜진 리스크 알림이 없어요. 조건에 따른 자동 일시정지도 작동하지 않아요.</p>}<small>도달하면 시장 정지 → AI와 대응 논의 → 유지·매매 승인. 자동 손절 주문은 아니에요.</small></div>;
}
export default function RiskRules({rules,onChange,busy}:{rules:RiskRule[];onChange:(rules:RiskRule[])=>void;busy:boolean}) {
  function update(i:number,patch:Partial<RiskRule>){onChange(rules.map((r,j)=>j===i?{...r,...patch}:r));}
  function add(){
    const candidates=(['held',...aliases,'portfolio'] as const).flatMap(asset=>Object.keys(riskMetrics).map(metric=>({asset,metric})))
      .filter(c=>(c.metric==='portfolio_loss')===(c.asset==='portfolio') && !rules.some(r=>r.metric===c.metric&&r.asset===c.asset));
    if(candidates.length)onChange([...rules,{...candidates[0],metric:candidates[0].metric as RiskRule['metric'],threshold:10,enabled:true}]);
  }
  return <div className="risk-editor"><p className="setup-caption">왼쪽 AI에게 “새벽코인이 매수원가보다 8% 떨어지면 알려줘”처럼 말해보세요. 제안을 초안에 담고, 여기서 기준을 조정할 수 있어요.</p>
    {rules.map((r,i)=><article className={'risk-rule '+(!r.enabled?'disabled':'')} key={i}>
      <div className="section-title"><label className="risk-toggle"><input type="checkbox" aria-label={`리스크 조건 ${i+1} 사용`} checked={r.enabled} disabled={busy} onChange={e=>update(i,{enabled:e.target.checked})}/>조건 {i+1}</label><button className="btn secondary" aria-label={`리스크 조건 ${i+1} 삭제`} disabled={busy} onClick={()=>onChange(rules.filter((_,j)=>j!==i))}>삭제</button></div>
      <div className="risk-fields"><label>알림 기준<select aria-label={`조건 ${i+1} 지표`} disabled={busy} value={r.metric} onChange={e=>{const metric=e.target.value as RiskRule['metric'];update(i,{metric,asset:metric==='portfolio_loss'?'portfolio':r.asset==='portfolio'?'held':r.asset});}}>{Object.entries(riskMetrics).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <label>대상<select aria-label={`조건 ${i+1} 대상`} value={r.asset} disabled={busy||r.metric==='portfolio_loss'} onChange={e=>update(i,{asset:e.target.value as RiskRule['asset']})}>{r.metric==='portfolio_loss'?<option value="portfolio">전체 자산</option>:<><option value="held">보유한 모든 코인에 각각</option>{aliases.map(a=><option key={a} value={a}>{assetName(a)}</option>)}</>}</select></label>
      <label>이상일 때 (%)<input type="number" aria-label={`조건 ${i+1} 기준`} value={r.threshold} min=".01" max="100" step=".01" disabled={busy} onChange={e=>update(i,{threshold:Number(e.target.value)})}/></label></div>
      <p>{ruleText(r)}{!r.enabled?' · 꺼짐':''}</p></article>)}
    <button className="btn secondary" disabled={busy||rules.length>=8} onClick={add}>조건 추가</button><p className="fine">최대 8개 · 켜진 조건 중 하나라도 도달하면 멈춰요. 같은 지표·대상은 한 번만 설정해 주세요.</p>
    {!validRules(rules)&&<p className="message error" role="alert">기준은 0 초과 100% 이하, 소수 둘째 자리까지 입력하고 중복 조건을 합쳐주세요.</p>}
    <details><summary>어떤 값으로 판단하나요?</summary><p className="fine">종목 손실은 수수료 포함 이동평균 매수원가와 현재 평가액을 비교해요. 하루 하락은 확정된 두 일봉 종가를 비교해요. 전체 손실은 시작 자금 1억 원과 미수이자를 포함한 총자산을 비교해요. 예상 매도 수수료는 차감 전이에요. 충족이 이어지면 같은 조건·종목은 게임 7일 뒤 다시 알리고, 기준을 벗어났다가 다시 도달하면 새로 알려요.</p></details>
  </div>;
}
