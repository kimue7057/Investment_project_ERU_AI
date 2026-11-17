import {describe,it,expect} from 'vitest';
import {financialModel,nearestPoint,financialMarkers} from './financialModel';

const data={start:'2022-01-01',end:'2022-01-11',phase:'bear',history:[
 {date:'2022-01-01',position:0,hold:100,guard:100},
 {date:'2022-01-03',position:20,hold:60,guard:85},
 {date:'2022-01-10',position:90,hold:30,guard:72},
 {date:'2022-01-11',position:100,hold:20,guard:70}],
 events:[{id:'sell',kind:'sell',position:20,at:'2022-01-03',guard_value:85}]};

describe('native financial chart data boundary',()=>{
 it('preserves every original value and the calendar spacing of sparse daily samples',()=>{
  const before=JSON.stringify(data),m=financialModel(data);
  expect(m.hold.map(p=>p.value)).toEqual(data.history.map(p=>p.hold));
  expect(m.guard.map(p=>p.value)).toEqual(data.history.map(p=>p.guard));
  expect(m.points.map(p=>p.step)).toEqual([0,2,9,10]);
  expect(m.timeline).toHaveLength(11);
  expect(m.timeline.every(p=>Object.keys(p).join()==='time')).toBe(true);
  expect(m.hold.map(p=>m.timeline.findIndex(t=>t.time===p.time))).toEqual([0,2,9,10]);
  expect(JSON.stringify(data)).toBe(before);
 });
 it('keeps initial capital and the first close as separate points on the same date',()=>{
  const pre={...data,phase:'preparation',start:'2022-01-01',end:'2022-01-02',history:[
   {date:'2022-01-01',position:0,hold:100,guard:100},
   {date:'2022-01-01',position:50,hold:99,guard:99},
   {date:'2022-01-02',position:100,hold:90,guard:95}]};
  const m=financialModel(pre);
  expect(m.hold).toHaveLength(3);expect(new Set(m.hold.map(p=>p.time)).size).toBe(3);
  expect(m.hold.map(p=>new Date(p.time*1000).toISOString().slice(0,10))).toEqual(pre.history.map(p=>p.date));
 });
 it('creates no asset values or timeline slots after the last published point',()=>{
  const m=financialModel({...data,history:data.history.slice(0,2)});
  expect(m.lastStep).toBe(2);expect(m.timeline).toHaveLength(3);expect(m.events).toHaveLength(1);
  expect(m.guard.at(-1).value).toBe(85);
 });
 it('selects real published points between samples without interpolating balances',()=>{
  const m=financialModel(data);
  expect(nearestPoint(m,6).guard).toBe(72);
  expect(nearestPoint(m,3).date).toBe('2022-01-03');
  expect(nearestPoint(m,Number.NaN)).toBeNull();
 });
 it('keeps risk-response identity and date for native marker clicks',()=>{
  const m=financialModel(data),markers=financialMarkers(m,'sell');
  expect(markers[0].id).toBe('sell');expect(markers[0].shape).toBe('arrowDown');
  expect(markers[0].time).toBe(m.guard[1].time);
 });
 it('numbers every decision without dropping records or changing the source',()=>{
  const all={...data,events:Array.from({length:10},(_,i)=>({...data.events[0],id:'decision-'+i}))};
  const before=JSON.stringify(all),m=financialModel(all),markers=financialMarkers(m,'decision-7',true);
  expect(markers.map(e=>e.text)).toEqual(Array.from({length:10},(_,i)=>String(i+1)));
  expect(markers[7].color).toBe('#ffffff');expect(markers.map(e=>e.id)).toEqual(all.events.map(e=>e.id));
  expect(JSON.stringify(all)).toBe(before);
 });
 it('shows only the selected number while retaining every response marker',()=>{
  const all={...data,events:Array.from({length:20},(_,i)=>({...data.events[0],id:'decision-'+i}))},m=financialModel(all);
  const markers=financialMarkers(m,'decision-7','selected');
  expect(markers).toHaveLength(20);
  expect(markers.filter(e=>e.text).map(e=>e.text)).toEqual(['8']);
  expect(markers.every(e=>e.shape==='circle')).toBe(true);
  expect(financialMarkers(m,null,'selected').some(e=>e.text)).toBe(false);
 });
 it('changes axis labels without replacing or reducing the source points',()=>{
  const values=financialModel(data).guard;
  for(const unit of ['day','week','month','year']){
   expect(financialModel({...data,chart_unit:unit}).guard).toEqual(values);
  }
 });
});
