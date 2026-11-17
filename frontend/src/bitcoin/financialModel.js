import {representativeIndices} from './chartView';

const DAY=86400;
export function financialModel(data){
 const rows=data.history||[],start=Date.parse(data.start+'T00:00:00Z')/1000;
 const days=Math.round((Date.parse(data.end+'T00:00:00Z')/1000-start)/DAY);
 // 사전 운용·이전 기록은 첫 매수 직후와 첫날 종가를 별개 점으로 보존한다.
 const initial=data.phase!=='bear'&&data.phase!=='recovery',steps=Math.max(1,days+(initial?1:0));
 const timeAt=index=>start+index*DAY-(initial&&index>0?1:0);
 const points=rows.map((p,index)=>({...p,index,step:Math.round(p.position/100*steps)}));
 const lastStep=points.at(-1)?.step||0;
 const timeline=Array.from({length:lastStep+1},(_,i)=>({time:timeAt(i)}));
 const series=key=>points.map(p=>({time:timeAt(p.step),value:p[key]}));
 return {points,timeline,hold:series('hold'),guard:series('guard'),steps,lastStep,timeAt,
  // 누락된 날짜에는 가격을 만들지 않고 숨은 시간축의 공백 점만 둔다.
  events:(data.events||[]).filter(e=>Math.round(e.position/100*steps)<=lastStep&&e.at<=rows.at(-1)?.date)};
}

export function nearestPoint(model,logical){
 if(!model.points.length||!Number.isFinite(logical))return null;
 return model.points.reduce((best,p)=>Math.abs(p.step-logical)<Math.abs(best.step-logical)?p:best);
}

export function financialMarkers(model,selectedId,numbered=false){
 const selected=model.events.findIndex(e=>e.id===selectedId);
 const compact=numbered==='selected'||numbered==='dots';
 const indices=numbered?model.events.map((_,i)=>i):representativeIndices(model.events,selected);
 return indices.map(i=>{
  const e=model.events[i];
  return {id:e.id,time:model.timeAt(Math.round(e.position/100*model.steps)),
   position:compact?'inBar':e.kind==='buy'?'belowBar':'aboveBar',shape:compact?'circle':e.kind==='buy'?'arrowUp':e.kind==='sell'?'arrowDown':'circle',
   color:e.id===selectedId?'#ffffff':compact?'#6d9990':e.kind==='sell'?'#edc17d':e.kind==='buy'?'#8fb8ef':'#aebace',size:e.id===selectedId?1.2:compact?.35:.65,
   ...(numbered===true||(numbered==='selected'&&e.id===selectedId)?{text:String(i+1)}:{})};
 });
}
