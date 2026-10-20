import Chart from './Chart';
import TradeHistory, { exactMoney, Profit, units } from './TradeHistory';
import { assetName, assetShort, pct, type Alias, type Asset, type GuidedGame } from './model';

export default function AssetDetail({game,selected,asset,busy,onDiscuss}:{game:GuidedGame;selected:Alias;asset?:Asset;busy:boolean;onDiscuss:()=>void}) {
  const held=game.holdings.find(h=>h.asset===selected);
  const result=game.asset_performance.find(p=>p.asset===selected);
  const finished=game.status==='finished';
  return <>
    <div className="guided-layout"><section className="panel"><div className="quote-header"><span className={'asset-badge asset-'+selected}>{assetShort(selected)}</span><div><h2>{assetName(selected)}</h2><div className="quote"><strong>{exactMoney(held?.price??0,8)}</strong><span className={(held?.change_pct??0)>=0?'up':'down'}>{pct(held?.change_pct??0)}</span></div></div></div><Chart key={selected} data={game.chart_asset===selected?game.chart.map(c=>({time:c.time,value:c.close})):[]} label={assetName(selected)+' 확정 일봉'}/><p>{asset?.overview}</p><p className="fine">{asset?.technology} {asset?.supply}</p><ul>{asset?.risks?.map(r=><li key={r}>{r}</li>)}</ul></section>
      <section className="panel asset-position"><h2>내 보유와 투자 손익</h2><dl><div><dt>보유 수량</dt><dd>{units(held?.quantity??0)}개</dd></div><div><dt>평균 매수단가 · 수수료 포함</dt><dd>{exactMoney(result?.average_cost??0,8)}</dd></div><div><dt>남은 매수원가</dt><dd>{exactMoney(result?.remaining_cost??0)}</dd></div><div><dt>현재 평가액</dt><dd>{exactMoney(result?.value??0)}</dd></div><div><dt>보유 중 평가손익</dt><dd><Profit value={result?.unrealized_pnl??0} rate={result?.unrealized_return_pct}/></dd></div><div><dt>누적 매도 실현손익</dt><dd><Profit value={result?.realized_pnl??0}/></dd></div><div className="position-total"><dt>이 종목 총손익</dt><dd><Profit value={result?.total_pnl??0}/></dd></div></dl><p className="fine">총손익은 누적 실현손익과 보유 중 평가손익의 합계예요. 평가손익은 예상 매도 수수료 차감 전이며 현금 이자는 포함하지 않아요.</p>{finished?<p className="fine">투자가 종료됐어요. 보유 수량이 없어도 이전 거래와 손익을 확인할 수 있어요.</p>:<><button className="btn primary wide" disabled={busy||!!game.pending} onClick={onDiscuss}>AI와 매매 검토</button><p className="fine">논의 중에는 시장이 멈추고, 승인한 주문만 자동으로 체결돼요.</p></>}</section></div>
    <section className="panel asset-journal"><TradeHistory trades={game.trades} asset={selected}/></section>
  </>;
}
