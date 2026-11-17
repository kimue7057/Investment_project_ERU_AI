import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createDashboardViews,responseRecords,responseFeedRecords} from './dashboardViews';
import {setLanguage,money} from './i18n';

const point=(date,hold,guard,btc_weight)=>({date,hold,guard,btc_weight});
function fixture(){
 const metrics={hold:{value:20000000,return_pct:-80},guard:{value:70000000,return_pct:-30},guard_btc_weight:20};
 const event={at:'2022-05-01',hold_value:50000000,guard_value:80000000,btc_weight:25};
 const d={date:'2022-11-21',phase:'bear',metrics,history:[point('2021-11-08',100000000,100000000,36),point('2022-11-21',20000000,70000000,20)],events:[event]};
 const state={run:{amount:100000000,status:'finished'},event:0,inspectIndex:null};
 const views=createDashboardViews({state,cycleData:()=>d,percent:n=>(n>0?'+':'')+n.toFixed(1)+'%',escape:s=>String(s)});
 return {state,d,views};
}

describe('date-specific account readouts',()=>{
 beforeEach(()=>{vi.stubGlobal('document',{documentElement:{lang:'en'}});setLanguage('en');});
 it('shows the selected response balances instead of the final account balances',()=>{
  const {d,views}=fixture();
  const html=views.chartReadout(d,true);
  expect(html).toContain('2022-05-01');
  expect(html).toContain(money(50000000));expect(html).toContain(money(80000000));
  expect(html).toContain('-50.0%');expect(html).toContain('-20.0%');
  expect(html).not.toContain(money(20000000));
 });
 it('allows inspecting the first day and computes returns against the original comparison amount',()=>{
  const {state,d,views}=fixture();state.inspectIndex=0;
  const html=views.chartReadout(d);
  expect(html).toContain('2021-11-08');
  expect(html.match(/0\.0%/g)).toHaveLength(2);
  expect(html).not.toContain('-80.0%');
 });
 it('keeps both asset balances during preparation and shows cash allocation as supporting information',()=>{
  const {state,d,views}=fixture();d.phase='preparation';state.inspectIndex=0;
  const html=views.chartReadout(d);
  expect(html).toContain('64.0');expect(html).toContain('36.0');
  expect(html).toContain(money(100000000));expect(html).toContain('guard-allocation');
 });
 it('keeps legacy preparation records readable without inferring cash weights',()=>{
  const {d,views}=fixture();d.phase='preparation';d.history.forEach(p=>delete p.btc_weight);
  expect(views.chartReadout(d)).toContain(money(70000000));
 });
 it('preserves Korean amounts and labels for the selected date',()=>{
  setLanguage('ko');const {state,d,views}=fixture();state.inspectIndex=0;
  const html=views.chartReadout(d);
  expect(html).toContain('1억 원');expect(html).toContain('단순 보유');expect(html).toContain('선택일 종가');
 });
});

describe('continuous response history',()=>{
 beforeEach(()=>{vi.stubGlobal('document',{documentElement:{lang:'en'}});setLanguage('en');});
 it('shows responses omitted from chart highlights and retains earlier-phase records',()=>{
  const {d,views}=fixture();
  const record=(id,at,phase)=>({id,at,phase,kind:'sell',signal_at:'2021-11-01',trade_value:1000000,cash_after:9000000,btc_weight:90});
  d.events=[];
  d.preparation={response_log:[record('prep','2021-11-07','preparation')]};
  d.response_log=Array.from({length:5},(_,i)=>record('live-'+i,'2022-01-0'+(i+1),'bear'));
  const before=JSON.stringify(d),html=views.responseLog(d);
  expect((html.match(/data-action="response-info"/g)||[])).toHaveLength(6);
  expect(html).toContain('data-id="prep"');expect(html).toContain('data-id="live-4"');
  expect(html.indexOf('data-id="live-4"')).toBeLessThan(html.indexOf('data-id="prep"'));
  expect(html).toContain('Cash after');expect(html).toContain('Next-open fill');
  expect(responseFeedRecords(d)).toHaveLength(6);expect(JSON.stringify(d)).toBe(before);
 });
 it('uses finished records for legacy data and respects an explicitly empty live log',()=>{
  expect(responseRecords({all_events:[{id:'old'}],events:[]})).toEqual([{id:'old'}]);
  expect(responseRecords({response_log:[],events:[{id:'highlight'}]})).toEqual([]);
 });
 it('makes it clear when playback has not reached any response yet',()=>{
  const {d,views}=fixture();d.events=[];d.response_log=[];
  expect(views.responseLog(d)).toContain('No response yet');
 });
});
