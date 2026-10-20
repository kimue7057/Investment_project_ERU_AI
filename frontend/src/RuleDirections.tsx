export const ruleDirections=[
  {title:'손실을 관리하고 싶어요',description:'종목의 매수원가 대비 손실이나 시작 자금 대비 전체 손실을 기준으로 다시 판단해요.',question:'내가 직접 선택한 성향과 자산 구성을 바탕으로 손실 관리 조건을 제안해줘. 매수원가 대비 종목 손실과 시작 자금 대비 전체 손실의 차이, 어떤 판단에 도움이 되는지 먼저 설명하고 적절한 기준을 제안해줘.'},
  {title:'갑작스러운 하락을 확인하고 싶어요',description:'최근 확정 일봉의 하락률을 보고, 급변할 때 매수·유지·매도를 다시 검토해요.',question:'갑작스러운 하락을 확인하는 조건을 만들고 싶어. 직접 선택한 코인의 특징과 하루 가격 하락 지표를 연결해서 기준을 제안해줘. 알림 뒤 매수·유지·매도를 어떻게 검토할지도 설명해줘.'},
  {title:'한 코인에 쏠리지 않게 하고 싶어요',description:'가격이 변한 뒤 한 종목이 전체 자산에서 차지하는 비중을 점검해요.',question:'한 코인에 쏠리지 않도록 점검하는 조건을 제안해줘. 내 초기 비중을 고려하고 종목 쏠림 지표를 쓰는 이유와 기준을 설명해줘. 기존에 선택한 다른 조건이 있으면 유지해줘.'},
];
export default function RuleDirections({busy,onAsk}:{busy:boolean;onAsk:(q:string)=>void}){
  return <section className="panel rule-directions" aria-label="매매 조건의 목적 제안"><div className="eyebrow">이런 기준으로 조건을 만들 수 있어요</div><h2>무엇을 보고 다시 판단할까요?</h2><p>목적을 골라 AI에 제안을 요청하거나, 아래 대화창에 원하는 기준을 이야기해 주세요.</p><div className="rule-direction-grid">{ruleDirections.map(d=><button className="rule-direction" key={d.title} disabled={busy} onClick={()=>onAsk(d.question)}><b>{d.title}</b><span>{d.description}</span><small>이 방향으로 조건 제안받기 →</small></button>)}</div><p className="fine">조건에 도달하면 시장을 멈추고 함께 판단해요. 매수·매도는 대응을 논의한 뒤 직접 승인하며, 초기 매수는 최종 계획 승인 후 다음 일봉 시가에 진행해요.</p></section>;
}
