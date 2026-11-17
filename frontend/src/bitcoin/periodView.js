export const CHART_UNITS=['day','week','month','year'];
export function chartRows(data,unit='day'){
 return unit!=='day'&&data?.period_history?.[unit]?data.period_history[unit]:data?.history||[];
}
export function playbackPosition(cycle,phase,position,bear=true){
 const p=Math.max(0,Math.min(100,position));
 return Math.min(300,cycle*100+(bear?(phase==='preparation'?p*.3:30+p*.7):p));
}
