export const CHART_UNITS=['day','week','month','year'];
export function chartRows(data){
 return data?.history||[];
}

// 표시 단위는 하단 달력 눈금만 바꾼다. 자산 시계열·X/Y 좌표는 건드리지 않는다.
export function timeAxisTicks(start,end,unit='day',plotWidth=260){
 const first=new Date(start+'T00:00:00Z'),last=new Date(end+'T00:00:00Z');
 if(!Number.isFinite(+first)||!Number.isFinite(+last)||last<first)return [];
 const day=86400000,stamp=date=>date.toISOString().slice(0,10),candidates=[];
 let cursor=new Date(first);
 if(unit==='year')cursor=new Date(Date.UTC(first.getUTCFullYear(),0,1));
 else if(unit==='month')cursor=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),1));
 else if(unit==='week')cursor=new Date(+first-((first.getUTCDay()+6)%7)*day);
 while(cursor<=last){
  const next=unit==='year'?new Date(Date.UTC(cursor.getUTCFullYear()+1,0,1)):
   unit==='month'?new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,1)):
   new Date(+cursor+(unit==='week'?7:1)*day);
  const from=Math.max(+first,+cursor),to=Math.min(+last,+next-day),date=stamp(new Date(from));
  const label=unit==='year'?date.slice(0,4):unit==='month'?date.slice(0,7).replace('-','.'):
   date.slice(5).replace('-','.');
  candidates.push({position:+last===+first?0:((from+to)/2-first)/(last-first)*100,label});
  cursor=next;
 }
 const limit=Math.max(2,Math.min(5,Math.floor(plotWidth/76)));
 if(candidates.length<=limit)return candidates;
 return Array.from({length:limit},(_,i)=>candidates[Math.round(i*(candidates.length-1)/(limit-1))]);
}
