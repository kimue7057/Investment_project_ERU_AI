import { aliases, money, validWeights, type Allocation } from './model';

export default function PlanEditor({value, onChange, total = 100000000, disabled = false}: {
  value: Allocation; onChange: (w: Allocation) => void; total?: number; disabled?: boolean;
}) {
  const sum = Object.values(value).reduce((a,b) => a + b,0);
  return <div className="plan-editor">
    <div className="allocation-bar" aria-label="포트폴리오 배분">
      {(['cash', ...aliases] as const).map(a => <span key={a} className={'segment segment-' + a} style={{flex: Math.max(0, value[a])}} />)}
    </div>
    {(['cash', ...aliases] as const).map(a => <label className="allocation-row" key={a}>
      <span><b>{a === 'cash' ? '현금 (이자 수익)' : '코인 ' + a}</b><small>{a === 'cash' ? '매수에 쓸 수 있는 유동성 자금' : '가격 변동에 따른 투자 손익'}</small></span>
      <span className="allocation-input"><input type="number" aria-label={a === 'cash' ? '현금 비중' : '코인 ' + a + ' 비중'} min="0" max="100" step="0.1" disabled={disabled} value={value[a]} onChange={e => onChange({...value, [a]: e.target.value === '' ? 0 : Number(e.target.value)})}/><span>%</span></span>
      <strong>{money(total * value[a] / 100)}</strong>
    </label>)}
    <div className={'allocation-total ' + (validWeights(value) ? '' : 'invalid')} aria-live="polite"><b>합계 {Number(sum.toFixed(4))}%</b><span>{validWeights(value) ? '전체 자금을 배분했어요' : '합계를 100%로 맞춰 주세요'}</span></div>
  </div>;
}
