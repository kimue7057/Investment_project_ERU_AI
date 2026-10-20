// 실제 과거 시세와 실제 활성 시간으로 V3 전체 흐름을 확인한다.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base = (process.env.ERU_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/,'');
const out = path.resolve(__dirname,'../test-results');
const prefix = (base.startsWith('https:') ? 'guided-cloud':'guided-local') + (process.env.ERU_E2E_QUICK==='1' ? '-quick':'');
fs.mkdirSync(out,{recursive:true});
(async()=>{
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1050},locale:'ko-KR'});
  const page = await context.newPage(), errors = [];
  let sid, transientReads = 0, latest, guards = 0;
  page.setDefaultTimeout(35000);
  page.on('pageerror',e=>errors.push(e.message));
  async function get() {
    for(let i=0;i<3;i++) {
      const r = await context.request.get(base+'/api/sessions/'+sid);
      if(r.ok()) return r.json();
      if([409,503].includes(r.status()) && i<2) {transientReads++;await page.waitForTimeout(600);continue;}
      throw new Error('상태 응답: '+r.status()+' '+(await r.text()).slice(0,120));
    }
  }
  async function wait(fn) {for(let i=0;i<80;i++){const g=await get();latest=g;if(fn(g))return g;await page.waitForTimeout(450);}throw new Error('상태 확인 시간 초과');}
  async function fillPlan(cash,a) {
    await page.getByRole('spinbutton',{name:'현금 비중',exact:true}).fill(String(cash));
    for(const [alias,w] of [['A',a],['B',0],['C',0],['D',0]]) await page.getByRole('spinbutton',{name:'코인 '+alias+' 비중',exact:true}).fill(String(w));
  }
  async function approveHold() {
    await page.getByRole('button',{name:'그대로 유지',exact:true}).click();
    await page.getByRole('button',{name:'유지 선택 확인',exact:true}).click();
    const [response] = await Promise.all([
      page.waitForResponse(r=>r.request().method()==='POST' && r.url().endsWith('/approved-order')),
      page.getByRole('button',{name:'유지하고 시장 재개',exact:true}).click(),
    ]);
    assert(response.ok(),'유지 승인 응답 실패: '+response.status());
    latest = await response.json();
  }
  try {
    const recovery = process.env.ERU_RESUME_PATH ? JSON.parse(fs.readFileSync(process.env.ERU_RESUME_PATH,'utf8').replace(/^\uFEFF/,'')) : null;
    if(recovery) {sid=recovery.id;await context.addInitScript(id=>localStorage.setItem('eru-guided-v3-session',id),sid);}
    await page.goto(base);
    if(recovery) {
      latest = await get();assert.equal(latest.mode,'guided');assert.equal(latest.trades.length,3);
      await page.getByRole('heading',{name:'나의 투자 여정',exact:true}).waitFor();
      if(latest.status==='paused' && !latest.alerts.some(a=>a.decision===null)) {
        const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/resume') && r.request().method()==='POST'),page.getByRole('button',{name:'시장 재개',exact:true}).click()]);
        assert(r.ok());latest=await r.json();
      }
      console.log(JSON.stringify({stage:'recovered-same-game',elapsed:latest.elapsed,trades:latest.trades.length}));
    } else {
    await page.getByRole('heading',{name:'어떤 투자 방식이 나에게 맞을까요?',exact:true}).waitFor();
    sid = await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
    assert(sid); fs.writeFileSync(path.join(out,prefix+'-session.json'),JSON.stringify({id:sid}));
    latest = await get(); assert.equal(latest.mode,'guided'); assert.equal(latest.cash,100000000); assert.equal(latest.interest_account.accrued,0);
    assert(!('research' in latest));
    await page.screenshot({path:path.join(out,prefix+'-01-learn.png'),fullPage:true});
    await page.getByRole('button',{name:'균형형',exact:true}).click();
    await page.getByRole('button',{name:'이 성향으로 계속',exact:true}).click();
    await page.getByRole('spinbutton',{name:'현금 비중',exact:true}).fill('30');
    await page.getByRole('button',{name:'투자할 종목 고르기',exact:true}).click();
    await page.getByRole('checkbox',{name:'코인 A 선택',exact:true}).check();
    await page.getByRole('button',{name:'현금 이자는 어떻게 쌓여?',exact:true}).click();
    const prepared = await wait(g=>g.chat.length===1);
    assert.equal(prepared.status,'ready');assert.equal(prepared.pending,null);assert.equal(prepared.trades.length,0);
    assert(prepared.chat.length===1 && prepared.chat[0].paragraphs.some(p=>/이자|금리/.test(p)));
    if(process.env.ERU_REQUIRE_AI==='1')assert.equal(prepared.chat[0].source,'ai',prepared.chat[0].status);
    await page.getByRole('button',{name:'이 구성 확인하기',exact:true}).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button',{name:'이 구성으로 투자 시작',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({path:path.join(out,prefix+'-02-start.png'),fullPage:true});
    await page.getByRole('button',{name:'확정하고 자동 투자 시작',exact:true}).click();
    latest = await wait(g=>g.trades.length===1 && g.status==='paused' && g.alerts.some(a=>a.decision===null));
    assert.equal(latest.trades[0].reason,'initial');assert(latest.interest_account.accrued>0);
    const held = Number(latest.holdings[0].quantity), fixed = latest.now;
    await page.getByRole('heading',{name:'지금, 어떤 선택이 좋을까요?',exact:true}).waitFor();
    await page.waitForTimeout(750);assert.equal((await get()).now,fixed);
    await page.screenshot({path:path.join(out,prefix+'-03-guard.png'),fullPage:true});
    if(process.env.ERU_REQUIRE_AI==='1') {
      await page.waitForTimeout(2100);
      const beforeGuard=await get();
      await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill('지금 가드가 뜬 이유를 현재 보유 비중과 연결해서 설명해줘. 그대로 유지하는 것과 코인 A 보유 수량의 25%를 매도하는 선택을 비교해줘. 아직 구성 제안이나 주문은 하지 마.');
      const [chatResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/chat')&&r.request().method()==='POST',{timeout:60000}),page.getByRole('button',{name:'질문하기',exact:true}).click()]);
      assert(chatResponse.ok());latest=await chatResponse.json();const answer=latest.chat.at(-1);
      assert.equal(answer.source,'ai',answer.status);assert.equal(answer.weights,null);
      assert.equal(latest.now,beforeGuard.now);assert.equal(latest.status,'paused');assert.equal(latest.pending,null);assert.equal(latest.trades.length,beforeGuard.trades.length);
      assert(/집중|비중/.test(answer.paragraphs.join(' ')));
      await page.screenshot({path:path.join(out,prefix+'-guard-discussion.png'),fullPage:true});
    }
    await page.getByRole('button',{name:'이 제안을 주문 초안에 담기 →',exact:true}).click();
    await page.getByRole('spinbutton',{name:'매도 비율',exact:true}).fill('25');
    await page.getByRole('button',{name:'변경 내용 확인',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button',{name:'이 주문 승인하고 자동 실행',exact:true}).click();
    latest = await wait(g=>g.trades.length===2);
    assert(Math.abs(Number(latest.holdings[0].quantity)/held-.75)<1e-10);
    assert.equal(latest.alerts[0].decision,'approved');
    await page.getByRole('button',{name:'AI와 구성 다시 논의',exact:true}).click();
    await page.getByRole('button',{name:'전체 비중 조정',exact:true}).click();
    await fillPlan(100,0);
    await page.getByRole('button',{name:'변경 내용 확인',exact:true}).click();
    await page.getByRole('button',{name:'이 주문 승인하고 자동 실행',exact:true}).click();
    latest = await wait(g=>g.trades.length===3 && g.holdings.every(h=>Number(h.quantity)===0));
    assert.equal(Number(latest.initial_plan.A),70);
    await page.reload();
    await page.getByRole('heading',{name:'나의 투자 여정',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session')),sid);
    await page.getByRole('button',{name:'잠시 멈추기',exact:true}).click();
    latest = await wait(g=>g.status==='paused');
    const interest = latest.interest_account.accrued, now = latest.now;
    await page.waitForTimeout(1200);
    const again = await get(); assert.equal(again.now,now);assert.equal(again.interest_account.accrued,interest);
    await page.screenshot({path:path.join(out,prefix+'-04-portfolio.png'),fullPage:true});
    for(const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(out,prefix+'-05-mobile-'+width+'.png'),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1050});
    await page.getByRole('button',{name:'시장 재개',exact:true}).click();
    console.log(JSON.stringify({stage:'core-flow-passed',base,elapsed:latest.elapsed,trades:latest.trades.length,source:latest.chat[0].source,errors}));
    }
    if(process.env.ERU_E2E_QUICK!=='1') {
      let bucket = -1;
      for(let i=0;i<1050;i++) {
        latest = await get();
        if(latest.status==='finished') break;
        if(latest.status==='paused') {
          if(latest.alerts.some(a=>a.decision===null)) {
            guards++;
            await approveHold();
          } else await page.getByRole('button',{name:'시장 재개',exact:true}).click();
        }
        if(Math.floor(latest.elapsed/40)>bucket) {bucket=Math.floor(latest.elapsed/40);console.log(JSON.stringify({stage:'replaying',elapsed:latest.elapsed,guards}));}
        await page.waitForTimeout(650);
      }
      assert.equal(latest.status,'finished');assert.equal(latest.elapsed,300);assert(latest.interest_account.settled);
      assert(Math.abs(latest.nav-latest.initial-latest.trading_profit-latest.interest_account.accrued)<.00001);
      await page.getByRole('heading',{name:'이번 투자 실험을 마쳤어요',exact:true}).waitFor();
      await page.getByRole('button',{name:'실제 자산 확인',exact:true}).click();
      assert((await page.locator('main').innerText()).includes('BTC'));
      await page.screenshot({path:path.join(out,prefix+'-06-result.png'),fullPage:true});
      await page.getByRole('button',{name:'새 계획으로 다시 투자',exact:true}).click();
      await page.getByRole('heading',{name:'어떤 투자 방식이 나에게 맞을까요?',exact:true}).waitFor();
      assert.notEqual(await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session')),sid);
    }
    assert.deepEqual(errors,[]);
    const report = {base,passed:true,recoveredSession:!!recovery,elapsed:latest.elapsed,trades:latest.trades.length,interest:latest.interest_account.accrued,guards,source:latest.chat[0].source,transientReads,errors};
    fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } catch(e) {
    await page.screenshot({path:path.join(out,prefix+'-failure.png'),fullPage:true}).catch(()=>{});
    fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify({base,passed:false,error:e.message,elapsed:latest?.elapsed,errors},null,2));
    throw e;
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
