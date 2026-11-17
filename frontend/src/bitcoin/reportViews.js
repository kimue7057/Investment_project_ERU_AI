import {t,lang,money,eventText} from './i18n';
import {inputAmount} from './currency';

export const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const pct=n=>(n>0?'+':'')+Number(n).toFixed(1)+'%';
export const fullMoney=n=>lang()==='ko'?inputAmount(n,'ko')+'원':'S$'+inputAmount(n,'en');
export const decisions=c=>(c.all_events||c.response_log||c.events||[]).map(e=>({...e}));

export function summaryRows(c,amount){
 const s=c.summary;
 return [
  [t('Starting capital','시작 금액'),fullMoney(amount),fullMoney(amount)],
  [t('Peak date','고점 발생일'),s.hold.peak_date,s.guard.peak_date],
  [t('Trough date','저점 발생일'),s.hold.trough_date,s.guard.trough_date],
  [t('Balance at trough','저점에 남은 금액'),fullMoney(s.hold.trough_value),fullMoney(s.guard.trough_value)],
  [t('Maximum drawdown','최대 낙폭'),pct(s.hold.max_drawdown_pct),pct(s.guard.max_drawdown_pct)],
  [t('Multiple to recover peak','고점 회복 필요 배수'),s.hold.recovery_multiple.toFixed(2)+'×',s.guard.recovery_multiple.toFixed(2)+'×'],
  [t('Period-end balance','구간 끝 금액'),fullMoney(s.hold.end_value),fullMoney(s.guard.end_value)],
  [t('Period return','구간 수익률'),pct(c.metrics.hold.return_pct),pct(c.metrics.guard.return_pct)],
  [t('Risk Guard activations','리스크 가드 총 발동 횟수'),'—',s.counts.trades+t(' times','회')],
 ];
}

export function recoveryRows(c){
 const r=c.recovery;
 return [
  [t('Capital remaining at market trough','시장 저점에 남은 출발 자금'),fullMoney(r.hold.starting_value),fullMoney(r.guard.starting_value)],
  [t('Same BTC market return','동일한 BTC 구간 수익률'),pct(r.market_return_pct),pct(r.market_return_pct)],
  [t('Gain during this period','상승 구간 손익'),fullMoney(r.hold.profit),fullMoney(r.guard.profit)],
  [t('Balance after the period','상승 구간 끝 금액'),fullMoney(r.hold.end_value),fullMoney(r.guard.end_value)],
  [t('Return vs original capital','최초 고정 금액 대비 수익률'),pct(r.hold.total_return_pct),pct(r.guard.total_return_pct)],
 ];
}
export function recoveryView(c){
 const r=c.recovery;
 return `<section class="report-recovery" id="recovery-metrics"><div class="section-title"><span>${t('02 · THE NEXT MARKET RISE','02 · 그다음 상승장 비교')}</span><h2>${t('What if both amounts simply rode the next rise?','남은 자금으로, 상승장을 그대로 탔다면?')}</h2></div><div class="recovery-period"><b>${r.start} → ${r.end}</b><span>${r.basis==='next_cycle_peak'?t('Next representative cycle peak','다음 대표 사이클 고점까지'):t('Next peak unconfirmed · last verified date','다음 고점 미확인 · 마지막 확인일까지')}</span></div><p class="recovery-method">${t('Both start at the same BTC market trough. Apply the same verified BTC return to each remaining balance, with no further Risk Guard decisions.','같은 BTC 시장 저점일에 남은 두 자금에, 검증된 동일 BTC 수익률을 적용한 비교입니다. 이 구간에는 리스크 가드의 추가 결정이 없습니다.')}</p><table class="report-metrics recovery-table"><colgroup><col style="width:34%"><col style="width:33%"><col style="width:33%"></colgroup><thead><tr><th>${t('Metric','항목')}</th><th>${t('After buy & hold','단순 보유로 남긴 자금')}</th><th>${t('After Risk Guard','리스크 가드로 남긴 자금')}</th></tr></thead><tbody>${recoveryRows(c).map((row,i)=>`<tr class="${i>=2?'key-metric':''}">${row.map((value,j)=>`<${j?'td':'th'}>${escape(value)}</${j?'td':'th'}>`).join('')}</tr>`).join('')}<tr class="recovery-difference"><th>${t('Ending balance difference','상승 후 두 자금 차이')}</th><td colspan="2">${fullMoney(r.ending_gap)}</td></tr><tr><th>${t('Increase in the capital gap','기존 자금 차이의 확대분')}</th><td colspan="2">${fullMoney(r.gap_growth)}</td></tr></tbody></table><p class="metric-note">${t('A reinvestment illustration using historical returns, not a forecast or additional executed trades. Includes cash in the starting balances. Additional entry costs, slippage and FX changes are excluded.','과거 수익률을 적용한 재투자 비교로, 예측이나 추가 체결 내역이 아닙니다. 출발 자금에는 보유 현금이 포함됩니다. 추가 진입 비용·슬리피지·환율 변동은 반영하지 않습니다.')}</p></section>`;
}

