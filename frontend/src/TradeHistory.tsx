import { useState } from 'react';
import { assetName, date, type Alias, type FilledTrade } from './model';

export const exactMoney = (n:string|number,digits=2) => Number(n).toLocaleString('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:digits});
export const units = (n:string|number) => Number(n).toLocaleString('ko-KR',{maximumFractionDigits:8});
export function Profit({value,rate}:{value:string|number;rate?:string|null}) {
  const n=Number(value);
  return <span className={n>0?'up':n<0?'down':'pnl-neutral'}>{n>0?'+':''}{exactMoney(n)}{rate!=null && <small> ({Number(rate)>0?'+':''}{Number(rate).toFixed(2)}%)</small>}</span>;
}

export default function TradeHistory({trades,asset}:{trades:FilledTrade[];asset?:Alias}) {
  const [filter,setFilter]=useState<'all'|'buy'|'sell'>('all');
  const all=trades.filter(t=>!asset||t.asset===asset);
  const rows=[...all].reverse().filter(t=>filter==='all'||t.side===filter);
  return <div className="trade-history" aria-label={asset?assetName(asset)+' 거래 내역':'전체 체결 내역'}>
    <div className="section-title"><h2>{asset?assetName(asset)+' 거래 내역':'전체 체결 내역'}</h2><small>{all.length}건 · 최신순</small></div>
    <div className="history-filters" role="group" aria-label="거래 종류 필터">{([['all','전체'],['buy','매수'],['sell','매도']] as const).map(([v,label])=><button key={v} aria-pressed={filter===v} className={filter===v?'selected':''} onClick={()=>setFilter(v)}>{label}</button>)}</div>
    <p className="fine">매도 손익은 평균 매수원가와 매수·매도 수수료를 반영해요. 매수 시점에는 손익이 확정되지 않아요.</p>
    {!rows.length && <div className="history-empty">{!all.length?'아직 이 종목의 체결 내역이 없어요. 주문이 체결되면 여기에 기록돼요.':filter==='sell'?'아직 매도 체결 내역이 없어요.':'아직 매수 체결 내역이 없어요.'}</div>}
    <div className="history-list">{rows.map(t=><article key={t.id} data-trade-id={t.id} className="fill-card" aria-label={assetName(t.asset)+' '+(t.side==='buy'?'매수':'매도')}>
      <header><div><span className={'fill-side '+t.side}>{t.side==='buy'?'매수':'매도'}</span><b>{assetName(t.asset)}</b></div><time dateTime={t.at}>{date(t.at)} {t.at.slice(11,16)}</time></header>
      <small>{t.reason==='initial'?'초기 구성':t.reason==='rebalance'?'비중 조정':'승인 주문'} · 체결 완료</small>
      <dl className="fill-details"><div><dt>체결가</dt><dd>{exactMoney(t.price,8)}</dd></div><div><dt>체결 수량</dt><dd>{units(t.quantity)}개</dd></div><div><dt>거래금액</dt><dd>{exactMoney(t.gross)}</dd></div><div><dt>수수료</dt><dd>{exactMoney(t.fee)}</dd></div><div><dt>{t.side==='buy'?'실제 지급액':'실수령액'}</dt><dd>{exactMoney(Math.abs(Number(t.cash_flow)))}</dd></div><div><dt>{t.side==='buy'?'매수원가 · 수수료 포함':'매도 수량의 매수원가'}</dt><dd>{exactMoney(t.cost_basis)}</dd></div></dl>
      <div className="fill-profit"><span>이번 거래 실현손익</span>{t.realized_pnl===null?<small>매수 · 손익 미확정</small>:<strong><Profit value={t.realized_pnl} rate={t.realized_return_pct}/></strong>}</div>
      <div className="fill-balance"><span>거래 후 보유 {units(t.balance_quantity)}개</span><span>종목 누적 실현손익 <Profit value={t.cumulative_realized}/></span></div>
    </article>)}</div>
  </div>;
}
