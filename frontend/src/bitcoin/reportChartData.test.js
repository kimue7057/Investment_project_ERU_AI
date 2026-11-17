import {describe,it,expect} from 'vitest';
import {reportChartData} from './reportChartData';
import {financialModel,financialMarkers} from './financialModel';

describe('단계별 차트와 실제 발동 경계',()=>{
 it('하락장의 원래 선과 모든 복기 기록은 유지하고 실제 체결만 차트 점으로 표시한다',()=>{
  const c={history:[{date:'2022-01-01',position:0,hold:100,guard:100}],all_events:[{id:'s',kind:'sell'},{id:'b',kind:'buy'},{id:'w',kind:'wait'}]};
  const before=JSON.stringify(c),d=reportChartData(c,'bear');
  expect(d.history).toBe(c.history);expect(d.events.map(e=>e.id)).toEqual(['s','b']);expect(c.all_events).toHaveLength(3);
  expect(JSON.stringify(c)).toBe(before);
 });
 it('상승장에는 서버가 제공한 실제 일별 두 잔액만 전달하고 발동 점과 번호를 만들지 않는다',()=>{
  const history=[{date:'2022-01-01',position:0,hold:20,guard:60},{date:'2022-01-02',position:50,hold:18,guard:54},{date:'2022-01-03',position:100,hold:40,guard:120}];
  const c={recovery:{start:'2022-01-01',end:'2022-01-03',history}},d=reportChartData(c,'recovery'),model=financialModel(d);
  expect(d.history).toBe(history);expect(d.events).toEqual([]);expect(model.steps).toBe(2);
  expect(model.guard.map(p=>p.value)).toEqual([60,54,120]);
  expect(model.points.map(p=>p.step)).toEqual([0,1,2]);expect(financialMarkers(model,null,'dots')).toEqual([]);
 });
 it('선택한 발동을 강조해도 어떠한 번호도 추가하지 않는다',()=>{
  const events=[{id:'s',kind:'sell',at:'2022-01-01',position:0}],d={start:'2022-01-01',end:'2022-01-02',phase:'bear',history:[{date:'2022-01-01',position:0,hold:100,guard:100}],events};
  const markers=financialMarkers(financialModel(d),'s','dots');
  expect(markers).toHaveLength(1);expect(markers[0].id).toBe('s');expect(markers[0]).not.toHaveProperty('text');
 });
});
