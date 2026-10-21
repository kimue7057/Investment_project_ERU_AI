import {aliases, assetName, type RiskRule} from './model';

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
  if (rules==null) return <BuiltInGuardSummary/>;
  const active=rules.filter(r=>r.enabled);
  return <div className="risk-summary">{active.length ? active.map((r,i)=><p key={i}><span aria-hidden="true">●</span> {ruleText(r)}</p>):<p>켜진 리스크 알림이 없어요. 조건에 따른 자동 일시정지도 작동하지 않아요.</p>}<small>도달하면 시장 정지 → 내 대응 선택 → 유지·매매 승인. 자동 손절 주문은 아니에요.</small></div>;
}

export function BuiltInGuardSummary(){
  return <div className="risk-summary" aria-label="위험 감지 기준">
    <p>● 보유한 한 코인의 비중이 전체 자산의 60%를 넘을 때</p>
    <p>● 보유 코인의 확정 주봉 RSI가 75를 넘을 때: 과열·매도 검토</p>
    <p>● 확정 주봉 RSI가 30 미만이고 현금 비중이 20% 이상일 때: 매수 검토</p>
    <p>● 보유 코인의 확정 일봉이 전일보다 10% 넘게 하락할 때</p>
    <small>RSI는 최근 14개 주간 가격 변화의 상승·하락 강도예요. 알림 후 게임 속 90일 동안 추가 자동 알림을 쉬어요. 같은 종목·같은 주봉의 중복 알림도 막아요.</small>
    <small>신호 감지 → 시장 정지 → 내 대응 선택 → 유지·매매 승인. 자동 손절 주문은 아니에요.</small>
  </div>;
}
