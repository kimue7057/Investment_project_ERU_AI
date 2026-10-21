import type {AssetPerformance, FilledTrade} from './model';
export type ReviewPoint = {time:string;value:number};
export type Recap = {source:'ai'|'records';status:string;paragraphs:string[];questions:string[]};
export type ReviewDecision = {id:string;at:string;action:string;summary:string;linkage:'recorded'|'legacy'|'fills_only';cancelled:boolean;situation:string;nav:string|null;composition:Record<string,string>|null;
  discussions:{id:string;at:string;question:string;paragraphs:string[];status:string}[];fills:FilledTrade[];realized_pnl:string|null;fees:string;cash_flow:string;
  comparison:{at:string;acted:string;unchanged:string;difference:string}|null;
  period:{until:string;end_nav:string;change:string}|null;marker_value:string};
export type InvestmentReviewData = {version:number;initial:string;final_nav:string;net_profit:string;return_pct:string;realized:string;unrealized:string;trading_profit:string;interest:string;fees:string;mdd_pct:string;history:ReviewPoint[];
  baseline:{label:string;nav:string;interest:string;fees:string;history:ReviewPoint[];difference:string}|null;
  decisions:ReviewDecision[];assets:AssetPerformance[];initial_plan:Record<string,string>|null;recap:Recap|null};
export function chartDomain(points:ReviewPoint[], markers:ReviewDecision[]) {
  const values=[...points.map(p=>p.value),...markers.map(d=>Number(d.marker_value))];
  const min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.12,max*.015,1);
  return {min:min-pad,max:max+pad};
}
export function decisionTitle(d:ReviewDecision) {
  if(d.cancelled) return '주문 취소됨';
  if(d.action==='start') return '첫 투자 계획';
  if(d.action==='hold'||d.action==='ignore') return '그대로 유지';
  if(d.action==='rebalance') return '비중 조정';
  if(d.action==='cancel') return '미체결 취소';
  if(d.fills.length) return d.fills.every(f=>f.side==='buy')?'매수':d.fills.every(f=>f.side==='sell')?'매도':'매도 후 매수';
  return '투자 판단';
}
export function pointAt(points:ReviewPoint[], time:number) {
  let lo=0,hi=points.length;
  while(lo<hi){const m=(lo+hi)>>>1;if(Date.parse(points[m].time)<=time)lo=m+1;else hi=m;}
  return points[Math.max(0,lo-1)];
}
export function markerLayout(markers:ReviewDecision[],start:number,end:number,domain:{min:number;max:number},width:number,height:number){
  const placed:{id:string;x:number;y:number;anchorX:number;anchorY:number}[]=[];
  for(const d of markers){
    const anchorX=(Date.parse(d.at)-start)/(end-start)*width,anchorY=(1-(Number(d.marker_value)-domain.min)/(domain.max-domain.min))*height;
    let x=anchorX,y=anchorY,found=false;
    for(let radius=0;radius<20&&!found;radius++)for(let dx=-radius;dx<=radius&&!found;dx++)for(let dy=-radius;dy<=radius&&!found;dy++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
      const cx=Math.min(width-14,Math.max(14,anchorX+dx*34)),cy=Math.min(height-14,Math.max(14,anchorY+dy*34));
      if(placed.every(p=>Math.hypot(p.x-cx,p.y-cy)>=32)){x=cx;y=cy;found=true;}
    }
    placed.push({id:d.id,x,y,anchorX,anchorY});
  }
  return placed.map(p=>({...p,x:p.x/width*100,y:p.y/height*100,anchorX:p.anchorX/width*100,anchorY:p.anchorY/height*100}));
}