export function emailView(state){
 return `<section class="email-entry"><img class="entry-logo" src="/assets/riskguard-logo.webp" alt="Risk Guard"><p class="entry-eyebrow">BITCOIN · RISK GUARD</p><h1>${t('When the market fell,<br>what remained?','하락이 끝났을 때,<br>얼마가 남았을까요?')}</h1><p>${t('Compare completed results, then scroll through every Risk Guard decision.','완료된 결과를 비교하고, 리스크 가드의 결정을 차례로 살펴보세요.')}</p><div class="entry-capital"><span>${t('Fixed simulation capital','고정 시뮬레이션 금액')}</span><b>${lang()==='ko'?'1억 원':'S$100,000'}</b></div><form id="report-email-form"><label for="report-email">${t('Report email','보고서를 받을 이메일')}</label>${state.contact?.registered?`<p class="current-address">${t('Current address','현재 주소')} · ${escape(state.contact.recipient)}</p>`:''}<input id="report-email" type="email" name="email" required autocomplete="email" maxlength="254" placeholder="name@example.com" value="${escape(state.emailDraft)}"><label class="report-consent"><input type="checkbox" id="report-consent" required ${state.consent?'checked':''}><span>${t('I agree to email collection and use for the result report and ERUTY company introduction. No marketing subscription.','결과 보고서와 ERUTY 회사 소개 발송을 위한 이메일 수집·이용에 동의합니다. 마케팅 구독은 하지 않습니다.')}</span></label><label class="report-honeypot" aria-hidden="true">Website<input id="report-website" tabindex="-1" autocomplete="off"></label><button class="entry-submit" type="submit" ${state.busy?'disabled':''}>${state.busy?t('Preparing results…','결과를 준비하고 있어요…'):t('See the results','결과 바로 보기')} →</button></form><p class="entry-note">${t('No login or verification code. Your address is stored for this browser.','로그인·인증번호 없이 진행합니다. 이메일은 이 브라우저의 수신 설정으로 보관합니다.')}</p>${state.report&&state.editing?`<button class="cancel-email" data-action="cancel-email">${t('Back to results','결과로 돌아가기')}</button>`:''}</section>`;
}

function card(raw,index){
 const e=eventText(raw);
 return `<article class="decision-card" data-decision="${index}" id="decision-${index}"><button class="decision-select" data-action="decision" data-index="${index}"><span class="decision-title"><time>${e.at}</time></span><span class="decision-arrow">↗</span></button><p>${escape(e.action)}</p><div class="decision-values"><div><span>${t('Cash after response','대응 후 현금')}</span><b>${money(e.cash_after)}</b></div><div><span>${t('BTC weight','BTC 비중')}</span><b>${e.btc_weight.toFixed(1)}%</b></div></div><div class="decision-gap"><span>${t('Account gap at that close','당일 두 계좌 잔액 차이')}</span><b>${money(e.guard_value-e.hold_value)}</b></div><details><summary>${t('Response details','대응 내용 자세히')} ＋</summary><p>${escape(e.signal)}</p><dl><div><dt>${t('Signal date','판단 일봉')}</dt><dd>${e.signal_at}</dd></div><div><dt>${t('Risk Guard at close','해당일 가드 잔액')}</dt><dd>${fullMoney(e.guard_value)}</dd></div></dl></details></article>`;
}

