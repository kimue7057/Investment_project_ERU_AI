import {FX,krwPerSgd,currencyCode,inputAmount,parseAmount,amountLimits} from './currency';
import './styles.css';
import {markerLayout} from '../reviewModel';
import {t,lang,setLanguage,cycleName,money,typeLabel,eventText,errorText} from './i18n';
import {createViews} from './views';

const app=document.getElementById('app');
const LOGO='/assets/riskguard-logo.webp';
const LAST='eru-btc-last-session-v1';
const cycles=[
  {name:'1차 사이클',period:'2016.07 - 2020.04'},
  {name:'2차 사이클',period:'2020.05 - 2023.06'},
  {name:'3차 사이클',period:'2023.07 - 2026.05'},
];
const state={config:null,run:null,amountDraft:100000000,cycle:0,event:0,busy:false,records:[],error:'',booting:true};
let pollTimer,pollPromise=null,pollFailures=0,lastRoute='',previousFocus=null,toastTimer,chartSerial=0;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=n=>(n>0?'+':'')+money(n);
const percent=n=>(n>0?'+':'')+Number(n).toFixed(1)+'%';
const cycleData=()=>state.run?.cycles[state.cycle];
function route(){const p=location.hash.slice(1)||'home';return ['home','amount','simulation','results','review','records','settings'].includes(p)?p:'home';}
function tabs(action='cycle'){return `<div class="cycle-tabs" role="group" aria-label="${t('Market cycles','사이클 선택')}">${cycles.map((c,i)=>`<button data-action="${action}" data-cycle="${i}" class="${state.cycle===i?'active':''}" aria-pressed="${state.cycle===i}" ${state.run&&i>state.run.current_cycle?'disabled':''}>${cycleName(i)}</button>`).join('')}</div>`;}
function legend(){return `<div class="legend"><span><i></i>${t('Buy & hold','단순 보유')}</span><span><i class="green"></i>${t('Risk Guard','리스크 가드')}</span><small>${currencyCode(lang())}</small></div>`;}
async function api(path,body,keepalive=false){
  let response;try{response=await fetch('/api/bitcoin'+path,{credentials:'same-origin',method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),keepalive});}catch{throw new Error('서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');}
  let data;try{data=await response.json();}catch{throw new Error('서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');}
  if(!response.ok)throw Object.assign(new Error(typeof data.detail==='string'?data.detail:'요청을 처리하지 못했어요.'),{status:response.status});
  return data;
}
function remember(){if(!state.run)return;try{localStorage.setItem(LAST,state.run.id);sessionStorage.setItem('eru-btc-view-'+state.run.id,JSON.stringify({cycle:state.cycle,event:state.event}));}catch{}}
function receive(run,{follow=false}={}){state.run=run;state.amountDraft=run.amount;if(follow||state.cycle>run.current_cycle)state.cycle=run.view_cycle;state.event=Math.min(state.event,Math.max(0,(cycleData()?.events.length||1)-1));remember();}
function errorBox(){return state.error?`<div class="global-error" role="alert"><span>${escape(errorText(state.error))}</span><button data-action="retry">${t('Try again','다시 연결')}</button><button data-action="dismiss-error" aria-label="${t('Dismiss error','오류 닫기')}">×</button></div>`:'';}
function chart(c,{mini=false,markers=false}={}){
  const data=state.run?.cycles[c];const history=data?.history||[];
  if(!history.length)return `<div class="chart-empty">${t('The asset chart appears as this cycle progresses.','해당 구간을 진행하면 자산 곡선이 나타나요.')}</div>`;
  const mobile=matchMedia('(max-width:600px)').matches;
  const width=mini?340:820,height=mini?100:400,left=mini?2:mobile?130:70,right=mini?2:16,top=mini?8:20,bottom=mini?7:34;
  const w=width-left-right,h=height-top-bottom,max=Math.max(...history.map(p=>Math.max(p.hold,p.guard)))*1.12;
  const x=p=>left+w*p.position/100,y=v=>top+h-v/max*h;
  const path=key=>history.map((p,i)=>(i?'L':'M')+x(p).toFixed(2)+','+y(p[key]).toFixed(2)).join(' ');
  const id='area-'+chartSerial++;
  const grid=mini?'':[0,.5,1].map(v=>`<line class="gridline" x1="${left}" x2="${width-right}" y1="${top+h*v}" y2="${top+h*v}"/><text class="svg-label" x="${left-12}" y="${top+h*v+4}" text-anchor="end">${money(max*(1-v))}</text>`).join('');
  const labels=mini?'':`<text class="svg-label" x="${left}" y="${height-4}">${data.start.slice(0,7).replace('-','.')}</text><text class="svg-label" x="${width-right}" y="${height-4}" text-anchor="end">${data.end.slice(0,7).replace('-','.')}</text>`;
  const scale=Math.min(1,Math.max(240,document.querySelector('.chart-frame')?.clientWidth||(mobile?innerWidth-72:820))/820);
  const layout=markers?markerLayout(data.events.map(ev=>({id:ev.id,at:new Date(ev.position*86400000).toISOString(),marker_value:ev.guard_value})),0,100*86400000,{min:0,max},w*scale,h*scale):[];
  const dots=markers?(data.events||[]).map((ev,i)=>{const p=layout[i],cx=left+p.x/100*w,cy=top+p.y/100*h,ax=left+p.anchorX/100*w,ay=top+p.anchorY/100*h;return `<g class="chart-marker" role="button" tabindex="0" data-action="event" data-index="${i}" aria-label="${i+1} · ${ev.at} · ${typeLabel(ev.kind)}"><line x1="${ax}" y1="${ay}" x2="${cx}" y2="${cy}" stroke="#aab6cb" stroke-width="1"/><circle class="chart-mark ${state.event===i?'chosen':''}" cx="${cx}" cy="${cy}" r="${state.event===i?14:12}"/><text class="chart-mark-text ${state.event===i?'chosen':''}" x="${cx}" y="${cy+3.5}" text-anchor="middle">${i+1}</text></g>`;}).join(''):'';
  return `<svg class="asset-chart" viewBox="0 0 ${width} ${height}" role="${markers?'group':'img'}" aria-label="${cycleName(c)} · ${t('Calculated asset comparison','실제 계산된 총자산 비교')}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#278d76" stop-opacity=".12"/><stop offset="1" stop-color="#278d76" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${path('guard')} L${x(history.at(-1))},${top+h} L${left},${top+h}Z" fill="url(#${id})"/><path class="line-hold" d="${path('hold')}"/><path class="line-guard" d="${path('guard')}"/>${dots}${labels}</svg>`;
}
const {home,amount,simulation,liveContent,results,review,recordsPage,settings}=createViews({state,cycles,LOGO,chart,tabs,legend,percent,signed,escape});
function chrome(){
  document.documentElement.lang=lang();
  const page=route(),labels={home:t('Home','홈'),results:t('Results','결과'),records:t('Records','기록'),settings:t('Settings','설정')};
  const paths={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',results:'M4 20V10h4v10M10 20V4h4v16M16 20v-8h4v8',records:'M7 3h10a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2ZM8 8h8M8 12h8M8 16h5',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'};
  document.getElementById('app-navigation').setAttribute('aria-label',t('App navigation','앱 메뉴'));
  document.getElementById('app-navigation').innerHTML=Object.entries(labels).map(([key,label])=>`<a href="#${key}" data-nav="${key}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[key]}"/></svg><span>${label}</span></a>`).join('');
  const back=document.getElementById('header-back');back.hidden=page==='home';back.setAttribute('aria-label',t('Back','뒤로'));
  document.getElementById('header-language').textContent=lang()==='ko'?'한국어':'EN';
  document.getElementById('header-language').setAttribute('aria-label',t('Language settings','언어 설정'));
  document.querySelector('.site-footer').textContent=t('Historical simulation · No real trades · © ERUTY','과거 데이터 기반 모의 시뮬레이션 · 실제 거래 없음 · © ERUTY');
  document.querySelector('meta[name="description"]').content=t('Compare Bitcoin buy-and-hold with Risk Guard across three historical cycles.','세 번의 비트코인 사이클에서 단순 보유와 리스크 가드의 자산 변화를 비교하세요.');
}
function render(){
  clearTimeout(pollTimer);const page=route();chrome();document.body.dataset.view=page;document.querySelectorAll('[data-nav]').forEach(el=>{const yes=el.dataset.nav===page||(el.dataset.nav==='home'&&['amount','simulation'].includes(page))||(el.dataset.nav==='results'&&page==='review');el.classList.toggle('active',yes);if(yes)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  if(state.booting){app.innerHTML=`<div class="page"><section class="empty-state"><div class="loading-ring"></div><h2>${t('Preparing your market','시장을 준비하고 있어요')}</h2><p>${t('Checking verified data and saved records.','검증된 데이터와 이전 기록을 확인해요.')}</p></section></div>`;return;}
  app.innerHTML=errorBox()+({home,amount,simulation,results,review,records:recordsPage,settings}[page])();app.className='screen-enter';
  const timeline=app.querySelector('.review-timeline'),selected=timeline?.querySelector('.active');if(selected)timeline.scrollLeft=selected.offsetLeft-timeline.offsetLeft-timeline.clientWidth/2+selected.clientWidth/2;
  if(page!==lastRoute){if(!matchMedia('(prefers-reduced-motion:reduce)').matches)app.animate([{opacity:.3,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});app.scrollTo({top:0,behavior:'instant'});app.focus({preventScroll:true});lastRoute=page;}
  document.title=({home:t('Bitcoin Risk Guard','비트코인 리스크 가드'),amount:t('Your capital','내 투자금'),simulation:t('Live comparison','자동 비교'),results:t('Your results','비교 결과'),review:t('Response review','대응 복기'),records:t('Your records','내 기록'),settings:t('Settings','설정')}[page])+' · ERU AI';
  schedulePoll();
}
function schedulePoll(){clearTimeout(pollTimer);if(route()==='simulation'&&state.run?.status==='running'&&!document.hidden&&pollFailures<3)pollTimer=setTimeout(poll,1400);}
async function poll(){
  if(state.busy||pollPromise||document.hidden){schedulePoll();return;}const sid=state.run?.id;if(!sid)return;
  pollPromise=(async()=>{try{let g=await api('/sessions/'+sid+'?view='+state.cycle);if(state.run?.id!==sid)return;const old=state.run.current_cycle;if(g.current_cycle!==old&&g.status!=='finished')g=await api('/sessions/'+sid+'?view='+g.current_cycle);receive(g,{follow:g.current_cycle!==old});pollFailures=0;state.error='';if(route()!=='simulation')return;if(g.status==='finished'){navigate('results');return;}const d=cycleData();const live=document.getElementById('live-content');if(live&&d?.metrics)live.innerHTML=liveContent(d,d.events.at(-1));document.querySelectorAll('[data-action="sim-cycle"]').forEach((b,i)=>{b.disabled=i>g.current_cycle;b.classList.toggle('active',i===state.cycle);b.setAttribute('aria-pressed',i===state.cycle?'true':'false');});}catch(e){pollFailures++;state.error=e.message;if(pollFailures>=3)render();}})();
  await pollPromise;pollPromise=null;schedulePoll();
}
async function perform(fn){if(state.busy)return;state.busy=true;document.body.classList.add('is-busy');app.querySelectorAll('button').forEach(b=>b.disabled=true);clearTimeout(pollTimer);if(pollPromise)await pollPromise;try{await fn();state.error='';}catch(e){state.error=e.message;}finally{state.busy=false;document.body.classList.remove('is-busy');render();}}
async function playback(action,speed){if(!state.run)return;const g=await api('/sessions/'+state.run.id+'/playback',{action,...(speed?{speed}:{})});receive(g,{follow:true});if(g.status==='finished'&&action!=='pause')await navigate('results');else render();}
async function navigate(page){
  clearTimeout(pollTimer);if(page!=='simulation'&&state.run?.status==='running'){const g=await api('/sessions/'+state.run.id+'/playback',{action:'pause'});receive(g);}
  if(page==='records')state.records=(await api('/records')).records;
  if(location.hash!=='#'+page)history.pushState(null,'','#'+page);render();
}
function chooseEvent(i){const events=cycleData()?.events||[];state.event=Math.max(0,Math.min(events.length-1,i));remember();render();app.querySelector(`.review-timeline [data-index="${state.event}"]`)?.focus({preventScroll:true});if(matchMedia('(max-width:600px)').matches)app.querySelector('.review-explanation')?.scrollIntoView({behavior:'smooth',block:'start'});}
function toast(text){const el=document.getElementById('toast');el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500);}
async function modal(title,body){if(state.run?.status==='running')await playback('pause');previousFocus=document.activeElement;document.getElementById('modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="${t('Close','닫기')}">×</button><h2 id="modal-title">${title}</h2>${body}</section></div>`;for(const e of [app,document.querySelector('.site-header'),document.querySelector('.bottom-nav'),document.querySelector('.site-footer')])e.inert=true;document.body.style.overflow='hidden';document.querySelector('.modal button').focus();}
function closeModal(){document.getElementById('modal-root').innerHTML='';for(const e of [app,document.querySelector('.site-header'),document.querySelector('.bottom-nav'),document.querySelector('.site-footer')])e.inert=false;document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
function method(){return modal(t('How the comparison works','비교 결과를 읽는 기준'),`<p>${t('All three cycles start independently with the same capital.','세 사이클은 같은 입력 금액으로 독립적으로 계산해요.')}</p><ul class="method-list">${[
['Both accounts begin with 100% Bitcoin at the first daily open of each cycle.','두 계좌 모두 각 사이클의 첫 일봉 시가에서 BTC 100%로 출발해요.'],
['Decisions use completed daily candles. Trades execute at the next daily open.','완료 일봉으로 판단하고 다음 일봉 시가에 분할 매매해요.'],
['A 0.05% fee per side applies to the initial purchase and every trade.','초기 매수와 각 매매에 편도 수수료 0.05%를 반영해요.'],
['English amounts are displayed in SGD; Korean amounts in KRW. The same capital uses the fixed ECB reference cross-rate of 13 November 2026 (1 SGD = '+krwPerSgd.toFixed(2)+' KRW). Historical FX changes, cash interest and slippage are excluded.','USD 가격 변동률을 원화 자본에 적용해요. 환율 변동·현금 이자·슬리피지는 미반영해요.'],
['Maximum drawdown is each account’s largest daily fall from its own peak. Peak dates may differ.','최대 낙폭은 각 계좌의 자체 고점 대비 가장 큰 일별 하락이에요. 고점 날짜는 다를 수 있어요.'],
['A smaller drawdown may come with lower final assets if the strategy misses market rises.','낙폭이 작아져도 상승 참여가 줄어 최종 자산은 단순 보유보다 적을 수 있어요.'],
['Exposure is calculated in internal index units, not actual Bitcoin quantities.','수량은 내부 노출 단위로 계산하며 실제 BTC 개수로 표시하지 않아요.'],
['This is a historical simulation, with no deposit or exchange orders. Past performance does not guarantee future results.','과거 모의 결과로 실제 입금·주문은 없어요. 과거 결과가 미래 성과를 보장하지 않아요.']
].map(([en,ko])=>`<li>${t(en,ko)}</li>`).join('')}</ul><button class="btn dark wide" data-action="close-modal">${t('Got it','확인했어요')}</button>`);}
function flow(){return modal(t('Your comparison journey','투자금부터 대응 복기까지'),`<ol class="flow-list">${[
['Your capital','내 투자금 입력','Start without signing in or getting a code.','로그인과 인증번호 없이 바로 시작해요.'],
['Automatic comparison','세 사이클 자동 비교','Follow both accounts across real historical daily candles.','과거 실제 일봉으로 두 계좌를 함께 계산해요.'],
['Results','결과 확인','Compare drawdowns and final assets together.','낙폭과 종료 자산을 함께 비교해요.'],
['Review responses','대응 복기','Explore signals, simulated trades and asset changes.','신호·모의 체결·자산 변화를 확인해요.']
].map(([en,ko,ed,kd],i)=>`<li><span>0${i+1}</span><div><b>${t(en,ko)}</b><p>${t(ed,kd)}</p></div></li>`).join('')}</ol><button class="btn dark wide" data-action="start-from-flow">${t('Start with my capital','내 투자금으로 시작')} →</button>`);}
function allEvents(){const d=cycleData();return modal(t('All simulated responses','모의 대응 내역 전체 보기'),`<p>${cycleName(state.cycle)} · ${d.all_events.length} ${t('responses','개 대응')}</p><div class="events-scroll"><table class="all-events"><thead><tr><th>${t('Signal / execution','판단 / 체결')}</th><th>${t('Response','대응')}</th><th>${t('Trade value','거래금액')}</th><th>${t('Fee','수수료')}</th></tr></thead><tbody>${d.all_events.map(e=>`<tr><td>${e.signal_at}<br>${e.kind==='wait'?t('No order','주문 없음'):e.at}</td><td>${typeLabel(e.kind)}${e.stage?' · '+e.stage:''}</td><td>${money(e.trade_value)}</td><td>${money(e.fee)}</td></tr>`).join('')}</tbody></table></div><p class="fine">${t('Values use SGD-equivalent indices at the fixed display exchange rate. Waiting does not execute a trade or incur a fee.','금액은 원화 환산 지수예요. 매수 보류는 체결이 아니며 수수료가 없어요.')}</p>`);}
let splashTimer,splashExitTimer,splashFocus;
function splash(){
  clearTimeout(splashTimer);clearTimeout(splashExitTimer);
  const root=document.getElementById('splash'),reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
  splashFocus=document.activeElement;root.setAttribute('aria-label',t('Risk Guard intro','리스크 가드 인트로'));root.hidden=false;root.classList.remove('leaving','video-ready');
  root.innerHTML=`<div class="splash-fallback"><img src="${LOGO}" alt=""><b>RISK GUARD</b><span>ERU AI</span></div>${reduced?'':`<video class="splash-video" autoplay muted playsinline preload="auto" aria-hidden="true"><source src="/assets/riskguard-intro.mp4" type="video/mp4"></video>`}<button data-action="skip-splash" class="splash-skip">${t('Skip','건너뛰기')} ↗</button><div class="splash-caption"><p>${t('Clarity through volatility.','변동 속에서, 더 선명한 판단으로.')}</p><span>BY ERUTY</span></div>`;
  document.querySelector('.app-shell').inert=true;root.querySelector('button').focus({preventScroll:true});
  const video=root.querySelector('video');
  if(video){video.muted=true;video.addEventListener('playing',()=>root.classList.add('video-ready'),{once:true});video.addEventListener('ended',closeSplash,{once:true});video.addEventListener('error',()=>{root.classList.remove('video-ready');splashTimer=setTimeout(closeSplash,2200);},{once:true});video.play().catch(()=>{splashTimer=setTimeout(closeSplash,2600);});}
  splashTimer=setTimeout(closeSplash,reduced?1400:6500);
}
function closeSplash(){
  const root=document.getElementById('splash');if(root.hidden||root.classList.contains('leaving'))return;
  clearTimeout(splashTimer);root.querySelector('video')?.pause();root.classList.add('leaving');document.querySelector('.app-shell').inert=false;
  if(splashFocus?.isConnected&&!root.contains(splashFocus))splashFocus.focus({preventScroll:true});else app.focus({preventScroll:true});
  splashExitTimer=setTimeout(()=>{root.hidden=true;root.classList.remove('video-ready');root.innerHTML='';},300);
}
document.addEventListener('input',e=>{if(e.target.id==='amount-input'){const n=parseAmount(e.target.value,lang());if(n!==null)state.amountDraft=n;document.getElementById('amount-error').textContent='';}});
document.addEventListener('submit',async e=>{
  if(e.target.id==='amount-form'){e.preventDefault();const n=parseAmount(document.getElementById('amount-input').value,lang(),state.amountDraft);if(n===null||n<10000||n>10000000000){const [min,max]=amountLimits('en');document.getElementById('amount-error').textContent=t(`Enter S$${min.toFixed(2)} to S$${max.toLocaleString('en-SG',{minimumFractionDigits:2})}, with up to 2 decimal places.`,'1만 원부터 100억 원까지 숫자로 입력해 주세요.');return;}state.amountDraft=n;await perform(async()=>{if(state.run?.status==='running')await api('/sessions/'+state.run.id+'/playback',{action:'pause'});const run=await api('/sessions',{amount:n.toFixed(2)});state.cycle=0;state.event=0;receive(run,{follow:true});await navigate('simulation');});}
  if(e.target.id==='report-form'){e.preventDefault();if(!state.run||state.run.status!=='finished')return;const email=document.getElementById('report-email').value.trim(),consent=document.getElementById('report-consent').checked,website=document.getElementById('report-website').value;if(!consent)return;const button=e.target.querySelector('button[type="submit"]'),status=document.getElementById('email-status');button.disabled=true;button.textContent=t('Submitting…','메일 발송 접수 중…');try{await api('/sessions/'+state.run.id+'/email',{email,consent,website,locale:lang()});status.textContent=t('Your report was accepted for delivery. Check your inbox and spam folder.','결과와 회사 소개 메일의 발송을 접수했어요. 받은편지함과 스팸함을 확인해 주세요.');button.textContent=t('Request accepted','발송 접수 완료');}catch(err){status.textContent=errorText(err.message);button.disabled=!state.config?.email_ready;button.textContent=t('Try again','다시 요청하기');}}
});
document.addEventListener('click',async e=>{
  const link=e.target.closest('a[href^="#"]');if(link){e.preventDefault();await perform(()=>navigate(link.hash.slice(1)||'home'));return;}
  if(e.target.classList.contains('modal-backdrop'))return closeModal();const el=e.target.closest('[data-action]');if(!el||el.disabled)return;const a=el.dataset.action;
  if(a==='intro'){splash();return;}if(a==='skip-splash'){closeSplash();return;}if(a==='close-modal'){closeModal();return;}if(a==='dismiss-error'){state.error='';render();return;}
  if(a==='language'){setLanguage(el.dataset.language);render();return;}
  if(a==='preset'){state.amountDraft=Number(el.dataset.amount);document.getElementById('amount-input').value=inputAmount(state.amountDraft,lang());document.getElementById('amount-error').textContent='';app.querySelectorAll('[data-action="preset"]').forEach(x=>x.classList.toggle('selected',x===el));return;}
  await perform(async()=>{
    if(a==='settings')await navigate('settings');else if(a==='back')await navigate(({amount:'home',simulation:'amount',review:'results',results:'home',records:'home',settings:'home'})[route()]||'home');else if(a==='begin')await navigate('amount');else if(a==='method')await method();else if(a==='flow')await flow();else if(a==='start-from-flow'){closeModal();await navigate('amount');}
    else if(a==='play')await playback(state.run.status==='running'?'pause':'resume');else if(a==='speed')await playback('speed',Number(el.dataset.speed));else if(a==='next-event')await playback('next');else if(a==='finish')await playback('finish');else if(a==='resume'){await playback('resume');await navigate('simulation');}
    else if(a==='sim-cycle'){state.cycle=Number(el.dataset.cycle);const g=await api('/sessions/'+state.run.id+'?view='+state.cycle);receive(g);render();}
    else if(a==='result-cycle'){state.cycle=Number(el.dataset.cycle);remember();render();document.getElementById('result-detail').scrollIntoView({behavior:'smooth',block:'start'});}
    else if(a==='review-cycle'){state.cycle=Number(el.dataset.cycle);state.event=0;remember();await navigate('review');}
    else if(a==='event'){const i=Number(el.dataset.index);if(route()==='simulation'){const ev=eventText(cycleData().events[i]);await modal(ev.title,`<p>${ev.action}</p><p class="fine" style="margin-top:18px">${t('Signal','판단')} ${ev.signal_at} · ${ev.kind==='wait'?t('No execution','체결 없음'):t('Simulated execution ','모의 체결 ')+ev.at}</p>`);}else chooseEvent(i);}
    else if(a==='event-info'){const ev=eventText(cycleData().events.find(x=>x.id===el.dataset.id));if(ev)await modal(ev.title,`<p>${ev.action}</p>`);}
    else if(a==='previous-review')chooseEvent(state.event-1);else if(a==='next-review')chooseEvent(state.event+1);else if(a==='first-buy'){const i=cycleData().events.findIndex(x=>x.kind==='buy');if(i>=0)chooseEvent(i);else toast(t('No re-entry is included in this cycle’s highlights. Check all responses.','이 구간의 주요 장면에 재매수가 없어요. 전체 대응 내역을 확인해 주세요.'));}
    else if(a==='all-events')await allEvents();else if(a==='next-cycle-review'){state.cycle=(state.cycle+1)%3;state.event=0;remember();render();app.scrollTo({top:0,behavior:'smooth'});}
    else if(a==='results')await navigate('results');else if(a==='records')await navigate('records');
    else if(a==='open-record'||a==='review-record'){const g=await api('/sessions/'+el.dataset.id);receive(g);state.cycle=0;state.event=0;await navigate(a==='review-record'?'review':g.status==='finished'?'results':'simulation');}
    else if(a==='retry'){pollFailures=0;state.config=await api('/config');if(!state.config.ready)throw new Error('검증된 데이터를 준비하고 있어요. 잠시 후 다시 시도해 주세요.');if(state.run)receive(await api('/sessions/'+state.run.id+'?view='+state.cycle));state.error='';render();}
  });
});
document.addEventListener('keydown',e=>{const m=document.querySelector('.modal');if(m){if(e.key==='Escape'){e.preventDefault();closeModal();}else if(e.key==='Tab'){const items=[...m.querySelectorAll('button:not(:disabled),a[href],input')];if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus();}}return;}if((e.key==='Enter'||e.key===' ')&&e.target.matches('.chart-marker')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
window.addEventListener('hashchange',async()=>{try{if(route()!=='simulation'&&state.run?.status==='running')receive(await api('/sessions/'+state.run.id+'/playback',{action:'pause'}));if(route()==='records')state.records=(await api('/records')).records;}catch(e){state.error=e.message;}render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.run?.status==='running')api('/sessions/'+state.run.id+'/playback',{action:'pause'},true).then(receive).catch(()=>{});else if(!document.hidden&&route()==='simulation'&&state.run)perform(async()=>{receive(await api('/sessions/'+state.run.id+'?view='+state.cycle));render();});});
window.addEventListener('pagehide',()=>{if(state.run?.status==='running')api('/sessions/'+state.run.id+'/playback',{action:'pause'},true).catch(()=>{});});
matchMedia('(max-width:600px)').addEventListener('change',()=>{if(!state.booting)render();});
async function boot(){render();splash();try{state.config=await api('/config');if(!state.config.ready)state.error='검증된 비트코인 데이터를 준비하고 있어요. 잠시 후 다시 확인해 주세요.';let sid;try{sid=localStorage.getItem(LAST);}catch{}if(sid){try{let saved;try{saved=JSON.parse(sessionStorage.getItem('eru-btc-view-'+sid)||'null');}catch{}const g=await api('/sessions/'+sid);receive(g,{follow:true});if(saved&&Number.isInteger(saved.cycle)&&saved.cycle>=0&&saved.cycle<=g.current_cycle){state.cycle=saved.cycle;state.event=Number.isInteger(saved.event)?Math.min(Math.max(0,saved.event),Math.max(0,g.cycles[state.cycle].events.length-1)):0;if(g.status!=='finished')receive(await api('/sessions/'+sid+'?view='+state.cycle));}}catch(e){if(e.status!==404)state.error=e.message;}}if(route()==='records')state.records=(await api('/records')).records;}catch(e){state.error=e.message;}state.booting=false;render();}
boot();
