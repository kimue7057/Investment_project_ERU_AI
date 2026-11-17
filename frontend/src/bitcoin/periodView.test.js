import {describe,it,expect} from 'vitest';
import {chartRows,CHART_UNITS,timeAxisTicks} from './periodView';
import {renderAssetChart} from './chartView';

const data={start:'2021-11-08',end:'2022-11-21',history:[
 {date:'2021-11-08',position:0,hold:100,guard:100},
 {date:'2021-12-31',position:14,hold:65,guard:85},
 {date:'2022-04-01',position:38,hold:82,guard:94},
 {date:'2022-06-30',position:62,hold:35,guard:70},
 {date:'2022-11-21',position:100,hold:23,guard:71}],
 events:[{kind:'sell',at:'2021-12-31',position:14,guard_value:85}]};
const curves=svg=>svg.match(/<path class="plot-line[^>]+>/g);
const markers=svg=>svg.match(/<g class="chart-marker[\s\S]*?<\/g>/g);

describe('time axis units preserve financial chart geometry',()=>{
 it('always uses the original daily history, including when old period aggregates are present',()=>{
  const d={...data,period_history:{year:[data.history[0],data.history.at(-1)]}};
  for(const unit of CHART_UNITS)expect(chartRows(d,unit)).toBe(d.history);
 });
 it.each(CHART_UNITS)('%s changes only the time axis, preserving all line points, response markers and the cursor',unit=>{
  const before=JSON.stringify(data);
  const base=renderAssetChart({...data,chart_unit:'day'},{markers:true,selected:0});
  const svg=renderAssetChart({...data,chart_unit:unit},{markers:true,selected:0});
  expect(curves(svg)).toEqual(curves(base));expect(markers(svg)).toEqual(markers(base));
  expect(svg.match(/<line class="plot-cursor"[^>]+>/g)).toEqual(base.match(/<line class="plot-cursor"[^>]+>/g));
  expect((curves(svg)[0].match(/L/g)||[])).toHaveLength(data.history.length-1);
  expect(JSON.stringify(data)).toBe(before);
 });
 it('formats calendar years and months differently without changing the date range',()=>{
  expect(timeAxisTicks(data.start,data.end,'year',600).map(p=>p.label)).toEqual(['2021','2022']);
  expect(timeAxisTicks(data.start,data.end,'month',260).every(p=>/^\d{4}\.\d{2}$/.test(p.label))).toBe(true);
  expect(timeAxisTicks(data.start,data.end,'day',260).every(p=>/^\d{2}\.\d{2}$/.test(p.label))).toBe(true);
 });
 it('uses Monday weeks across leap day and keeps labels inside the chart',()=>{
  const ticks=timeAxisTicks('2024-02-26','2024-03-10','week',600);
  expect(ticks.map(t=>t.label)).toEqual(['02.26','03.04']);
  expect(ticks.every(t=>t.position>=0&&t.position<=100)).toBe(true);
 });
 it('keeps mobile tick density readable and handles a single-day domain',()=>{
  expect(timeAxisTicks(data.start,data.end,'day',193)).toHaveLength(2);
  expect(timeAxisTicks('2022-01-01','2022-01-01','year')).toEqual([{position:0,label:'2022'}]);
 });
});
