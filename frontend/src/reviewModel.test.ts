import {describe,it,expect} from 'vitest';
import {pointAt,chartDomain,markerLayout,type ReviewDecision} from './reviewModel';
describe('투자 복기 차트',()=>{
  const points=[{time:'2022-11-07T00:00:00+09:00',value:100},{time:'2022-11-08T09:00:00+09:00',value:120}];
  it('날짜 탐색은 미래의 자산값을 사용하지 않는다',()=>{
    expect(pointAt(points,Date.parse('2022-11-08T08:59:59+09:00'))).toEqual(points[0]);
    expect(pointAt(points,Date.parse(points[1].time))).toEqual(points[1]);
  });
  it('자산이 일정한 경우와 관측 사이의 판단 마커도 차트 범위에 포함한다',()=>{
    const constant=chartDomain([points[0]],[]);expect(constant.min).toBeLessThan(100);expect(constant.max).toBeGreaterThan(100);
    const domain=chartDomain(points,[{marker_value:'140'} as ReviewDecision]);expect(domain.max).toBeGreaterThan(140);
  });
  it('같은 날짜의 여러 판단도 모바일 차트에서 겹치지 않는다',()=>{
    const markers=Array.from({length:7},(_,i)=>({id:String(i),at:points[0].time,marker_value:'100'} as ReviewDecision));
    const layout=markerLayout(markers,Date.parse(points[0].time),Date.parse(points[1].time),{min:90,max:130},230,210);
    for(const a of layout)for(const b of layout)if(a.id!==b.id)expect(Math.hypot((a.x-b.x)*2.3,(a.y-b.y)*2.1)).toBeGreaterThanOrEqual(31.99);
  });
});
