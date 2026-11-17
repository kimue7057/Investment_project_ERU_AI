import {t,money,typeLabel} from './i18n';
import {timeAxisTicks} from './periodView';

export function representativeIndices(events,selected=null){
 const picks=new Set();
 for(const kind of ['sell','buy','wait']){const i=events.findIndex(e=>e.kind===kind);if(i>=0)picks.add(i);}
 if(events.length)picks.add(events.length-1);
 if(Number.isInteger(selected)&&events[selected])picks.add(selected);
 return [...picks].sort((a,b)=>a-b);
}

export function chartGeometry(data,{width=340,height=250,mode='assets'}={}){
 const rows=data.history||[],left=mode==='cash'?39:72,right=23,top=22,bottom=30;
 const maximum=mode==='cash'?100:Math.max(1,data.maximum_value||0,...rows.flatMap(p=>[p.hold,p.guard]))*1.1;
 const plotWidth=Math.max(1,width-left-right),plotHeight=Math.max(1,height-top-bottom);
 return {width,height,left,right,top,bottom,maximum,plotWidth,plotHeight,
  x:position=>left+plotWidth*Math.max(0,Math.min(100,position))/100,
  y:value=>top+plotHeight-Math.max(0,value)/maximum*plotHeight};
}

export function renderAssetChart(data,{width=340,height=250,mode='assets',markers=false,selected=null,focusIndex=null}={}){
 const rows=data?.history||[];
 if(!rows.length)return `<div class="chart-empty">${t('The chart appears as playback begins.','재생을 시작하면 차트가 나타나요.')}</div>`;
 if(mode==='cash'&&!rows.every(p=>Number.isFinite(p.btc_weight)))mode='assets';
 const g=chartGeometry(data,{width,height,mode}),{left,right,top,plotWidth,plotHeight,x,y,maximum}=g;
 const first=rows[0],last=rows.at(-1),events=data.events||[];
 const value=(p,key)=>mode==='cash'?(key==='hold'?p.btc_weight:100-p.btc_weight):p[key];
 const path=key=>rows.map((p,i)=>(i?'L':'M')+x(p.position).toFixed(2)+','+y(value(p,key)).toFixed(2)).join(' ');
 const grid=[1,.5,0].map(f=>`<line class="plot-grid" x1="${left}" x2="${width-right}" y1="${y(maximum*f)}" y2="${y(maximum*f)}"/><text class="plot-axis" x="${left-9}" y="${y(maximum*f)+4}" text-anchor="end">${mode==='cash'?Math.round(maximum*f)+'%':money(maximum*f)}</text>`).join('');
 const focus=Number.isInteger(focusIndex)?rows[Math.max(0,Math.min(rows.length-1,focusIndex))]:null;
 const scene=markers&&Number.isInteger(selected)?events[selected]:null;
 const cursor=scene?{position:scene.position}:focus;
 const cursorLine=cursor?`<line class="plot-cursor" x1="${x(cursor.position)}" x2="${x(cursor.position)}" y1="${top}" y2="${top+plotHeight}"/>`:'';
 const dots=markers?representativeIndices(events,selected).map(i=>{
  const e=events[i],cx=x(e.position),cy=y(mode==='cash'?100-e.btc_weight:e.guard_value),chosen=i===selected;
  return `<g class="chart-marker ${chosen?'selected':''}" role="button" tabindex="0" data-action="event" data-index="${i}" aria-label="${i+1} · ${e.at} · ${typeLabel(e.kind)}"><circle class="plot-hit" cx="${cx}" cy="${cy}" r="22"/><circle class="plot-event ${e.kind}" cx="${cx}" cy="${cy}" r="${chosen?7:4.5}"/>${chosen?`<text class="plot-event-number" x="${cx}" y="${Math.max(top+12,cy-13)}" text-anchor="middle">${i+1}</text>`:''}</g>`;
 }).join(''):'';
 const ending=rows.length===1?`<circle cx="${x(first.position)}" cy="${y(value(first,'guard'))}" r="4" fill="${mode==='cash'?'#edc17d':'#4bd6ad'}"/>`:'';
 const cashArea=mode==='cash'?`<path d="${path('guard')} L${x(last.position)},${top+plotHeight} L${x(first.position)},${top+plotHeight}Z" fill="#edc17d" opacity=".12"/>`:'';
 const axis=timeAxisTicks(data.start,data.end,data.chart_unit||'day',plotWidth).map(tick=>`<g class="time-axis-tick"><line class="plot-grid" x1="${x(tick.position)}" x2="${x(tick.position)}" y1="${top+plotHeight}" y2="${top+plotHeight+4}"/><text class="plot-axis" x="${x(tick.position)}" y="${height-6}" text-anchor="middle">${tick.label}${data.chart_unit==='week'?t(' wk','주'):''}</text></g>`).join('');
 return `<svg class="asset-chart responsive-plot ${mode==='cash'?'cash-plot':''}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="${markers?'group':'img'}" aria-label="${mode==='cash'?t('Bitcoin and cash weights','비트코인과 현금 비중 변화'):t('Buy-and-hold and Risk Guard asset changes','단순 보유와 리스크 가드 자산 변화')}">${grid}${cashArea}<path class="plot-line plot-hold" d="${path('hold')}"/><path class="plot-line plot-guard" d="${path('guard')}"/>${cursorLine}${dots}${ending}${axis}</svg>`;
}
