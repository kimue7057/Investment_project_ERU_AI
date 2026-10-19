// Continue a recorded verification session after the test runner is restarted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.ERU_PLAYWRIGHT_PATH||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
(async()=>{
  const {id,base}=JSON.parse(fs.readFileSync(path.join(out,'cloud-test-session.json'),'utf8'));
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ko-KR'});
  await context.addInitScript(sid=>localStorage.setItem('eru-session',sid),id);
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  const api=async(action,body)=>{
    const r=body===undefined?await context.request.get(`${base}/api/sessions/${id}`):await context.request.post(`${base}/api/sessions/${id}/${action}`,{data:body});
    const g=await r.json();assert(r.ok(),JSON.stringify(g));return g;
  };
  let g=await api(),from=g.elapsed;const begin=Date.now();
  assert(from>100&&from<=300);assert(g.trades.length>=11);
  let polls=0;
  while(g.status!=='finished'){
    assert(!/bitcoin|ethereum|solana|dogecoin|https?:\/\/|\b(?:BTC|ETH|SOL|DOGE)\b|source_pair|private_source/i.test(JSON.stringify(g)));
    for(const c of g.chart)assert(new Date(c.time+'T09:00:00+09:00').getTime()+86400000<=Date.parse(g.now));
    if(g.status==='paused'){
      for(const a of g.alerts.filter(a=>a.decision===null))await api('decision',{alert_id:a.id,action:'ignore'});
      await api('resume',{});
    }
    await page.waitForTimeout(700);g=await api();polls++;
    if(Date.now()-begin>600000)throw new Error('Resume verification timeout');
  }
  await page.getByRole('heading',{name:'나의 선택, 투자 결과는?'}).waitFor();
  await page.screenshot({path:path.join(out,'cloud-08-result.png'),fullPage:true});
  await page.getByRole('button',{name:'전략 비교 · 자산 정체 공개 →'}).click();
  await page.getByText('비트코인 · BTC',{exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'cloud-09-reveal.png'),fullPage:true});
  await page.getByRole('button',{name:'다른 전략으로 재도전 ↻'}).click();
  await page.getByRole('heading',{name:'투자하기 전에, 먼저 알아보세요.'}).waitFor();
  const retryId=await page.evaluate(()=>localStorage.getItem('eru-session'));
  assert.notEqual(retryId,id);
  const retry=await(await context.request.get(`${base}/api/sessions/${retryId}`)).json();
  assert.equal(retry.cash,100000000);assert.equal(retry.elapsed,0);assert.deepEqual(retry.trades,[]);assert.deepEqual(errors,[]);
  const report={base,active_elapsed:g.elapsed,resumed_from:from,continuation_wall_seconds:(Date.now()-begin)/1000,polls,final_nav:g.nav,return_pct:g.return_pct,mdd_pct:g.mdd_pct,trades:g.trades.length,retry_reset_passed:true,errors};
  fs.writeFileSync(path.join(out,'cloud-browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
