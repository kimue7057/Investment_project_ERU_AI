import {describe,it,expect} from 'vitest';
import {chartGeometry,renderAssetChart,representativeIndices} from './chartView';

const history=[
 {date:'2021-11-08',position:0,hold:100000000,guard:100000000,cash:64000000,btc_weight:36},
 {date:'2022-05-01',position:50,hold:50000000,guard:80000000,cash:64000000,btc_weight:20},
 {date:'2022-11-21',position:100,hold:23000000,guard:71000000,cash:64000000,btc_weight:9.8591549296},
];
const events=Array.from({length:20},(_,i)=>({id:String(i),kind:['sell','buy','wait'][i%3],at:'2022-05-01',position:i/19*100,guard_value:80000000,btc_weight:20}));
const cycle={start:'2021-11-08',end:'2022-11-21',history,events};

describe('responsive financial charts',()=>{
 it.each([288,358,398,680])('uses the available width %s without scaling labels or changing endpoint values',width=>{
  const g=chartGeometry(cycle,{width,height:250});
  expect(g.x(0)).toBe(g.left);expect(g.x(100)).toBe(width-g.right);
  expect(g.y(0)).toBe(g.top+g.plotHeight);
  expect(g.maximum).toBeCloseTo(110000000,4);
  const svg=renderAssetChart(cycle,{width,height:250});
  expect(svg).toContain(`viewBox="0 0 ${width} 250"`);
  expect(svg).not.toContain('NaN');expect(svg).not.toContain('Infinity');
 });
 it('uses actual published cash weights, including the initial allocation, on a fixed 0–100% axis',()=>{
  const g=chartGeometry(cycle,{width:358,height:250,mode:'cash'});
  expect(g.maximum).toBe(100);
  const svg=renderAssetChart(cycle,{width:358,height:250,mode:'cash'});
  expect(svg).toContain('100%');expect(svg).toContain('cash-plot');
  const expectedStart=`M${g.x(0).toFixed(2)},${g.y(64).toFixed(2)}`;
  expect(svg).toContain(expectedStart);
 });
 it('falls back to assets for legacy histories without inventing cash data',()=>{
  const old={...cycle,history:history.map(({date,position,hold,guard})=>({date,position,hold,guard}))};
  expect(renderAssetChart(old,{mode:'cash'})).not.toContain('cash-plot');
 });
 it('keeps representative actions and the selected response while limiting chart clutter',()=>{
  const selected=12,picks=representativeIndices(events,selected);
  expect(picks).toContain(selected);expect(picks).toContain(events.length-1);
  expect(picks.length).toBeLessThanOrEqual(5);
  expect(new Set(picks.map(i=>events[i].kind))).toEqual(new Set(['sell','buy','wait']));
  const svg=renderAssetChart(cycle,{markers:true,selected});
  expect((svg.match(/class="plot-hit"/g)||[]).length).toBeLessThanOrEqual(5);
  expect(svg).toContain('r="22"');expect(svg).toContain('class="plot-cursor"');
 });
 it('draws only supplied historical points and leaves the source unchanged during inspection',()=>{
  const original=JSON.stringify(cycle),partial={...cycle,history:history.slice(0,2),events:[]};
  const svg=renderAssetChart(partial,{focusIndex:1});
  const g=chartGeometry(partial);
  expect(svg).toContain(`x1="${g.x(50)}"`);
  expect(svg).not.toContain('23000000');
  expect(JSON.stringify(cycle)).toBe(original);
 });
 it('handles the first daily point without invalid paths',()=>{
  const svg=renderAssetChart({...cycle,history:history.slice(0,1),events:[]});
  expect(svg).toContain('<circle');expect(svg).not.toContain('NaN');
 });
});
