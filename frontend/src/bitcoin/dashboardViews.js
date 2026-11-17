import {t,money,cycleName,typeLabel,eventText} from './i18n';

export const responseRecords=d=>d?.response_log??d?.all_events??d?.events??[];
export const responseFeedRecords=d=>[...(d.preparation?responseRecords(d.preparation):[]),...responseRecords(d)];

export function createDashboardViews({state,chart,tabs,percent,signed,escape,cycleData,missing,mailPanel}){
 const bear=c=>c?.scenario_kind==='bear';
 const scene=()=>cycleData()?.events[state.event];
 const title=(text,action,label)=>`<div class="workspace-heading"><h1>${text}</h1><button class="quiet-button" data-action="${action}">${label}</button></div>`;
 function selectedPoint(d,review=false){
  if(review&&scene())return {date:scene().at,hold:scene().hold_value,guard:scene().guard_value,btc_weight:scene().btc_weight};
  const rows=d.history||[];
  return Number.isInteger(state.inspectIndex)?rows[Math.min(rows.length-1,Math.max(0,state.inspectIndex))]:null;
 }
 function readout(d,{review=false}={}){
  const point=selectedPoint(d,review),m=d.metrics;
  const h=point?.hold??m.hold.value,g=point?.guard??m.guard.value;
  const ret=v=>(v/state.run.amount-1)*100;
  return `<div class="data-readout"><div class="account-stat"><span><i class="series-dot hold"></i>${t('Buy & hold','단순 보유')}</span><strong>${money(h)}</strong><small class="${ret(h)<0?'negative':'positive'}">${percent(ret(h))}</small></div><div class="account-stat"><span><i class="series-dot guard"></i>Risk Guard</span><strong>${money(g)}</strong><small class="${ret(g)<0?'negative':'positive'}">${percent(ret(g))}</small></div></div>`;
 }
 function allocation(d,review=false){
  const selected=selectedPoint(d,review),row=selected?d.history?.find(p=>p.date===selected.date):d.history?.at(-1);
  if(!Number.isFinite(row?.btc_weight))return '';
  return `<div class="guard-allocation"><span>Risk Guard ${t('mix','보유 비중')}</span><b>BTC ${row.btc_weight.toFixed(1)}%</b><b>${t('Cash','현금')} ${(100-row.btc_weight).toFixed(1)}%</b></div>`;
 }
 function plotLegend(){return `<div class="plot-legend"><span><i class="series-dot hold"></i>${t('Buy & hold','단순 보유')}</span><span><i class="series-dot guard"></i>Risk Guard</span><small>${t('Assets','평가액')}</small></div>`;}
 function dateLine(d,review=false){
  const point=selectedPoint(d,review),date=point?.date||d.date;
  return `<div class="chart-dateline"><time>${date}</time><span>${review?t('Selected response','선택한 대응'):point?t('Selected daily close','선택일 종가'):state.run.status==='running'?t('Playing','자동 재생 중'):t('Daily close','일봉 종가 기준')}</span></div>`;
 }
 function plot(d,{review=false,scrub=true}={}){
  const rows=d.history||[],index=Number.isInteger(state.inspectIndex)?Math.min(rows.length-1,state.inspectIndex):rows.length-1;
  const markers=review||state.run.status!=='finished';
  return `<section class="data-chart" aria-label="${t('Asset chart and date inspection','차트와 날짜 탐색')}"><div data-chart-readout>${dateLine(d,review)}${readout(d,{review})}${allocation(d,review)}</div><div class="chart-frame" data-responsive-chart data-cycle="${state.cycle}" data-markers="${markers}" data-mode="assets">${chart(state.cycle,{markers,mode:'assets'})}</div>${plotLegend()}${scrub&&!review&&rows.length>1?`<label class="scrubber-label"><span>${t('Explore dates','날짜별 살펴보기')}</span><span>${state.run.status==='running'?t('Pause to explore','일시정지 후 탐색'):t('Slide to inspect','좌우로 움직여 확인')}</span><input class="chart-scrubber" type="range" min="0" max="${rows.length-1}" value="${Math.max(0,index)}" step="1" data-chart-scrub aria-label="${t('Inspect daily asset values','날짜별 자산 확인')}" ${state.run.status==='running'?'disabled':''}></label>`:''}</section>`;
 }
 function phaseBar(d){
  if(!bear(d))return `<div class="compact-phase">${t('Original full-cycle record','이전 전체 사이클 기록')}</div>`;
  const pre=d.phase==='preparation';
  return `<details class="phase-disclosure" data-detail-key="phase"><summary><span class="phase-chip ${pre?'preparation':'bear'}">${pre?'01':'02'} ${pre?t('Before the decline','하락 전 운용'):t('Bear market','하락장 비교')}</span><span>${pre?t('Assets from the original start','입력금으로 시작한 사전 운용 자산'):t('Equal starting value','동일 금액 기준 비교')}</span><i>ⓘ</i></summary><p>${pre?t('The chart compares both account values during the original preparation period. Cash is part of the Risk Guard balance. At the following bear-market start, both accounts are separately rebased to the input capital; earlier gains are not carried into that comparison.','사전 운용에서도 두 계좌의 평가액을 비교해요. 현금은 리스크 가드 자산에 포함돼요. 다음 하락장 시작에는 각 계좌를 입력금으로 따로 환산하며, 이전 수익은 하락장 비교에 합산하지 않아요.'):t(`Each account is rebased to ${money(state.run.amount)} at the first close. The guard keeps its earlier cash mix. This is not a fresh 100% Bitcoin purchase.`,`하락 시작 종가에서 각 계좌를 ${money(state.run.amount)} 기준으로 환산해요. 가드는 이전 현금 비중을 유지하며, BTC 100%로 새로 매수한 결과가 아니에요.`)}</p></details>`;
 }
 function player(){
  const run=state.run;
  return `<section class="player-panel" aria-label="${t('Playback controls','재생 조작')}"><div class="player-progress"><progress data-run-progress max="300" value="${run.elapsed}" aria-label="${t('Overall playback progress','전체 재생 진행')}"></progress><span data-run-progress-label>${Math.floor(run.elapsed/3)}%</span></div><div class="player-buttons"><button class="player-toggle" data-action="play" aria-label="${run.status==='running'?t('Pause playback','재생 일시정지'):t('Play','재생 시작')}" ${run.status==='finished'?'disabled':''}>${run.status==='running'?'Ⅱ':'▶'}</button><div class="speed-controls" role="group" aria-label="${t('Playback speed','재생 속도')}">${[1,4,8].map(n=>`<button data-action="speed" data-speed="${n}" aria-pressed="${run.speed===n}" class="${run.speed===n?'active':''}">${n}×</button>`).join('')}</div><button class="next-scene-button" data-action="next-event" ${run.status==='finished'?'disabled':''}>${t('Next response','다음 대응')} →</button></div></section>`;
 }
 function liveContent(d,event){
  return `${phaseBar(d)}${plot(d)}`;
 }
 function responseLog(root){
  const events=responseFeedRecords(root).reverse();
  const row=e=>`<button class="response-record" data-action="response-info" data-id="${escape(e.id)}" data-phase="${e.phase||root.phase||'bear'}"><span class="response-record-top"><b class="response-kind ${e.kind}">${typeLabel(e.kind)}</b><time>${e.at}</time><i>↗</i></span><span class="response-record-main">${e.kind==='wait'?t('No order · position maintained','주문 없이 기존 비중 유지'):`${t('Trade value','거래금액')} <b>${money(e.trade_value)}</b>`}</span><span class="response-record-cash">${t('Cash after','대응 후 현금')} <b>${money(e.cash_after)}</b> · BTC ${e.btc_weight.toFixed(1)}%</span><span class="response-record-timing">${t('Signal','판단')} ${e.signal_at} → ${e.kind==='wait'?t('Wait','보류'):t('Next-open fill','다음 시가 체결')} ${e.at}${root.preparation?` · ${e.phase==='preparation'?t('Before decline','하락 전'):t('Bear market','하락장')}`:''}</span></button>`;
  return `<div class="response-feed-heading"><h2>${t('Risk Guard activity','리스크 가드 대응 기록')}</h2><span>${events.length} ${t('responses','건')}</span></div><p class="response-feed-note">${t('Only responses reached in playback are recorded. Tap for details.','진행된 시점까지 차곡차곡 기록해요. 누르면 상세 내역을 볼 수 있어요.')}</p>${events.length?events.slice(0,3).map(row).join(''):`<p class="response-feed-empty">${t('No response yet. Confirmed actions will appear here as playback advances.','아직 대응이 없어요. 재생 중 신호가 확인되면 기록이 여기에 추가돼요.')}</p>`}${events.length>3?`<details class="data-details response-history" data-detail-key="response-history-${state.cycle}"><summary>${t('Earlier responses','이전 대응 기록')} (${events.length-3})<span>＋</span></summary>${events.slice(3).map(row).join('')}</details>`:''}`;
 }
 function simulation(){
  if(!state.run)return missing();const d=state.run.cycles[state.cycle];if(!d?.metrics)return missing();
  return `<div class="page workspace simulation-workspace">${title(t('Market replay','시장 재생'),'finish',t('See results ↗','결과 보기 ↗'))}${tabs('sim-cycle')}<div class="dashboard-grid"><section class="visual-panel"><div id="live-content">${liveContent(d)}</div>${player()}</section><aside class="context-panel response-feed" id="response-log">${responseLog(d)}</aside></div></div>`;
 }
 function resultMetrics(d){
  const m=d.metrics;
  return `<details class="data-details" data-detail-key="metrics"><summary>${t('Losses, drawdowns & fees','손실·최대 낙폭·수수료 상세')}<span>＋</span></summary><div class="table-scroll"><table class="comparison-table"><thead><tr><th>${t('Metric','항목')}</th><th>${t('Buy & hold','단순 보유')}</th><th>Risk Guard</th></tr></thead><tbody>${[
   [t('Period P/L','구간 손익'),signed(m.hold.profit),signed(m.guard.profit)],
   [t('Period return','구간 수익률'),percent(m.hold.return_pct),percent(m.guard.return_pct)],
   [t('Max drawdown','최대 낙폭'),percent(m.hold.mdd_pct),percent(m.guard.mdd_pct)],
   [t('Recovery required','낙폭 회복 필요 상승률'),'+'+m.hold.recovery_pct.toFixed(1)+'%','+'+m.guard.recovery_pct.toFixed(1)+'%'],
   [t('Cash at end','종료 현금'),money(0),money(m.guard_cash)],
   [t('BTC weight at end','종료 BTC 비중'),'100%',m.guard_btc_weight.toFixed(1)+'%'],
   [t('Trading fees','매매 수수료'),bear(d)?money(0):t('Initial purchase','초기 매수'),money(m.guard_fees)],
  ].map(row=>`<tr>${row.map((v,i)=>`<${i?'td':'th'}>${v}</${i?'td':'th'}>`).join('')}</tr>`).join('')}</tbody></table></div><p class="fine">${t('Drawdown uses each account’s own peak. Recovery required is a calculation, not a forecast.','최대 낙폭은 각 계좌의 자체 고점 기준이에요. 회복 필요 상승률은 계산값이며 미래 예측이 아니에요.')}</p></details>`;
 }
 function context(d){
  if(!bear(d))return `<p class="fine">${t('Original full-cycle results. Smaller drawdowns may come with lower final assets.','이전 전체 사이클의 결과예요. 낙폭이 작아도 최종 자산은 더 적을 수 있어요.')}</p>`;
  const f=d.metrics.frozen_allocation,c=d.full_cycle_context;
  return `<section class="benchmark-panel"><div class="section-heading"><h2>${t('Cash matters too','현금 보유 효과도 함께')}</h2><span>${f.initial_cash_pct.toFixed(1)}% ${t('cash at start','시작 현금')}</span></div><p>${t('The same starting mix, held without further trades.','같은 시작 BTC·현금 비중으로 추가 매매 없이 보유한 비교예요.')}</p><div class="benchmark-row"><span>${t('Unchanged mix','비중 고정')}</span><b>${percent(f.return_pct)} · ${money(f.value)}</b></div><div class="benchmark-row"><span>Risk Guard</span><b>${percent(d.metrics.guard.return_pct)} · ${money(d.metrics.guard.value)}</b></div><p class="fine">${t('Additional trading is not always better than holding the same mix.','추가 매매가 비중 고정보다 항상 유리하지는 않아요.')}</p></section><details class="data-details" data-detail-key="basis"><summary>${t('Starting basis & cash preparation','시작 기준과 현금 확보 과정')}<span>＋</span></summary><p>${d.preparation.start} — ${d.preparation.end}</p><p>${t(`Each account starts this decline at ${money(state.run.amount)}, rebased from the original portfolio. The guard inherits its cash mix. Earlier gains are excluded.`,`하락 시작 시 각 계좌를 ${money(state.run.amount)} 기준으로 환산했어요. 가드는 이전 현금 비중을 이어받으며 이전 수익은 합산하지 않아요.`)}</p><button class="text-link" data-action="review-preparation">${t('Review cash preparation','현금 확보 과정 복기')} →</button></details>${c?`<details class="data-details" data-detail-key="full-cycle"><summary>${t('Original full-cycle outcome','기존 전체 사이클 결과')}<span>＋</span></summary><p>${c.start} — ${c.end}</p><div class="benchmark-row"><span>${t('Buy & hold','단순 보유')}</span><b>${money(c.hold_value)}</b></div><div class="benchmark-row"><span>Risk Guard</span><b>${money(c.guard_value)}</b></div><p class="fine">${t('Uses original capital, separately from the rebased bear-period comparison.','원래 시작 자금 기준으로, 위 하락장 환산 금액과는 별개예요.')}</p></details>`:''}`;
 }
 function resultHero(d){
  const gap=d.metrics.difference;
  return `<section class="result-hero"><span>${t('Final balance difference · guard − hold','종료 잔액 차이 · 가드 − 단순 보유')}</span><strong class="${gap>=0?'positive':'negative'}">${signed(gap)}</strong><p>${t(`Equal starting value: ${money(state.run.amount)}`,`같은 시작 비교 금액 ${money(state.run.amount)} 기준`)}</p></section>`;
 }
 function results(){
  if(!state.run)return missing();
  if(state.run.status!=='finished')return `<div class="page workspace">${title(t('Your results','비교 결과'),'resume',t('Resume','이어서 재생'))}<section class="empty-state"><h2>${t('Your comparison is still running','아직 비교 중이에요')}</h2><p>${t('Continue playback or finish the remaining period.','재생을 이어가거나 남은 기간을 마쳐 주세요.')}</p><button class="btn dark" data-action="finish">${t('Finish & see results','마치고 결과 보기')} →</button></section></div>`;
  const d=state.run.cycles[state.cycle],delivery=state.run.report_delivery;
  return `<div class="page workspace results-workspace">${title(t('Your results','비교 결과'),'begin',t('New comparison','새 비교'))}${tabs('result-cycle')}<div class="dashboard-grid"><section class="visual-panel"><div id="result-detail">${resultHero(d)}<div class="period-caption">${d.start} — ${d.end}</div>${plot(d)}<button class="btn dark wide inline-review" data-action="review-cycle" data-cycle="${state.cycle}">${t('Review the responses','이 구간 대응 복기')} →</button></div></section><aside class="context-panel">${context(d)}${resultMetrics(d)}<section class="period-overview"><h2>${t('All three periods','세 하락장 한눈에')}</h2>${state.run.cycles.map((c,i)=>`<button data-action="result-cycle" data-cycle="${i}" class="period-overview-row ${i===state.cycle?'selected':''}"><span>${cycleName(i)}</span><span>${percent(c.metrics.hold.return_pct)}<small>${t('hold','단순 보유')}</small></span><span>${percent(c.metrics.guard.return_pct)}<small>Guard</small></span><b>›</b></button>`).join('')}</section><details class="data-details delivery-details" data-detail-key="delivery"><summary><span>✉ ${delivery?.status==='accepted'?t('Report accepted','보고서 발송 접수'):delivery?.status==='failed'?t('Email needs attention','이메일 발송 확인'):t('Report delivery','보고서 수신 상태')}</span><span>＋</span></summary>${mailPanel()}</details><button class="method-link" data-action="method">${t('Methodology & scope','계산 기준과 반영 범위')} ↗</button><p class="scope-caption">${t('Historical periods selected retrospectively. Period returns differ from full-cycle returns and are not predictions.','사후 선정한 하락 구간의 결과로, 전체 사이클 수익과 다르며 미래 예측이 아니에요.')}</p></aside></div></div>`;
 }
 function sceneCard(d,e){
  const events=d.events;
  return `<section class="scene-card" aria-label="${t('Selected response details','선택한 대응 상세')}"><div class="scene-navigation"><button data-action="previous-review" aria-label="${t('Previous response','이전 대응')}" ${state.event===0?'disabled':''}>←</button><span>${t('Response','대응')} <b>${state.event+1}</b> / ${events.length}</span><button data-action="next-review" aria-label="${t('Next response','다음 대응')}" ${state.event===events.length-1?'disabled':''}>→</button></div><div class="scene-card-heading"><span class="response-kind ${e.kind}">${typeLabel(e.kind)}</span><time>${e.at}</time></div><h2>${e.title}</h2><p>${e.action}</p><div class="scene-facts"><span>${t('Cash after','대응 후 현금')}<b>${money(e.cash_after)}</b></span><span>${t('Bitcoin weight','BTC 비중')}<b>${e.btc_weight.toFixed(1)}%</b></span>${e.kind!=='wait'?`<span>${t('Trade value','거래금액')}<b>${money(e.trade_value)}</b></span>`:''}</div><details class="data-details" data-detail-key="scene"><summary>${t('Signal, execution & fees','판단·체결·수수료 상세')}<span>＋</span></summary><p>${e.signal}</p><div class="benchmark-row"><span>${t('Signal close','판단 일봉')}</span><b>${e.signal_at}</b></div><div class="benchmark-row"><span>${e.kind==='wait'?t('No order','주문 없음'):t('Next-open execution','다음 시가 체결')}</span><b>${e.at}</b></div><div class="benchmark-row"><span>${t('Fee','수수료')}</span><b>${money(e.fee)}</b></div></details></section>`;
 }
 function review(){
  if(!state.run||state.run.status!=='finished')return missing(t('Finish the comparison to review responses','비교를 마치면 대응을 복기할 수 있어요'));
  const root=state.run.cycles[state.cycle],d=cycleData(),events=d.events,e=eventText(events[state.event]);
  if(!e)return missing(t('No response scenes in this period','이 구간에는 대응 장면이 없어요'));
  return `<div class="page workspace review-workspace">${title(t('Response review','대응 복기'),'results',t('Results','결과'))}${tabs('review-cycle')}${root.preparation?`<div class="review-phase-tabs" role="group" aria-label="${t('Review phase','복기 구간')}">${[['preparation',t('Cash preparation','현금 확보')],['bear',t('Bear market','하락장 대응')]].map(([key,label])=>`<button data-action="review-phase" data-phase="${key}" aria-pressed="${state.reviewPhase===key}" class="${state.reviewPhase===key?'active':''}">${label}</button>`).join('')}</div>`:''}<div class="dashboard-grid review-grid"><section class="visual-panel review-visual">${plot(d,{review:true,scrub:false})}<div class="review-timeline" role="group" aria-label="${t('Response timeline','대응 장면 목록')}">${events.map((ev,i)=>`<button data-action="event" data-index="${i}" aria-pressed="${state.event===i}" class="${state.event===i?'active':''}"><span>${String(i+1).padStart(2,'0')}</span><b>${typeLabel(ev.kind)}</b><small>${ev.at.slice(2)}</small></button>`).join('')}</div><p class="scope-caption">${state.reviewPhase==='preparation'&&root.preparation?t('Original preparation mix, before the equal-value comparison.','동일 금액 비교 전, 사전 운용의 현금·BTC 비중이에요.'):t('Same starting comparison value. Earlier cash is carried forward.','같은 시작 비교 금액 기준이며 이전 현금을 이어받아요.')}</p></section><aside class="context-panel scene-panel">${sceneCard(d,e)}<button class="method-link" data-action="all-events">${t('All simulated responses','전체 모의 대응 내역')} (${d.all_events.length}) ↗</button><p class="scope-caption">${t('The chart highlights selected and representative responses. All scenes remain in the timeline. The gap includes market changes and multiple trades, not one action alone.','차트에는 선택·대표 대응만 표시하며 전체 장면은 목록에서 볼 수 있어요. 자산 차이에는 시장 변화와 여러 매매가 함께 반영돼요.')}</p></aside></div></div>`;
 }
 return {simulation,liveContent,responseLog,results,review,chartReadout:(d,review=false)=>dateLine(d,review)+readout(d,{review})+allocation(d,review)};
}
