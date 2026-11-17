import {FX,krwPerSgd,currencyCode,inputAmount,parseAmount,amountLimits,defaultCapital} from './currency';
import './styles.css';
import './dashboard.css';
import {renderAssetChart,chartGeometry} from './chartView';
import {t,lang,setLanguage,setCycleMode,cycleName,money,typeLabel,eventText,errorText} from './i18n';
import {createViews} from './views';

const app=document.getElementById('app');
const LOGO='/assets/riskguard-logo.webp';
const LAST='eru-btc-last-session-v1';
const cycles=[
  {name:'1차 사이클',period:'2017.12.16 - 2018.12.15'},
  {name:'2차 사이클',period:'2021.11.08 - 2022.11.21'},
  {name:'3차 사이클',period:'2025.10.06 - 2026.02.05'},
];
const state={config:null,contact:null,emailEditing:false,run:null,amountDraft:defaultCapital(lang()),amountEdited:false,reportEmailDraft:'',reportConsent:false,cycle:0,event:0,reviewPhase:'bear',inspectIndex:null,phaseChanged:false,busy:false,records:[],error:'',booting:true};
let pollTimer,pollPromise=null,pollFailures=0,lastRoute='',previousFocus=null,toastTimer,chartSerial=0;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed=n=>(n>0?'+':'')+money(n);
const percent=n=>(n>0?'+':'')+Number(n).toFixed(1)+'%';
const cycleData=()=>{const c=state.run?.cycles[state.cycle];return route()==='review'&&state.reviewPhase==='preparation'&&c?.preparation?c.preparation:c;};
function route(){if(!state.booting&&!state.contact?.registered)return 'email';const p=location.hash.slice(1)||'home';return ['home','email','amount','simulation','results','review','records','settings'].includes(p)?p:'home';}
function tabs(action='cycle'){return `<div class="cycle-tabs" role="group" aria-label="${t('Market cycles','사이클 선택')}">${cycles.map((c,i)=>`<button data-action="${action}" data-cycle="${i}" class="${state.cycle===i?'active':''}" aria-pressed="${state.cycle===i}" ${state.run&&i>state.run.current_cycle?'disabled':''}>${cycleName(i)}</button>`).join('')}</div>`;}
function legend(){return `<div class="legend"><span><i></i>${t('Buy & hold','단순 보유')}</span><span><i class="green"></i>${t('Risk Guard','리스크 가드')}</span><small>${currencyCode(lang())}</small></div>`;}
async function api(path,body,keepalive=false){
  let response;try{response=await fetch('/api/bitcoin'+path,{credentials:'same-origin',method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),keepalive});}catch{throw new Error('서버에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');}
  let data;try{data=await response.json();}catch{throw new Error('서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');}
  if(!response.ok)throw Object.assign(new Error(typeof data.detail==='string'?data.detail:'요청을 처리하지 못했어요.'),{status:response.status});
  return data;
}
function remember(){if(!state.run)return;try{localStorage.setItem(LAST,state.run.id);sessionStorage.setItem('eru-btc-view-'+state.run.id,JSON.stringify({cycle:state.cycle,event:state.event,phase:state.reviewPhase}));}catch{}}
function receive(run,{follow=false}={}){const prior=state.run?.cycles[state.cycle]?.phase;state.run=run;if(run.status==='running')state.inspectIndex=null;if(follow||state.cycle>run.current_cycle)state.cycle=run.view_cycle;state.phaseChanged=state.phaseChanged||Boolean(route()==='simulation'&&prior&&prior!==run.cycles[state.cycle]?.phase);state.event=Math.min(state.event,Math.max(0,(cycleData()?.events.length||1)-1));remember();}
function errorBox(){return state.error?`<div class="global-error" role="alert"><span>${escape(errorText(state.error))}</span><button data-action="retry">${t('Try again','다시 연결')}</button><button data-action="dismiss-error" aria-label="${t('Dismiss error','오류 닫기')}">×</button></div>`:'';}
function chartData(index){const c=state.run?.cycles[index];return route()==='review'&&state.reviewPhase==='preparation'&&c?.preparation?c.preparation:c;}
function chartHeight(width){return width>550?340:Math.max(215,Math.min(270,Math.round(innerHeight*.305)));}
function chart(index,{mini=false,markers=false,mode='assets',width}={}){
  const data=chartData(index);width=width||Math.max(240,Math.min(1080,document.getElementById('app').clientWidth-32));
  return renderAssetChart(data||{}, {width,height:mini?100:chartHeight(width),mode,markers,selected:route()==='review'?state.event:null,focusIndex:state.inspectIndex});
}
function fitCharts(){
  app.querySelectorAll('[data-responsive-chart]').forEach(frame=>{
    const width=Math.round(frame.clientWidth);if(width<100)return;
    frame.innerHTML=chart(Number(frame.dataset.cycle),{width,markers:frame.dataset.markers==='true',mode:frame.dataset.mode});
  });
}
function preserveDetails(){return [...app.querySelectorAll('details[open][data-detail-key]')].map(el=>el.dataset.detailKey);}
function restoreDetails(keys){app.querySelectorAll('details[data-detail-key]').forEach(el=>{if(keys.includes(el.dataset.detailKey))el.open=true;});}
function inspectChart(index){
 const d=cycleData();if(!d?.history.length||state.run.status==='running')return;
 state.inspectIndex=Math.max(0,Math.min(d.history.length-1,index));
 app.querySelectorAll('[data-chart-readout]').forEach(el=>{el.innerHTML=chartReadout(d);});
 app.querySelectorAll('[data-chart-scrub]').forEach(el=>{el.value=state.inspectIndex;});fitCharts();
}
const {home,emailSetup,amount,simulation,liveContent,results,review,recordsPage,settings,chartReadout}=createViews({state,cycles,LOGO,chart,tabs,legend,percent,signed,escape,cycleData});
function chrome(){
  document.documentElement.lang=lang();
  const page=route(),labels={home:t('Home','홈'),results:t('Results','결과'),records:t('Records','기록'),settings:t('Settings','설정')};
  const paths={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',results:'M4 20V10h4v10M10 20V4h4v16M16 20v-8h4v8',records:'M7 3h10a2 2 0 0 1 2 2v16H5V5a2 2 0 0 1 2-2ZM8 8h8M8 12h8M8 16h5',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'};
  document.getElementById('app-navigation').setAttribute('aria-label',t('App navigation','앱 메뉴'));
  document.getElementById('app-navigation').innerHTML=Object.entries(labels).map(([key,label])=>`<a href="#${key}" data-nav="${key}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[key]}"/></svg><span>${label}</span></a>`).join('');
  const back=document.getElementById('header-back');back.hidden=page==='home'||page==='email';back.setAttribute('aria-label',t('Back','뒤로'));
  document.getElementById('header-language').textContent=lang()==='ko'?'한국어':'EN';
  document.getElementById('header-language').setAttribute('aria-label',t('Language settings','언어 설정'));
  document.querySelector('.site-footer').textContent=t('Historical simulation · No real trades · © ERUTY','과거 데이터 기반 모의 시뮬레이션 · 실제 거래 없음 · © ERUTY');
  document.querySelector('meta[name="description"]').content=t('Follow cash preparation and compare Bitcoin buy-and-hold with Risk Guard across three historical declines.','현금 확보 과정과 대표 비트코인 하락장 세 구간의 자산 변화를 비교하세요.');
}
function render(){
  clearTimeout(pollTimer);const page=route();const openDetails=page===lastRoute?preserveDetails():[];if(page!==lastRoute)state.inspectIndex=null;setCycleMode(!['simulation','results','review'].includes(page)||state.run?.model_version==='btc-bear-2');chrome();document.body.dataset.view=page;document.querySelectorAll('[data-nav]').forEach(el=>{const yes=el.dataset.nav===page||(el.dataset.nav==='home'&&['amount','simulation'].includes(page))||(el.dataset.nav==='results'&&page==='review');el.classList.toggle('active',yes);if(yes)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  if(state.booting){app.innerHTML=`<div class="page"><section class="empty-state"><div class="loading-ring"></div><h2>${t('Preparing your market','시장을 준비하고 있어요')}</h2><p>${t('Checking verified data and saved records.','검증된 데이터와 이전 기록을 확인해요.')}</p></section></div>`;return;}
  app.innerHTML=errorBox()+({home,email:emailSetup,amount,simulation,results,review,records:recordsPage,settings}[page])();app.className='screen-enter';restoreDetails(openDetails);fitCharts();
  const timeline=app.querySelector('.review-timeline'),selected=timeline?.querySelector('.active');if(selected)timeline.scrollLeft=selected.offsetLeft-timeline.offsetLeft-timeline.clientWidth/2+selected.clientWidth/2;
  if(page!==lastRoute){if(!matchMedia('(prefers-reduced-motion:reduce)').matches)app.animate([{opacity:.3,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'ease-out'});app.scrollTo({top:0,behavior:'instant'});app.focus({preventScroll:true});lastRoute=page;state.phaseChanged=false;}
  document.title=({home:t('Bitcoin Risk Guard','비트코인 리스크 가드'),email:t('Report email','보고서 이메일 설정'),amount:t('Your capital','내 투자금'),simulation:t('Live comparison','자동 비교'),results:t('Your results','비교 결과'),review:t('Response review','대응 복기'),records:t('Your records','내 기록'),settings:t('Settings','설정')}[page])+' · ERU AI';
  schedulePoll();
}
function schedulePoll(){clearTimeout(pollTimer);if(((route()==='simulation'&&state.run?.status==='running')||(route()==='results'&&['scheduled','sending'].includes(state.run?.report_delivery?.status)))&&!document.hidden&&pollFailures<3)pollTimer=setTimeout(poll,1400);}
async function poll(){
  if(state.busy||pollPromise||document.hidden){schedulePoll();return;}const sid=state.run?.id;if(!sid)return;
  pollPromise=(async()=>{
    try{
      let g=await api('/sessions/'+sid+'?view='+state.cycle);
      if(state.run?.id!==sid)return;
      const old=state.run.current_cycle,oldStatus=state.run.status;
      if(g.current_cycle!==old&&g.status!=='finished')g=await api('/sessions/'+sid+'?view='+g.current_cycle);
      receive(g,{follow:g.current_cycle!==old});pollFailures=0;state.error='';
      if(route()==='results'){render();return;}
      if(route()!=='simulation')return;
      if(g.status==='finished'){await navigate('results');return;}
      if(g.status!==oldStatus){render();return;}
      const d=cycleData(),live=document.getElementById('live-content'),details=preserveDetails();
      if(live&&d?.metrics)live.innerHTML=liveContent(d,d.events.at(-1));
      restoreDetails(details);fitCharts();
      document.querySelectorAll('[data-run-progress]').forEach(el=>el.value=g.elapsed);
      document.querySelectorAll('[data-run-progress-label]').forEach(el=>el.textContent=Math.floor(g.elapsed/3)+'%');
      state.phaseChanged=false;
      document.querySelectorAll('[data-action="sim-cycle"]').forEach((b,i)=>{
        b.disabled=i>g.current_cycle;b.classList.toggle('active',i===state.cycle);b.setAttribute('aria-pressed',i===state.cycle?'true':'false');
      });
    }catch(e){pollFailures++;state.error=e.message;if(pollFailures>=3)render();}
  })();
  await pollPromise;pollPromise=null;schedulePoll();
}
async function perform(fn){if(state.busy)return;state.busy=true;document.body.classList.add('is-busy');app.querySelectorAll('button').forEach(b=>b.disabled=true);clearTimeout(pollTimer);if(pollPromise)await pollPromise;try{await fn();state.error='';}catch(e){state.error=e.message;}finally{state.busy=false;document.body.classList.remove('is-busy');render();}}
async function playback(action,speed){if(!state.run)return;const g=await api('/sessions/'+state.run.id+'/playback',{action,...(speed?{speed}:{})});receive(g,{follow:true});if(g.status==='finished'&&action!=='pause')await navigate('results');else render();}
async function navigate(page){
  clearTimeout(pollTimer);if(page!==route())state.inspectIndex=null;if(page!=='simulation'&&state.run?.status==='running'){const g=await api('/sessions/'+state.run.id+'/playback',{action:'pause'});receive(g);}
  if(page==='records')state.records=(await api('/records')).records;
  if(location.hash!=='#'+page)history.pushState(null,'','#'+page);render();
}
function chooseEvent(i){const events=cycleData()?.events||[];state.event=Math.max(0,Math.min(events.length-1,i));remember();render();app.querySelector(`.review-timeline [data-index="${state.event}"]`)?.focus({preventScroll:true});}
function toast(text){const el=document.getElementById('toast');el.textContent=text;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500);}
async function modal(title,body){if(state.run?.status==='running')await playback('pause');previousFocus=document.activeElement;document.getElementById('modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-close" data-action="close-modal" aria-label="${t('Close','닫기')}">×</button><h2 id="modal-title">${title}</h2>${body}</section></div>`;for(const e of [app,document.querySelector('.site-header'),document.querySelector('.bottom-nav'),document.querySelector('.site-footer')])e.inert=true;document.body.style.overflow='hidden';document.querySelector('.modal button').focus();}
function closeModal(){document.getElementById('modal-root').innerHTML='';for(const e of [app,document.querySelector('.site-header'),document.querySelector('.bottom-nav'),document.querySelector('.site-footer')])e.inert=false;document.body.style.overflow='';if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
function method(){return modal(t('How the comparison works','비교 결과를 읽는 기준'),`<p>${t('Each period is compared independently. The starting basis is explained below.','각 구간은 독립적으로 비교하며, 시작 기준은 아래와 같아요.')}</p><ul class="method-list">${[
...(state.run?.model_version==='btc-guard-1'?[['Both accounts originally begin with 100% Bitcoin.','이전 전체 사이클은 두 계좌 모두 BTC 100%로 출발해요.']]:[['Preparation replays the original strategy from its first Bitcoin purchase. Each scenario spends 30% of playback on preparation and 70% on the decline.','사전 운용은 원래 첫 BTC 매수부터 재생해요. 각 구간 재생의 30%는 현금 확보, 70%는 하락장 비교예요.'],['At the bear-market start close, each account is independently rebased to the input capital. Risk Guard inherits its existing cash and Bitcoin mix. Earlier gains are excluded.','하락 시작일 종가에서 각 계좌를 입력 금액으로 독립 환산해요. 가드는 기존 현금·BTC 비중을 이어받으며, 이전 수익은 하락장 손익에 합산하지 않아요.'],['The three largest peak-to-trough closing-price declines were selected retrospectively, one from each original cycle. Their dates were not predicted.','각 원래 사이클에서 가장 큰 종가 고점·저점 하락 구간을 사후 선정했어요. 날짜를 사전에 예측한 결과가 아니에요.'],['The unchanged-mix benchmark separates existing cash holdings from subsequent trading effects.','같은 시작 비중을 고정 보유한 비교 계좌로 기존 현금과 추가 매매 효과를 구분해요.']]),
['Decisions use completed daily candles. Trades execute at the next daily open.','완료 일봉으로 판단하고 다음 일봉 시가에 분할 매매해요.'],
['A 0.05% fee per side applies to the initial purchase and every trade.','초기 매수와 각 매매에 편도 수수료 0.05%를 반영해요.'],
['English amounts are displayed in SGD; Korean amounts in KRW. The same capital uses the fixed ECB reference cross-rate of 13 November 2026 (1 SGD = '+krwPerSgd.toFixed(2)+' KRW). Historical FX changes, cash interest and slippage are excluded.','USD 가격 변동률을 원화 자본에 적용해요. 환율 변동·현금 이자·슬리피지는 미반영해요.'],
['Maximum drawdown is each account’s largest daily fall from its own peak. Peak dates may differ.','최대 낙폭은 각 계좌의 자체 고점 대비 가장 큰 일별 하락이에요. 고점 날짜는 다를 수 있어요.'],
['A smaller drawdown may come with lower final assets if the strategy misses market rises.','낙폭이 작아져도 상승 참여가 줄어 최종 자산은 단순 보유보다 적을 수 있어요.'],
['Exposure is calculated in internal index units, not actual Bitcoin quantities.','수량은 내부 노출 단위로 계산하며 실제 BTC 개수로 표시하지 않아요.'],
['This is a historical simulation, with no deposit or exchange orders. Past performance does not guarantee future results.','과거 모의 결과로 실제 입금·주문은 없어요. 과거 결과가 미래 성과를 보장하지 않아요.']
].map(([en,ko])=>`<li>${t(en,ko)}</li>`).join('')}</ul><button class="btn dark wide" data-action="close-modal">${t('Got it','확인했어요')}</button>`);}
function flow(){return modal(t('Your comparison journey','투자금부터 대응 복기까지'),`<ol class="flow-list">${[
['Report email','보고서 이메일 설정','First, save your email on its own screen. No verification code.','먼저 별도 화면에서 이메일을 저장해요. 인증번호는 필요 없어요.'],
['Your capital','투자금 설정','Next, choose your simulation capital.','다음 화면에서 시뮬레이션 투자금을 정해요.'],
['Cash preparation & declines','현금 확보와 세 하락장 비교','Watch preparation, then compare rebased accounts across three historical declines.','현금 확보 과정을 본 뒤, 같은 금액으로 환산한 두 계좌의 하락장 손실을 비교해요.'],
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
document.addEventListener('input',e=>{if(e.target.matches('[data-chart-scrub]')){inspectChart(Number(e.target.value));return;}if(e.target.id==='contact-email')state.reportEmailDraft=e.target.value;if(e.target.id==='contact-consent')state.reportConsent=e.target.checked;if(e.target.id==='amount-input'){state.amountEdited=true;const n=parseAmount(e.target.value,lang());if(n!==null)state.amountDraft=n;document.getElementById('amount-error').textContent='';}});
document.addEventListener('submit',async e=>{
  if(e.target.id==='contact-form'){
    e.preventDefault();if(!e.target.reportValidity())return;const edit=e.target.dataset.edit==='true';
    const email=document.getElementById('contact-email').value.trim(),consent=document.getElementById('contact-consent').checked,website=document.getElementById('contact-website').value;
    await perform(async()=>{state.contact=await api('/contact',{email,consent,website,locale:lang()});state.reportEmailDraft='';state.reportConsent=false;state.emailEditing=false;if(edit){toast(t('Email updated. Reports not yet sent will use this address.','이메일을 변경했어요. 아직 보내지 않은 보고서부터 적용돼요.'));render();}else await navigate('amount');});return;
  }
  if(e.target.id!=='amount-form')return;e.preventDefault();if(!e.target.reportValidity())return;
  const n=parseAmount(document.getElementById('amount-input').value,lang(),state.amountDraft);
  if(n===null||n<10000||n>10000000000){const [min,max]=amountLimits('en');document.getElementById('amount-error').textContent=t(`Enter S$${min.toFixed(2)} to S$${max.toLocaleString('en-SG',{minimumFractionDigits:2})}, with up to 2 decimal places.`,'1만 원부터 100억 원까지 숫자로 입력해 주세요.');return;}
  state.amountDraft=n;await perform(async()=>{if(state.run?.status==='running')await api('/sessions/'+state.run.id+'/playback',{action:'pause'});const run=await api('/sessions',{amount:n.toFixed(2),locale:lang()});state.reportEmailDraft='';state.reportConsent=false;state.cycle=0;state.event=0;receive(run,{follow:true});await navigate('simulation');});
});
document.addEventListener('click',async e=>{
  const plot=e.target.closest('.responsive-plot');if(plot&&route()!=='review'&&state.run?.status!=='running'){const d=cycleData(),box=plot.getBoundingClientRect(),g=chartGeometry(d,{width:plot.viewBox.baseVal.width,height:plot.viewBox.baseVal.height,mode:plot.classList.contains('cash-plot')?'cash':'assets'}),position=((e.clientX-box.left)*g.width/box.width-g.left)/g.plotWidth*100;let closest=0;d.history.forEach((p,i)=>{if(Math.abs(p.position-position)<Math.abs(d.history[closest].position-position))closest=i;});inspectChart(closest);return;}

  const link=e.target.closest('a[href^="#"]');if(link){e.preventDefault();await perform(()=>navigate(link.hash.slice(1)||'home'));return;}
  if(e.target.classList.contains('modal-backdrop'))return closeModal();const el=e.target.closest('[data-action]');if(!el||el.disabled)return;const a=el.dataset.action;
  if(a==='skip-splash'){closeSplash();return;}if(a==='close-modal'){closeModal();return;}if(a==='dismiss-error'){state.error='';render();return;}
  if(a==='email-report'){document.getElementById('email-report')?.scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(a==='language'){setLanguage(el.dataset.language);if(!state.amountEdited)state.amountDraft=defaultCapital(lang());render();return;}
  if(a==='preset'){state.amountEdited=true;state.amountDraft=Number(el.dataset.amount);document.getElementById('amount-input').value=inputAmount(state.amountDraft,lang());document.getElementById('amount-error').textContent='';app.querySelectorAll('[data-action="preset"]').forEach(x=>x.classList.toggle('selected',x===el));return;}
  await perform(async()=>{
    if(a==='edit-contact'){state.emailEditing=true;state.reportEmailDraft='';state.reportConsent=false;await navigate('settings');}else if(a==='cancel-contact'){state.emailEditing=false;state.reportEmailDraft='';state.reportConsent=false;render();}else if(a==='settings')await navigate('settings');else if(a==='back')await navigate(({amount:'home',simulation:'amount',review:'results',results:'home',records:'home',settings:'home'})[route()]||'home');else if(a==='begin')await navigate('amount');else if(a==='method')await method();else if(a==='flow')await flow();else if(a==='start-from-flow'){closeModal();await navigate('amount');}
    else if(a==='play')await playback(state.run.status==='running'?'pause':'resume');else if(a==='speed')await playback('speed',Number(el.dataset.speed));else if(a==='next-event')await playback('next');else if(a==='finish'){toast(t('Finishing your comparison and preparing the email report…','비교를 마치고 이메일 보고서를 준비하고 있어요…'));await playback('finish');}else if(a==='retry-delivery')receive(await api('/sessions/'+state.run.id+'/delivery/retry',{}));else if(a==='resume'){await playback('resume');await navigate('simulation');}
    else if(a==='sim-cycle'){state.inspectIndex=null;state.cycle=Number(el.dataset.cycle);const g=await api('/sessions/'+state.run.id+'?view='+state.cycle);receive(g);render();}
    else if(a==='result-cycle'){state.cycle=Number(el.dataset.cycle);state.inspectIndex=null;remember();render();}
    else if(a==='review-phase'){state.reviewPhase=el.dataset.phase==='preparation'?'preparation':'bear';state.inspectIndex=null;state.event=0;remember();render();}else if(a==='review-preparation'){state.reviewPhase='preparation';state.event=0;remember();await navigate('review');}else if(a==='review-cycle'){state.reviewPhase='bear';state.cycle=Number(el.dataset.cycle);state.event=0;remember();await navigate('review');}
    else if(a==='event'){const i=Number(el.dataset.index);if(route()==='simulation'){const ev=eventText(cycleData().events[i]);await modal(ev.title,`<p>${ev.action}</p><p class="fine" style="margin-top:18px">${t('Signal','판단')} ${ev.signal_at} · ${ev.kind==='wait'?t('No execution','체결 없음'):t('Simulated execution ','모의 체결 ')+ev.at}</p>`);}else chooseEvent(i);}
    else if(a==='event-info'){const ev=eventText(cycleData().events.find(x=>x.id===el.dataset.id));if(ev)await modal(ev.title,`<p>${ev.action}</p>`);}
    else if(a==='previous-review')chooseEvent(state.event-1);else if(a==='next-review')chooseEvent(state.event+1);else if(a==='first-buy'){const i=cycleData().events.findIndex(x=>x.kind==='buy');if(i>=0)chooseEvent(i);else toast(t('No re-entry is included in this cycle’s highlights. Check all responses.','이 구간의 주요 장면에 재매수가 없어요. 전체 대응 내역을 확인해 주세요.'));}
    else if(a==='all-events')await allEvents();else if(a==='next-cycle-review'){state.cycle=(state.cycle+1)%3;state.reviewPhase='bear';state.event=0;remember();render();app.scrollTo({top:0,behavior:'smooth'});}
    else if(a==='results')await navigate('results');else if(a==='records')await navigate('records');
    else if(a==='open-record'||a==='review-record'){const g=await api('/sessions/'+el.dataset.id);state.reviewPhase='bear';receive(g);state.cycle=0;state.event=0;await navigate(a==='review-record'?'review':g.status==='finished'?'results':'simulation');}
    else if(a==='retry'){pollFailures=0;state.config=await api('/config');state.contact=await api('/contact');if(!state.config.ready)throw new Error('검증된 데이터를 준비하고 있어요. 잠시 후 다시 시도해 주세요.');state.contact=await api('/contact');if(state.run)receive(await api('/sessions/'+state.run.id+'?view='+state.cycle));state.error='';render();}
  });
});
document.addEventListener('keydown',e=>{const m=document.querySelector('.modal');if(m){if(e.key==='Escape'){e.preventDefault();closeModal();}else if(e.key==='Tab'){const items=[...m.querySelectorAll('button:not(:disabled),a[href],input')];if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0].focus();}}return;}if((e.key==='Enter'||e.key===' ')&&e.target.matches('.chart-marker')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
window.addEventListener('hashchange',async()=>{try{if(route()!=='simulation'&&state.run?.status==='running')receive(await api('/sessions/'+state.run.id+'/playback',{action:'pause'}));if(route()==='records')state.records=(await api('/records')).records;}catch(e){state.error=e.message;}render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.run?.status==='running')api('/sessions/'+state.run.id+'/playback',{action:'pause'},true).then(receive).catch(()=>{});else if(!document.hidden&&route()==='simulation'&&state.run)perform(async()=>{receive(await api('/sessions/'+state.run.id+'?view='+state.cycle));render();});});
window.addEventListener('pagehide',()=>{if(state.run?.status==='running')api('/sessions/'+state.run.id+'/playback',{action:'pause'},true).catch(()=>{});});
const chartObserver=new ResizeObserver(()=>{if(!state.booting)fitCharts();});chartObserver.observe(document.querySelector('.app-shell'));
async function boot(){render();splash();try{state.config=await api('/config');state.contact=await api('/contact');if(!state.config.ready)state.error='검증된 비트코인 데이터를 준비하고 있어요. 잠시 후 다시 확인해 주세요.';let sid;try{sid=localStorage.getItem(LAST);}catch{}if(sid){try{let saved;try{saved=JSON.parse(sessionStorage.getItem('eru-btc-view-'+sid)||'null');}catch{}const g=await api('/sessions/'+sid);receive(g,{follow:true});if(saved&&Number.isInteger(saved.cycle)&&saved.cycle>=0&&saved.cycle<=g.current_cycle){state.cycle=saved.cycle;state.reviewPhase=saved.phase==='preparation'?'preparation':'bear';state.event=Number.isInteger(saved.event)?Math.min(Math.max(0,saved.event),Math.max(0,cycleData().events.length-1)):0;if(g.status!=='finished')receive(await api('/sessions/'+sid+'?view='+state.cycle));}}catch(e){if(e.status!==404)state.error=e.message;}}if(route()==='records')state.records=(await api('/records')).records;}catch(e){state.error=e.message;}state.booting=false;if(state.run)remember();if(state.contact?.registered&&location.hash==='#email')history.replaceState(null,'','#amount');render();}
boot();
