import {createChart,LineSeries,ColorType,CrosshairMode,LineStyle} from 'lightweight-charts';
import {createSeriesMarkers} from 'lightweight-charts';
import {financialModel,nearestPoint,financialMarkers} from './financialModel';
import {t,lang,money} from './i18n';
import {inputAmount} from './currency';
import {timeAxisTicks} from './periodView';

function axisMoney(value){
 if(lang()!=='ko')return money(value).replace('S$','');
 const a=Math.abs(value),sign=value<0?'−':'';
 return sign+(a>=1e8?Number((a/1e8).toFixed(2))+'억':a>=1e4?Math.round(a/1e4).toLocaleString('ko-KR')+'만':Math.round(a).toLocaleString('ko-KR'));
}
const fullMoney=value=>lang()==='ko'?inputAmount(value,'ko')+'원':'S$'+inputAmount(value,'en');

export function createFinancialChart(host,{onInspect=()=>{},onRecord=()=>{},palette={hold:'#a8b5c8',guard:'#4bd6ad',baseline:'#657b98'}}={}){
 let model=null,unit='day',context='',signature='',muted=false,zoomed=false,focus=null,disposed=false,baseline=null,baselineValue=null;
 host.replaceChildren();
 const canvas=document.createElement('div');canvas.className='financial-canvas';host.append(canvas);
 const tooltip=document.createElement('div');tooltip.className='financial-tooltip';tooltip.hidden=true;
 const tooltipDate=document.createElement('b'),tooltipHold=document.createElement('span'),tooltipGuard=document.createElement('span');
 tooltip.append(tooltipDate,tooltipHold,tooltipGuard);host.append(tooltip);
 const axis=document.createElement('div');axis.className='financial-time-axis';axis.setAttribute('aria-hidden','true');host.append(axis);
 const chart=createChart(canvas,{
  autoSize:true,layout:{background:{type:ColorType.Solid,color:'#0c1421'},textColor:'#aabbcf',fontSize:12,attributionLogo:true},
  grid:{vertLines:{visible:false},horzLines:{color:'#253247',style:LineStyle.Dotted}},
  leftPriceScale:{visible:false},rightPriceScale:{visible:true,borderVisible:false,minimumWidth:57,alignLabels:true,scaleMargins:{top:.14,bottom:.08}},
  timeScale:{visible:false,borderColor:'#2b3a50',minBarSpacing:.01,rightOffset:0,timeVisible:false,secondsVisible:false,ignoreWhitespaceIndices:false,enableConflation:false,allowBoldLabels:false},
  crosshair:{mode:CrosshairMode.Normal,vertLine:{color:'#8fa7c1',style:LineStyle.Dashed,labelBackgroundColor:'#344961'},horzLine:{color:'#69819d',style:LineStyle.Dashed,labelBackgroundColor:'#344961'}},
  localization:{locale:lang()==='ko'?'ko-KR':'en-SG',priceFormatter:axisMoney,timeFormatter:time=>typeof time==='number'?new Date(time*1000).toISOString().slice(0,10):String(time)},
  handleScroll:{mouseWheel:false,pressedMouseMove:false,horzTouchDrag:false,vertTouchDrag:false},
  handleScale:{mouseWheel:false,pinch:true,axisPressedMouseMove:false,axisDoubleClickReset:false},
 });
 const scale=original=>{const info=original();return info?{...info,priceRange:{minValue:0,maxValue:Math.max(1,info.priceRange.maxValue,baselineValue||0)}}:info;};
 const options={priceFormat:{type:'custom',formatter:axisMoney,minMove:.01},priceLineVisible:false,lastValueVisible:true,crosshairMarkerRadius:4,autoscaleInfoProvider:scale};
 // 공백 날짜를 별도 시리즈로 등록해 표본 간 실제 일수 간격을 유지한다.
 // 두 자산 시리즈에는 서버가 공개한 원래 값만 전달한다.
 const timeline=chart.addSeries(LineSeries,{visible:false,priceLineVisible:false,lastValueVisible:false});
 const hold=chart.addSeries(LineSeries,{...options,color:palette.hold,lineWidth:2});
 const guard=chart.addSeries(LineSeries,{...options,color:palette.guard,lineWidth:2});
 const markers=createSeriesMarkers(guard,[],{autoScale:false});
 function renderAxis(){
  if(!model||disposed)return;
  const range=chart.timeScale().getVisibleLogicalRange();if(!range)return;
  const from=Math.max(0,Math.min(model.lastStep,range.from)),to=Math.max(from,Math.min(model.lastStep,range.to));
  const firstTime=model.timeAt(Math.round(from)),lastTime=model.timeAt(Math.round(to));
  const firstDate=new Date(firstTime*1000).toISOString().slice(0,10),lastDate=new Date(lastTime*1000).toISOString().slice(0,10);
  const plotWidth=canvas.clientWidth-chart.priceScale('right').width(),days=(Date.parse(lastDate)-Date.parse(firstDate))/86400000;
  const firstStep=Math.round((Date.parse(firstDate)/1000-model.timeAt(0))/86400)+(model.timeAt(1)%86400===86399?1:0);
  axis.replaceChildren();
  for(const tick of timeAxisTicks(firstDate,lastDate,unit,plotWidth)){
   const logical=days===0?(from+to)/2:firstStep+days*tick.position/100;
   const x=chart.timeScale().logicalToCoordinate(logical);if(x===null||x<0||x>plotWidth)continue;
   const label=document.createElement('span');label.textContent=tick.label+(unit==='week'?t(' wk','주'):'');label.style.left=x+'px';axis.append(label);
  }
 }
 chart.timeScale().subscribeVisibleLogicalRangeChange(renderAxis);
 const observer=new ResizeObserver(()=>{globalThis.requestAnimationFrame?.(renderAxis);});observer.observe(host);
 function show(point){
  if(!point){tooltip.hidden=true;onInspect(null);return;}
  tooltipDate.textContent=point.date;
  tooltipHold.textContent=t('Buy & hold','단순 보유')+'  '+fullMoney(point.hold);
  tooltipGuard.textContent='Risk Guard  '+fullMoney(point.guard);
  tooltip.hidden=false;onInspect(point);
 }
 const crosshair=param=>{
  if(muted||disposed||!model)return;
  if(param.time===undefined||!param.point){focus=null;show(null);return;}
  const point=nearestPoint(model,Number(param.logical));if(!point)return;
  const same=focus?.step===point.step;focus=point;pin(point);if(!same)show(point);
 };
 const click=param=>{
  const id=param.hoveredInfo?.objectId??param.hoveredObjectId;
  const record=model?.events.find(e=>e.id===id);
  if(record){focus=null;tooltip.hidden=true;onRecord(record);}
 };
 chart.subscribeCrosshairMove(crosshair);chart.subscribeClick(click);
 const touch=e=>{if(e.touches.length>1)zoomed=true;};canvas.addEventListener('touchstart',touch,{passive:true});
 function fit(){
  if(!model)return;const span=Math.max(2,model.lastStep);
  chart.timeScale().setVisibleLogicalRange({from:-Math.max(.5,span*.015),to:span+Math.max(2,span*.075)});
 }
 function pin(point){
  if(!point||!model)return;muted=true;
  chart.setCrosshairPosition(point.guard,model.timeAt(Math.round(point.position/100*model.steps)),guard);muted=false;
 }
 return {
  update(data,{key,chartUnit='day',selectedId=null,pinnedPoint=null,numbered=false,startValue=null}={}){
   if(disposed)return;
   unit=chartUnit;
   const next=key+'|'+data.history.length+'|'+data.history.at(-1)?.position+'|'+data.history.at(-1)?.guard;
   muted=true;
   if(next!==signature){
    const changed=context!==key;if(changed){zoomed=false;focus=null;tooltip.hidden=true;}
    context=key;model=financialModel(data);signature=next;
    timeline.setData(model.timeline);hold.setData(model.hold);guard.setData(model.guard);
    if(!zoomed)fit();
   }
   markers.setMarkers(financialMarkers(model,selectedId,numbered));
   if(Number.isFinite(startValue)&&startValue!==baselineValue){if(baseline)guard.removePriceLine(baseline);baselineValue=startValue;baseline=guard.createPriceLine({price:startValue,color:palette.baseline,lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:false,title:t('Starting capital','시작금액')});}
   const selected=model.events.find(e=>e.id===selectedId);
   const point=pinnedPoint||(selected?{position:selected.position,guard:selected.guard_value}:null);
   if(point)pin(point);else if(focus)pin(focus);
   muted=false;renderAxis();globalThis.requestAnimationFrame?.(renderAxis);
  },
  reset(){zoomed=false;focus=null;tooltip.hidden=true;muted=true;chart.clearCrosshairPosition();fit();muted=false;},
  resize(){if(!disposed){chart.resize(canvas.clientWidth,canvas.clientHeight);if(!zoomed)fit();renderAxis();}},
  dispose(){if(disposed)return;disposed=true;observer.disconnect();canvas.removeEventListener('touchstart',touch);chart.unsubscribeCrosshairMove(crosshair);chart.unsubscribeClick(click);chart.timeScale().unsubscribeVisibleLogicalRangeChange(renderAxis);markers.detach();chart.remove();host.replaceChildren();},
 };
}
