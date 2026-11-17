import {describe,it,expect} from 'vitest';
import {chartRows,playbackPosition} from './periodView';
import {chartGeometry} from './chartView';

describe('chart interval and playback mapping',()=>{
 it('uses the server-published period closes without creating interpolated asset values',()=>{
  const d={history:[{date:'2021-01-01',guard:100}],period_history:{month:[{date:'2021-01-31',guard:120}]}};
  expect(chartRows(d,'month')).toBe(d.period_history.month);
  expect(chartRows(d,'day')).toBe(d.history);
  expect(chartRows(d,'year')).toBe(d.history);
 });
 it.each([[0,'preparation',50,15],[0,'bear',0,30],[1,'bear',50,165],[2,'bear',100,300]])('maps cycle %s %s at %s to server position %s',(cycle,phase,p,expected)=>{
  expect(playbackPosition(cycle,phase,p)).toBe(expected);
 });
 it('clamps pointer positions and keeps the original legacy-cycle mapping',()=>{
  expect(playbackPosition(0,'preparation',-10)).toBe(0);
  expect(playbackPosition(2,'bear',120)).toBe(300);
  expect(playbackPosition(1,undefined,40,false)).toBe(140);
 });
 it('keeps a consistent vertical scale when a period view omits an intermediate peak',()=>{
  const d={maximum_value:150,history:[{hold:100,guard:120}]};
  expect(chartGeometry(d).maximum).toBe(165);
 });
});