function steps(stage){
 return `<nav class="report-steps" aria-label="${t('Result steps','결과 확인 단계')}"><span ${stage==='bear'?'aria-current="step"':''}><b>1</b>${t('Bear-market results','하락장 결과')}</span><i>→</i><span ${stage==='recovery'?'aria-current="step"':''}><b>2</b>${t('Next rise comparison','상승장 비교')}</span></nav>`;
}
function cycles(state){
 const recovery=state.stage==='recovery';
 return `<div class="report-cycles" role="group" aria-label="${recovery?t('Choose recovery market','상승장 선택'):t('Choose bear market','하락장 선택')}">${state.report.cycles.map((v,i)=>{
  const period=recovery?v.recovery:v;
  return `<button data-action="cycle" data-index="${i}" class="${state.cycle===i?'active':''}" aria-pressed="${state.cycle===i}"><b>${recovery?t('Rising market','상승장'):t('Bear market','하락장')} ${i+1}</b><span>${period.start.slice(0,4)}–${period.end.slice(0,4)}</span></button>`;
 }).join('')}</div>`;
}
function footer(state){
 return `<section class="report-mail"><span>✉</span><div><h2>${t('Your report email','보고서 수신 이메일')}</h2><p>${escape(state.contact.recipient)}</p><p>${state.config.local_preview?t('Local preview: email is saved; no real email is sent.','로컬 미리보기: 이메일은 저장하며 실제 메일은 발송하지 않습니다.'):state.report.report_delivery?.status==='accepted'?t('Report accepted for delivery. Includes the full review and company introduction.','전체 복기·회사 소개를 포함한 보고서 발송이 접수됐습니다.'):t('View or update your report email.','보고서 수신 이메일을 확인하거나 변경할 수 있습니다.')}</p></div><button data-action="edit-email">${t('Change','변경')}</button></section><footer class="report-footer"><span>ERU AI · RISK GUARD</span><span>${t('Historical simulation · no real trades','과거 데이터 기반 비교 · 실제 거래 없음')}</span><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™ © TradingView, Inc.</a></footer>`;
}
function scorecard(c,amount){
 return `<section class="report-comparison" id="period-metrics"><div class="section-title"><span>${t('PERIOD SCORECARD','하락 구간 결과표')}</span><h2>${t('Results at a glance','하락장 결과, 한눈에 비교하기')}</h2></div><table class="report-metrics"><colgroup><col style="width:34%"><col style="width:33%"><col style="width:33%"></colgroup><thead><tr><th>${t('Metric','항목')}</th><th>${t('Buy & hold','단순 보유')}</th><th>Risk Guard</th></tr></thead><tbody>${summaryRows(c,amount).map((row,i)=>`<tr class="${[3,4,5,6].includes(i)?'key-metric':''}">${row.map((value,j)=>`<${j?'td':'th'}>${escape(value)}</${j?'td':'th'}>`).join('')}</tr>`).join('')}<tr class="recovery-difference"><th>${t('Period-end balance difference','구간 끝 자산 차이')}</th><td colspan="2">${fullMoney(c.metrics.difference)}</td></tr></tbody></table><p class="metric-note">${t('Peak and trough dates refer to each account’s maximum-drawdown pair. They may differ. Trough balance × recovery multiple = the preceding peak balance. Activations count responses that actually changed the allocation.','고점·저점 날짜는 각 계좌의 최대 낙폭 계산 시점이므로 서로 다를 수 있습니다. 저점 잔액 × 회복 필요 배수 = 해당 고점 잔액입니다. 발동 횟수는 실제 자산 비중이 바뀐 대응만 집계합니다.')}</p></section>`;
}
function nextStep(){
 return `<div class="report-next"><p>${t('Next, compare what the remaining capital could become during the next market rise.','다음 단계에서 남은 자금을 상승장에 투자했을 때의 차이를 확인하세요.')}</p><button data-action="next-stage">${t('Next · Ride the market rise','다음 단계 · 지킨 돈으로 상승장 비교')} →</button></div>`;
}
function basis(c){
 const m=c.metrics,cash=m.frozen_allocation.initial_cash_pct;
 return `<details class="report-basis"><summary>${t('Starting cash, preparation & calculation basis','시작 현금·사전 대응·계산 기준')} ＋</summary><p>${t('Cash already held at the market peak','시장 고점일에 이미 확보한 현금')} <b>${cash.toFixed(1)}%</b>. ${t('Each account is independently rebased to the fixed starting capital; earlier gains are excluded.','각 계좌를 고정 시작금으로 독립 환산하며, 이전 수익은 합산하지 않습니다.')}</p><p>${t('Unchanged starting mix at period end','시작 비중을 고정 보유한 종료 잔액')} <b>${money(m.frozen_allocation.value)}</b> · Risk Guard <b>${money(m.guard.value)}</b></p><p>${t('Trading does not always outperform the unchanged mix. Historical periods were selected retrospectively. A daily account gap includes prior trades and market changes, not the isolated profit of one decision.','추가 매매가 비중 고정보다 항상 유리하지는 않습니다. 구간은 과거 데이터를 보고 사후 선정했습니다. 당일 잔액 차이에는 이전 매매와 시장 변화가 함께 반영됩니다.')}</p><details class="preparation-list"><summary>${t('Earlier cash-preparation decisions','하락 전 현금 확보 결정')} ＋</summary>${decisions(c.preparation).map(e=>`<div class="preparation-row"><time>${e.at}</time><span>${escape(eventText(e).action)}</span></div>`).join('')}</details><p>${t('Completed daily signals · next daily open fills. Historical FX movements, cash interest and slippage are excluded.','확정 일봉 판단 · 다음 일봉 시가 체결. 과거 환율 변동·현금 이자·슬리피지는 반영하지 않습니다.')}</p></details>`;
}
function mainChart(c,stage,fallback){
 const r=c.recovery,recovery=stage==='recovery',hold=recovery?r.hold.end_value:c.metrics.hold.value,guard=recovery?r.guard.end_value:c.metrics.guard.value;
 return `<div class="report-chart-pin"><div class="report-chart-heading"><div><span>${recovery?t('CAPITAL THROUGH THE RECOVERY','상승장에서의 자산 변화'):t('CAPITAL THROUGH THE DRAWDOWN','하락장에서의 자산 변화')}</span><b id="chart-date">${recovery?r.end:c.end}</b></div><div class="chart-decision-badge" id="chart-decision">${t('Period complete','구간 종료')}</div></div><div class="chart-mini-balances"><span>${recovery?t('After buy & hold','단순 보유로 남긴 자금'):t('Buy & hold','단순 보유')} <b id="mini-hold">${money(hold)}</b></span><span>${recovery?t('After Risk Guard','리스크 가드로 남긴 자금'):'Risk Guard'} <b id="mini-guard">${money(guard)}</b></span></div><div class="report-native-chart financial-chart-frame" id="report-chart" tabindex="0" role="group" aria-label="${recovery?t('Historical recovery asset comparison','과거 상승 구간 자산 비교 차트'):t('Historical drawdown asset comparison','과거 하락 구간 자산 비교 차트')}">${fallback}</div><div class="report-chart-legend"><span><i class="legend-dot hold"></i>${t('Buy & hold','단순 보유')}</span><span><i class="legend-dot guard"></i>Risk Guard</span>${recovery?'':`<span class="activation-key">● ${t('Activations','발동 지점')}</span>`}<span class="peak-line-key">┄ ${t('Original capital','최초 고정 금액')}</span></div>${recovery?`<p class="scroll-instruction">${t('The same historical BTC movement, with different starting balances. No additional Risk Guard trades.','출발 자금만 다르게, 같은 과거 BTC 흐름을 따라갑니다. 리스크 가드의 추가 매매는 없습니다.')}</p>`:`<p class="scroll-instruction">${t('Open the response review to connect each record to its point on the chart.','대응 기록을 펼치면 각 기록의 위치를 차트에서 확인할 수 있습니다.')}</p>`}</div>`;
}
export function reportView(state,fallbackChart=''){
 const c=state.report.cycles[state.cycle],stage=state.stage==='recovery'?'recovery':'bear',recovery=stage==='recovery';
 const intro=`${steps(stage)}<div class="report-intro"><h1>${recovery?t('The gap grows with the market.','지킨 자금의 차이가, 상승장에서 커집니다.'):t('What remained after the fall?','하락장에서, 얼마를 지켰을까요?')}</h1><p>${t('Fixed capital','고정 시작금')} <b>${lang()==='ko'?'1억 원':'S$100,000'}</b> · ${t('Bitcoin only','비트코인 단독')}</p></div>${cycles(state)}`;
 if(recovery)return `<div class="report-page report-recovery-page">${intro}<div class="report-period"><span>${c.recovery.start}</span><i>→</i><span>${c.recovery.end}</span><em>${c.recovery.basis==='last_confirmed_close'?t('Next peak unconfirmed','다음 고점 미확인'):t('Next cycle peak','다음 사이클 고점')}</em></div><section class="report-analysis">${mainChart(c,stage,fallbackChart)}${recoveryView(c)}</section><button class="report-back" data-action="previous-stage">← ${t('Back to bear-market results','하락장 결과로 돌아가기')}</button>${footer(state)}</div>`;
 return `<div class="report-page report-bear-page">${intro}<div class="report-period"><span>${t('Market peak','시장 고점')} ${c.start}</span><i>→</i><span>${t('Market trough','시장 저점')} ${c.end}</span></div><section class="report-analysis">${mainChart(c,stage,fallbackChart)}${scorecard(c,state.report.amount)}${nextStep()}<details class="report-review"><summary>${t('Review Risk Guard responses','리스크 가드 대응 기록 보기')} ＋</summary><div class="report-decisions">${decisions(c).map(card).join('')}</div></details></section>${basis(c)}${footer(state)}</div>`;
}
