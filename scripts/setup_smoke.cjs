// 초기 설정의 성향·자산군·종목 선택과 실제 승인 주문을 브라우저로 검증한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const out=path.resolve(__dirname,'../test-results');
const prefix=base.startsWith('https:')?'setup-cloud':'setup-local';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 const errors=[];let sid,initialRequest;
 const context=await browser.newContext({viewport:{width:1440,height:1100},locale:'ko-KR'});
 const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 async function get(){const r=await context.request.get(base+'/api/sessions/'+sid);assert(r.ok(),'세션 읽기 '+r.status()+' id='+sid);return r.json();}
 async function shot(stage){await page.screenshot({path:path.join(out,prefix+'-'+stage+'.png'),fullPage:true});}
 async function fits(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 try{
  await page.goto(base);await page.getByRole('heading',{name:'어떤 투자 방식이 나에게 맞을까요?',exact:true}).waitFor();
  await page.waitForFunction(()=>!!localStorage.getItem('eru-guided-v3-session'));
  sid=await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
  const before=await get();assert.equal(before.status,'ready');assert.equal(before.elapsed,0);
  const next=page.getByRole('button',{name:'이 성향으로 계속',exact:true});
  assert.equal(await next.isDisabled(),true);
  for(const [label,cash]of[['안정형',60],['균형형',30],['공격형',10]]){
   await page.getByRole('button',{name:label,exact:true}).click();
   assert.equal(await page.getByRole('button',{name:label,exact:true}).getAttribute('aria-pressed'),'true');
   assert((await page.locator('.setup-mini-summary').innerText()).includes('현금 '+cash+'%'));
  }
  await page.getByRole('button',{name:'균형형',exact:true}).click();await shot('01-profile');
  await page.setViewportSize({width:320,height:844});await fits();await shot('02-mobile-profile');
  await page.setViewportSize({width:1440,height:1100});
  await next.click();await page.getByRole('heading',{name:'현금과 투자, 먼저 나눠볼까요?',exact:true}).waitFor();
  assert.equal(await page.getByRole('spinbutton',{name:'현금 비중',exact:true}).inputValue(),'30');
  await page.getByRole('spinbutton',{name:'투자 비중',exact:true}).fill('60');
  assert.equal(await page.getByRole('spinbutton',{name:'현금 비중',exact:true}).inputValue(),'40');
  await page.getByRole('spinbutton',{name:'현금 비중',exact:true}).fill('30');
  await page.setViewportSize({width:390,height:844});await fits();await shot('03-mobile-buckets');
  await page.setViewportSize({width:1440,height:1100});
  await page.getByRole('button',{name:'투자할 종목 고르기',exact:true}).click();
  const confirm=page.getByRole('button',{name:'이 구성 확인하기',exact:true});
  assert.equal(await confirm.isDisabled(),true);
  assert.equal(await page.getByRole('checkbox',{checked:true}).count(),0);
  await page.getByRole('checkbox',{name:'새벽코인 선택',exact:true}).check();
  await page.getByRole('checkbox',{name:'물결코인 선택',exact:true}).check();
  await page.getByRole('spinbutton',{name:'새벽코인 투자 내 비중',exact:true}).fill('60');
  assert.equal(await confirm.isDisabled(),true);
  await page.getByRole('spinbutton',{name:'물결코인 투자 내 비중',exact:true}).fill('40');
  assert.equal(await confirm.isEnabled(),true);
  assert((await page.locator('.setup-assets').innerText()).includes('전체 자산 42%'));
  assert((await page.locator('.setup-assets').innerText()).includes('전체 자산 28%'));
  await shot('04-assets');
  await page.setViewportSize({width:320,height:844});await fits();await shot('05-mobile-assets');
  await page.setViewportSize({width:1440,height:1100});
  const unchanged=await get();assert.equal(unchanged.now,before.now);assert.equal(unchanged.cash,before.cash);assert.equal(unchanged.pending,null);assert.equal(unchanged.trades.length,0);
  await confirm.click();
  await page.reload();await page.getByRole('heading',{name:'함께 만든 계획을 확인해요',exact:true}).waitFor();
  assert.equal(await page.getByRole('checkbox').isChecked(),false);
  assert((await page.locator('.setup-options').innerText()).includes('전체 42%'));
  assert((await page.locator('.setup-options').innerText()).includes('전체 28%'));
  assert.equal(await page.getByRole('button',{name:'이 구성으로 투자 시작',exact:true}).isDisabled(),true);
  await shot('06-review');
  assert(!(await page.locator('main').innerText()).includes('이자형 대기 자금'));
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'이 구성으로 투자 시작',exact:true}).click();
  await page.getByRole('dialog').waitFor();
  const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/start')&&r.request().method()==='POST'),page.getByRole('button',{name:'확정하고 자동 투자 시작',exact:true}).click()]);
  assert(response.ok());initialRequest=response.request().postDataJSON();
  assert.deepEqual(initialRequest.weights,{cash:30,A:42,B:28,C:0,D:0});
  for(let i=0;i<40;i++){const g=await get();if(g.trades.length===2){assert.equal(g.cash,30000000);assert.equal(g.holdings[2].quantity,'0');assert.equal(g.holdings[3].quantity,'0');break;}if(i===39)throw new Error('초기 주문 체결 대기 초과');await page.waitForTimeout(500);}
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'내 포트폴리오',exact:true}).click();
  await shot('07-started');
  // 새 설정 링크는 새 게임을 만들고, 기존 게임은 삭제하지 않는다.
  await page.goto(base+'/?setup=1');
  await page.getByRole('heading',{name:'어떤 투자 방식이 나에게 맞을까요?',exact:true}).waitFor();
  const createdId=await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
  assert.notEqual(createdId,sid);
  assert.equal(await page.evaluate(()=>localStorage.getItem('eru-guided-previous-session')),sid);
  assert(!page.url().includes('setup=1'));
  const previous=await context.request.get(base+'/api/sessions/'+sid);assert(previous.ok());
  await page.reload();await page.getByRole('heading',{name:'어떤 투자 방식이 나에게 맞을까요?',exact:true}).waitFor();
  const freshId=await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
  assert.equal(freshId,createdId);
  // 다른 새 게임에서 현금 100%를 선택하면 종목 선택과 주문 없이 시작한다.
  const cashContext=await browser.newContext({viewport:{width:390,height:844},locale:'ko-KR'});
  const cashPage=await cashContext.newPage();cashPage.on('pageerror',e=>errors.push(e.message));
  await cashPage.goto(base);await cashPage.getByRole('button',{name:'안정형',exact:true}).click();
  await cashPage.getByRole('button',{name:'이 성향으로 계속',exact:true}).click();
  await cashPage.getByRole('spinbutton',{name:'현금 비중',exact:true}).fill('100');
  await cashPage.getByRole('button',{name:'투자할 종목 고르기',exact:true}).click();
  await cashPage.getByRole('heading',{name:'현금 100%로 시작해요',exact:true}).waitFor();
  await cashPage.getByRole('button',{name:'이 구성 확인하기',exact:true}).click();
  await cashPage.getByRole('checkbox').check();await cashPage.getByRole('button',{name:'이 구성으로 투자 시작',exact:true}).click();
  const [cashResponse]=await Promise.all([cashPage.waitForResponse(r=>r.url().endsWith('/start')&&r.request().method()==='POST'),cashPage.getByRole('button',{name:'확정하고 자동 투자 시작',exact:true}).click()]);
  assert(cashResponse.ok());const cashGame=await cashResponse.json();assert.equal(cashGame.pending,null);assert.equal(cashGame.trades.length,0);assert.equal(cashGame.cash,100000000);
  assert.equal(await cashPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await cashContext.close();
  assert.deepEqual(errors,[]);
  const report={base,passed:true,profilePresets:true,twoStageAllocation:initialRequest.weights,preStartFrozen:true,restored:true,freshSetupLink:true,cashOnly:true,mobileWidths:[320,390],errors};
  fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){await shot('failure').catch(()=>{});fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify({base,passed:false,error:e.message,errors},null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
