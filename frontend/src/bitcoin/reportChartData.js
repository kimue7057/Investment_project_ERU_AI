export function reportChartData(cycle,stage){
 if(stage!=='recovery')return {...cycle,events:(cycle.all_events||cycle.response_log||cycle.events||[]).filter(e=>e.kind==='sell'||e.kind==='buy')};
 const r=cycle.recovery;
 return {start:r.start,end:r.end,date:r.end,phase:'recovery',history:r.history||[],events:[]};
}
