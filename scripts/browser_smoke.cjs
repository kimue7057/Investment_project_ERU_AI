// End-to-end verification against a local server; only genuine historical data.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const runtime = path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {chromium} = require(process.env.ERU_PLAYWRIGHT_PATH || runtime);
const root = path.resolve(__dirname, '..');
const base = (process.env.ERU_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/,'');
const out = path.join(root, 'test-results');
fs.mkdirSync(out, {recursive:true});
(async()=>{
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  await page.getByRole('button',{name:'투자상품 탐색하기 →'}).waitFor();
  await page.screenshot({path:path.join(out,'01-intro.png'),fullPage:true});
  await page.getByRole('button',{name:'투자상품 탐색하기 →'}).click();
  await page.getByRole('heading',{name:'투자하기 전에, 먼저 알아보세요.'}).waitFor();
  await page.screenshot({path:path.join(out,'02-catalog.png'),fullPage:true});
  await page.getByRole('button',{name:'투자 정보 보기 ↗'}).click();
  await page.getByRole('heading',{name:'핵심 기술과 공급 구조'}).waitFor();
  assert(!/bitcoin|ethereum|solana|dogecoin|BTC|ETH|SOL|DOGE/i.test(await page.locator('main').innerText()));
  await page.getByRole('button',{name:'비중 설정으로 이동'}).click();
  const cash=page.getByRole('spinbutton',{name:'현금 비중',exact:true});
  await cash.fill('21');
  assert(await page.getByRole('button',{name:'투자 시작 →'}).isDisabled());
  await cash.fill('20');
  await page.screenshot({path:path.join(out,'03-allocation.png'),fullPage:true});
  await page.getByRole('button',{name:'투자 시작 →'}).click();
  await page.getByRole('heading',{name:/^시뮬레이션 (진행 중|일시정지)$/}).waitFor();
  const sid=await page.evaluate(()=>localStorage.getItem('eru-session'));
  if(base.startsWith('https://'))fs.writeFileSync(path.join(out,'cloud-test-session.json'),JSON.stringify({id:sid,base}));
  const api = async(action,body)=>{
    const r=body===undefined?await context.request.get(`${base}/api/sessions/${sid}`):await context.request.post(`${base}/api/sessions/${sid}/${action}`,{data:body});
    const data=await r.json();
    assert(r.ok(),JSON.stringify(data));
    return data;
  };
  let g=await api();
  if(g.status==='running')g=await api('pause',{});
  for(const a of g.alerts.filter(a=>a.decision===null))await api('decision',{alert_id:a.id,action:'ignore'});
  if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  if(await page.getByRole('button',{name:'확인',exact:true}).count())await page.getByRole('button',{name:'확인',exact:true}).click();
  await page.getByRole('button',{name:'매수 · 매도 ↗'}).click();
  await page.getByLabel('주문 금액',{exact:true}).fill('1000000');
  await page.screenshot({path:path.join(out,'04-trade.png'),fullPage:true});
  await page.getByRole('button',{name:'매수 주문 접수'}).click();
  await page.getByText('체결 대기 · 코인 A 매수',{exact:false}).waitFor();
  g=await api();assert(g.pending?.kind==='trade');
  const paused=g.now;await page.waitForTimeout(1000);assert.equal((await api()).now,paused);
  await page.getByRole('button',{name:'▶ 시장 재개'}).click();
  await page.waitForTimeout(600);
  g=await api();
  if(g.status==='running')g=await api('pause',{});
  for(const a of g.alerts.filter(a=>a.decision===null))await api('decision',{alert_id:a.id,action:'ignore'});
  await page.waitForTimeout(600);
  if(await page.getByRole('button',{name:'확인',exact:true}).count())await page.getByRole('button',{name:'확인',exact:true}).click();
  await page.getByRole('button',{name:'비중 조정 ↗'}).click();
  await page.getByRole('spinbutton',{name:'현금 비중',exact:true}).fill('30');
  await page.getByRole('spinbutton',{name:'코인 A 비중',exact:true}).fill('20');
  await page.screenshot({path:path.join(out,'05-rebalance.png'),fullPage:true});
  await page.getByRole('button',{name:'리밸런싱 주문 →'}).click();
  await page.getByText('체결 대기 · 리밸런싱',{exact:false}).waitFor();
  assert.equal((await api()).pending.kind,'rebalance');
  await page.getByRole('button',{name:'▶ 시장 재개'}).click();
  await page.waitForTimeout(600);
  g=await api();if(g.status==='running')await api('pause',{});
  await page.waitForTimeout(600);
  assert((await page.locator('.chart-wrap').boundingBox()).height<=300,'Chart must not grow during resize');
  await page.screenshot({path:path.join(out,'06-dashboard.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(200);
  await page.screenshot({path:path.join(out,'07-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
  await page.setViewportSize({width:1440,height:1000});
  if(process.env.ERU_E2E_QUICK==='1'){
    assert.deepEqual(errors,[]);
    console.log('Final-build browser UI, trade, rebalance, pause and mobile checks passed.');
    await browser.close();return;
  }
  const started=Date.now();let polls=0,autoPauses=0,accepted=0;
  // 300 seconds of actual wall-clock replay. Pauses are explicitly resumed.
  for(;;){
    g=await api();polls++;
    if(polls%60===0)console.log(JSON.stringify({checked:polls,active_seconds:g.elapsed,game_now:g.now}));
    if(g.status!=='finished'){
      assert(!/bitcoin|ethereum|solana|dogecoin|https?:\/\/|\b(?:BTC|ETH|SOL|DOGE)\b|source_pair|private_source/i.test(JSON.stringify(g)));
      for(const c of g.chart)assert(new Date(c.time+'T09:00:00+09:00').getTime()+86400000<=Date.parse(g.now));
    }
    if(g.status==='finished')break;
    if(g.status==='paused'){
      autoPauses++;
      for(const a of g.alerts.filter(a=>a.decision===null)){
        const action=a.kind==='risk'&&!g.pending&&accepted<2?'accept':'ignore';
        await api('decision',{alert_id:a.id,action});if(action==='accept')accepted++;
      }
      await api('resume',{});
    }
    if(Date.now()-started>(base.startsWith('http://127.0.0.1')?420000:900000))throw new Error('Wall-clock replay timeout');
    await page.waitForTimeout(250);
  }
  await page.getByRole('heading',{name:'나의 선택, 투자 결과는?'}).waitFor();
  await page.screenshot({path:path.join(out,'08-result.png'),fullPage:true});
  await page.getByRole('button',{name:'전략 비교 · 자산 정체 공개 →'}).click();
  await page.getByText('비트코인 · BTC',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'09-reveal.png'),fullPage:true});
  const result={wall_seconds:(Date.now()-started)/1000,elapsed:g.elapsed,polls,autoPauses,accepted,final_nav:g.nav,return_pct:g.return_pct,mdd_pct:g.mdd_pct,trades:g.trades.length,errors};
  await page.getByRole('button',{name:'다른 전략으로 재도전 ↻'}).click();
  await page.getByRole('heading',{name:'투자하기 전에, 먼저 알아보세요.'}).waitFor();
  const retryId=await page.evaluate(()=>localStorage.getItem('eru-session'));assert.notEqual(retryId,sid);
  const retry=await (await context.request.get(`${base}/api/sessions/${retryId}`)).json();
  assert.equal(retry.cash,100000000);assert.equal(retry.elapsed,0);assert.deepEqual(retry.trades,[]);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify({...result,retry_reset_passed:true},null,2));
  console.log(JSON.stringify(result,null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
