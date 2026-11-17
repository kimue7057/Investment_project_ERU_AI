import './financial.css';
import './report.css';
import {t,lang,setLanguage,money,errorText} from './i18n';
import {reportChartData} from './reportChartData';
import {createFinancialChart} from './financialChart';
import {renderAssetChart} from './chartView';
import {emailView,reportView,decisions,escape} from './reportViews';

const requestedLanguage=new URLSearchParams(location.search).get('lang');if(['en','ko'].includes(requestedLanguage))setLanguage(requestedLanguage);
const app=document.getElementById('app');
const state={config:null,contact:null,report:null,cycle:0,active:-1,entryConfirmed:false,stage:location.hash==='#recovery'?'recovery':'bear',emailDraft:'',consent:false,busy:false,editing:false,error:''};
let controller=null,scrollFrame=0;
function current(){return state.report?.cycles[state.cycle];}
function source(){const c=current();return c?reportChartData(c,state.stage):null;}
function clearChart(){controller?.dispose();controller=null;cancelAnimationFrame(scrollFrame);scrollFrame=0;}
async function api(path,body){
 const r=await fetch('/api/bitcoin'+path,{credentials:'same-origin',method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:t('Please try again.','다시 시도해 주세요.'));return data;
}
function header(){
 document.documentElement.lang=lang();document.title=t('Bitcoin Risk Guard · Results','비트코인 리스크 가드 · 결과');
 document.getElementById('report-language').textContent=lang()==='ko'?'EN':'한국어';
 document.getElementById('report-language').disabled=state.busy;
 const email=document.getElementById('report-email-settings');email.hidden=!state.entryConfirmed;email.disabled=state.busy;email.textContent=t('Email','이메일');
}
function errorBox(){return state.error?`<div class="report-error" role="alert">${escape(errorText(state.error))}<button data-action="retry">${t('Retry','다시 시도')}</button></div>`:'';}
function showEmail(){clearChart();header();history.replaceState(null,'','#email');app.innerHTML=errorBox()+emailView(state);app.scrollTop=0;}
function loading(){clearChart();header();app.innerHTML=`<section class="report-loading" role="status"><span class="loading-spinner"></span><h1>${t('Preparing the completed results','완료된 결과를 준비하고 있어요')}</h1><p>${state.stage==='recovery'?t('Checking the three recovery periods and asset changes.','세 상승장의 기간과 자산 변화를 확인합니다.'):t('Checking the fixed capital and historical results.','고정 금액과 과거 결과를 확인합니다.')}</p></section>`;}
function updateReadout(point){
 const c=current();if(!c||!document.getElementById('chart-date'))return;const recovery=state.stage==='recovery',event=recovery?null:decisions(c)[state.active],end=recovery?c.recovery:c.metrics;
 const date=point?.date||event?.at||(recovery?c.recovery.end:c.end),hold=point?.hold??event?.hold_value??end.hold.end_value??end.hold.value,guard=point?.guard??event?.guard_value??end.guard.end_value??end.guard.value;
 document.getElementById('chart-date').textContent=date;document.getElementById('mini-hold').textContent=money(hold);document.getElementById('mini-guard').textContent=money(guard);
 document.getElementById('chart-decision').textContent=point?t('Inspecting daily close','일봉 종가 조회'):event?t('Selected response','선택한 대응'):t('Period complete','구간 종료');
}
function chartUpdate(){
 const d=source(),host=document.getElementById('report-chart');if(!d||!host)return;
 const event=state.stage==='bear'?decisions(current())[state.active]:null,selected=event?d.events.findIndex(e=>e.id===event.id):-1;
 if(controller)controller.update(d,{key:state.report.id+'|'+state.cycle+'|'+state.stage,chartUnit:'month',selectedId:event?.id,numbered:'dots',pinnedPoint:event?{position:event.position,guard:event.guard_value}:null,startValue:state.report.amount});
 else host.innerHTML=renderAssetChart({...d,chart_unit:'month'},{width:host.clientWidth||350,height:320,markers:state.stage==='bear',allMarkers:true,markerLabels:'none',selected,focusIndex:event?d.history.findIndex(p=>p.date===event.at):null});
 updateReadout(null);
}
function cardBoundary(){const box=app.getBoundingClientRect();return innerWidth<850?box.top+(document.querySelector('.report-chart-pin')?.clientHeight||0)+12:box.top+24;}
function activate(index,scroll=false){
 const list=decisions(current());if(index<0||index>=list.length)return;
 if(scroll){const review=document.querySelector('.report-review');if(review)review.open=true;}
 state.active=index;
 document.querySelectorAll('[data-decision]').forEach(card=>{const active=Number(card.dataset.decision)===index;card.classList.toggle('active',active);if(active)card.setAttribute('aria-current','step');else card.removeAttribute('aria-current');});
 chartUpdate();
 if(scroll){const card=document.getElementById('decision-'+index);app.scrollBy({top:card.getBoundingClientRect().top-cardBoundary(),behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});}
}
function syncScroll(){
 scrollFrame=0;if(!state.report||state.editing||!document.getElementById('report-chart'))return;
 const boundary=cardBoundary(),cards=[...document.querySelectorAll('[data-decision]')];
 const card=cards.find(el=>{const r=el.getBoundingClientRect();return r.top<=boundary&&r.bottom>boundary;});
 if(card&&Number(card.dataset.decision)!==state.active)activate(Number(card.dataset.decision));
}
function showReport(){
 if(!state.report)return;clearChart();header();state.editing=false;state.error='';history.replaceState(null,'',state.stage==='recovery'?'#recovery':'#report');
 const d=source(),fallback=renderAssetChart({...d,chart_unit:'month'},{width:Math.min(1100,Math.max(288,app.clientWidth-32)),height:320,markers:state.stage==='bear',allMarkers:true,markerLabels:'none',selected:state.active});
 app.innerHTML=reportView(state,fallback);app.scrollTop=0;
 const host=document.getElementById('report-chart');
 try{controller=createFinancialChart(host,{palette:{hold:'#ff8476',guard:'#76aaff',baseline:'#d9bc83'},onInspect:updateReadout,onRecord:record=>activate(decisions(current()).findIndex(e=>e.id===record.id),true)});chartUpdate();}
 catch{controller?.dispose();controller=null;host.innerHTML=fallback;}
 if(state.stage==='bear'&&state.active>=0)activate(state.active);
 app.style.scrollPaddingTop=innerWidth<850?document.querySelector('.report-chart-pin').clientHeight+12+'px':'24px';
}
async function loadReport(){
 if(!state.entryConfirmed){showEmail();return;}
 if(state.busy)return;state.busy=true;state.error='';loading();
 try{state.report=await api('/reports',{locale:lang()});if(state.report.status!=='finished'||state.report.report_mode!=='fixed_result')throw new Error(t('The completed report is unavailable.','완료 보고서를 불러올 수 없습니다.'));state.active=-1;state.cycle=0;state.editing=false;}
 catch(e){state.error=e.message;}
 finally{state.busy=false;if(state.error){header();app.innerHTML=errorBox()+`<section class="report-loading"><p>${t('Your email is saved. Please retry loading the report.','이메일은 저장됐습니다. 결과 불러오기를 다시 시도해 주세요.')}</p></section>`;}else showReport();}
}
async function boot(){
 state.busy=true;loading();try{[state.config,state.contact]=await Promise.all([api('/config'),api('/contact')]);if(!state.config.ready)throw new Error(t('Verified data is not ready.','검증된 데이터가 준비되지 않았습니다.'));}
 catch(e){state.error=e.message;}state.busy=false;
 if(state.error){header();app.innerHTML=errorBox();return;}
 showEmail();
}
document.addEventListener('input',e=>{if(e.target.id==='report-email')state.emailDraft=e.target.value;if(e.target.id==='report-consent')state.consent=e.target.checked;});
document.addEventListener('submit',async e=>{
 if(e.target.id!=='report-email-form')return;e.preventDefault();if(state.busy||!e.target.reportValidity())return;
 const email=document.getElementById('report-email').value.trim(),consent=document.getElementById('report-consent').checked,website=document.getElementById('report-website').value;
 state.busy=true;showEmail();try{state.contact=await api('/contact',{email,consent,website,locale:lang()});state.entryConfirmed=true;state.emailDraft='';state.consent=false;state.error='';state.busy=false;await loadReport();}catch(e){state.error=e.message;state.busy=false;showEmail();}
});
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-action]');if(!button||button.disabled||state.busy)return;const action=button.dataset.action;
 if(action==='cycle'){state.cycle=Number(button.dataset.index);state.active=-1;showReport();}
 else if(action==='next-stage'){state.stage='recovery';showReport();}
 else if(action==='previous-stage'){state.stage='bear';showReport();}
 else if(action==='decision')activate(Number(button.dataset.index),true);
 else if(action==='event'){const record=source().events[Number(button.dataset.index)];if(record)activate(decisions(current()).findIndex(e=>e.id===record.id),true);}
 else if(action==='edit-email'){state.editing=true;state.emailDraft='';state.consent=false;showEmail();}
 else if(action==='cancel-email'){state.editing=false;if(state.report)showReport();else await loadReport();}
 else if(action==='language'){setLanguage(lang()==='ko'?'en':'ko');if(state.report&&!state.editing)await loadReport();else showEmail();}
 else if(action==='top')app.scrollTo({top:0,behavior:'smooth'});
 else if(action==='jump'){const target=document.getElementById(button.dataset.target);if(target)app.scrollBy({top:target.getBoundingClientRect().top-app.getBoundingClientRect().top-18,behavior:'smooth'});}
 else if(action==='retry'){state.error='';if(state.contact?.registered)await loadReport();else await boot();}
});
app.addEventListener('scroll',()=>{if(!scrollFrame)scrollFrame=requestAnimationFrame(syncScroll);},{passive:true});
document.addEventListener('keydown',e=>{if(e.target.id==='report-chart'&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();activate(Math.max(0,state.active+(e.key==='ArrowLeft'?-1:1)));}});
window.addEventListener('resize',()=>{controller?.resize();const pin=document.querySelector('.report-chart-pin');if(pin)app.style.scrollPaddingTop=innerWidth<850?pin.clientHeight+12+'px':'24px';});

function splash(){
 const root=document.getElementById('splash'),reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;root.hidden=false;root.innerHTML=`<div class="report-splash-mark"><img src="/assets/riskguard-logo.webp" alt="Risk Guard"><b>RISK GUARD</b></div>${reduced?'':'<video autoplay muted playsinline aria-hidden="true"><source src="/assets/riskguard-intro.mp4" type="video/mp4"></video>'}<button id="skip-intro">${t('Skip','건너뛰기')} ↗</button>`;
 document.querySelector('.report-shell').inert=true;
 let timer;const close=()=>{clearTimeout(timer);root.querySelector('video')?.pause();root.hidden=true;root.innerHTML='';document.querySelector('.report-shell').inert=false;};
 root.querySelector('button').addEventListener('click',close);const video=root.querySelector('video');if(video){video.muted=true;video.addEventListener('ended',close,{once:true});video.addEventListener('error',close,{once:true});video.play().catch(close);}timer=setTimeout(close,reduced?1200:6500);
}
splash();boot();
