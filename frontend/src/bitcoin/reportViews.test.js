import {beforeEach,describe,it,expect,vi} from 'vitest';
import {emailView,reportView,decisions,summaryRows,recoveryRows} from './reportViews';
import {setLanguage} from './i18n';

// 템플릿 경계 검증용 값이며 실제 시세·운용 데이터로 사용하지 않는다.
function sample(){
 const events=[{id:'s',kind:'sell',at:'2022-01-03',signal_at:'2022-01-02',action:'일부 매도',signal:'확정 신호',trade_value:500,fee:.25,cash_after:700,btc_weight:30,hold_value:500,guard_value:800},
  {id:'w',kind:'wait',at:'2022-01-04',signal_at:'2022-01-04',action:'보류',signal:'대기',trade_value:0,fee:0,cash_after:700,btc_weight:20,hold_value:400,guard_value:750}];
 const account={peak_date:'2022-01-01',trough_date:'2022-01-11',peak_value:1000,trough_value:400,max_drawdown_pct:-60,recovery_multiple:2.5,end_value:400};
 const cycle={start:'2022-01-01',end:'2022-01-11',all_events:events,events:events.slice(0,1),summary:{hold:account,guard:{...account,trough_value:750,recovery_multiple:4/3,max_drawdown_pct:-25,end_value:750},counts:{sell:1,buy:0,wait:1,decisions:2,trades:1}},
  metrics:{hold:{value:400,return_pct:-60},guard:{value:750,return_pct:-25},difference:350,guard_fees:.25,frozen_allocation:{initial_cash_pct:50,value:700}},
  recovery:{start:'2022-01-11',end:'2023-01-01',basis:'last_confirmed_close',market_return_pct:100,market_multiple:2,hold:{starting_value:400,profit:400,end_value:800,total_return_pct:-20},guard:{starting_value:750,profit:750,end_value:1500,total_return_pct:50},starting_gap:350,ending_gap:700,gap_growth:350},
  preparation:{all_events:events}};
 return {report:{id:'local',amount:1000,cycles:[cycle]},cycle:0,stage:'bear',contact:{registered:true,recipient:'r***@example.test'},config:{local_preview:true}};
}
beforeEach(()=>{vi.stubGlobal('document',{documentElement:{}});setLanguage('ko');});
describe('완료 결과형 화면',()=>{
 it('이메일 전용 진입 화면에 금액 입력이나 재생 조작을 노출하지 않는다',()=>{
  const html=emailView({emailDraft:'',consent:false});
  expect(html).toContain('type="email"');expect(html).toContain('1억 원');expect(html).toContain('결과 바로 보기');
  expect(html).not.toMatch(/type="number"|name="amount"|data-action="play"|인증번호 입력/);
  setLanguage('en');expect(emailView({emailDraft:'',consent:false})).toContain('S$100,000');
 });
 it('이메일을 저장한 방문자도 첫 진입에서 결과로 건너뛰지 못한다',()=>{
  const state={emailDraft:'',consent:false,contact:{registered:true,recipient:'r***@example.test'}};
  expect(emailView(state)).toContain('type="email"');expect(emailView(state)).not.toContain('data-action="cancel-email"');
  expect(emailView({...state,report:{},editing:true})).toContain('data-action="cancel-email"');
 });
 it('첫 단계는 차트가 메인이며 아래 표에 총 발동 횟수만 집계한다',()=>{
  const state=sample(),c=state.report.cycles[0];
  expect(summaryRows(c,1000).find(row=>row[0]==='고점 회복 필요 배수')).toEqual(['고점 회복 필요 배수','2.50×','1.33×']);
  expect(recoveryRows(c).find(row=>row[0]==='상승 구간 끝 금액')).toEqual(['상승 구간 끝 금액','800원','1,500원']);
  const html=reportView(state,'<svg></svg>');
  for(const text of ['최대 낙폭','저점에 남은 금액','고점 발생일','저점 발생일','구간 끝 금액','실제 메일은 발송하지 않습니다'])expect(html).toContain(text);
  expect(html.indexOf('id="report-chart"')).toBeLessThan(html.indexOf('id="period-metrics"'));
  expect(summaryRows(c,1000).find(row=>row[0]==='리스크 가드 총 발동 횟수')).toEqual(['리스크 가드 총 발동 횟수','—','1회']);
  expect(html).not.toContain('매매 수수료');expect(html).not.toContain('매도 / 재매수 / 보류');expect(html).not.toContain('decision-number');
  expect(html).toContain('data-action="next-stage"');expect(html).not.toContain('id="recovery-metrics"');
  expect(html).not.toContain('data-action="unit"');expect(html).not.toContain('class="report-totals"');
 });
 it('두 번째 단계도 차트를 먼저 보여주고 그 아래 상승장 비교표를 제공한다',()=>{
  for(const locale of ['ko','en']){
   setLanguage(locale);const state=sample();state.stage='recovery';const html=reportView(state);
   expect(html).toContain('id="recovery-metrics"');expect(html).toContain('data-action="previous-stage"');
   expect(html).toContain('id="report-chart"');expect(html.indexOf('id="report-chart"')).toBeLessThan(html.indexOf('id="recovery-metrics"'));expect(html).not.toContain('id="period-metrics"');expect(html).not.toContain('data-decision=');
   expect(html).toContain(locale==='ko'?'다음 고점 미확인':'Next peak unconfirmed');
   expect(html).toContain(locale==='ko'?'기존 자금 차이의 확대분':'Increase in the capital gap');
   const selector=html.match(/<div class="report-cycles"[\s\S]*?<\/div>/)[0];
   expect(selector).toContain(locale==='ko'?'상승장 1':'Rising market 1');
   expect(selector).toContain('2022–2023');expect(selector).not.toContain(locale==='ko'?'하락장':'Bear market');
  }
 });
 it('모든 복기 기록은 유지하면서 화면과 데이터의 넘버링을 없앤다',()=>{
  const state=sample(),c=state.report.cycles[0],before=JSON.stringify(c);
  expect(decisions(c).every(e=>!('number' in e))).toBe(true);
  const html=reportView(state,'');
  expect(html.match(/class="decision-card"/g)).toHaveLength(2);
  expect(html).toContain('data-decision="1" id="decision-1"');expect(html).not.toContain('class="decision-number"');
  expect(JSON.stringify(c)).toBe(before);
 });
 it('이메일과 대응 설명에 HTML을 주입할 수 없다',()=>{
  const state=sample();state.contact.recipient='<img onerror=bad>';state.report.cycles[0].all_events[0].action='<script>bad</script>';
  const html=reportView(state,'');
  expect(html).not.toContain('<script>');expect(html).not.toContain('<img onerror');expect(html).toContain('&lt;script&gt;');
 });
});
