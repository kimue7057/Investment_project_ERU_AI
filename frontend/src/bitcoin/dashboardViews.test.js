import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createDashboardViews} from './dashboardViews';
import {setLanguage,money} from './i18n';

const point=(date,hold,guard,btc_weight)=>({date,hold,guard,btc_weight});
function fixture(){
 const metrics={hold:{value:20000000,return_pct:-80},guard:{value:70000000,return_pct:-30},guard_btc_weight:20};
 const event={at:'2022-05-01',hold_value:50000000,guard_value:80000000,btc_weight:25};
 const d={date:'2022-11-21',phase:'bear',metrics,history:[point('2021-11-08',100000000,100000000,36),point('2022-11-21',20000000,70000000,20)],events:[event]};
 const state={run:{amount:100000000,status:'finished'},event:0,inspectIndex:null};
 const views=createDashboardViews({state,cycleData:()=>d,percent:n=>(n>0?'+':'')+n.toFixed(1)+'%'});
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
 it('shows actual allocation at the inspected preparation date without treating earlier gains as bear returns',()=>{
  const {state,d,views}=fixture();d.phase='preparation';state.inspectIndex=0;
  const html=views.chartReadout(d);
  expect(html).toContain('64.0');expect(html).toContain('36.0');
  expect(html).not.toContain(money(100000000));
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
