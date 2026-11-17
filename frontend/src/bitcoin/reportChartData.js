export function reportChartData(cycle,stage){
 if(stage!=='recovery')return {...cycle,events:[]};
 const r=cycle.recovery;
 return {start:r.start,end:r.end,date:r.end,phase:'recovery',history:r.history||[],events:[]};
}
