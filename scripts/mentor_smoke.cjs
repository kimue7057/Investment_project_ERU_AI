// 실제 브라우저에서 설정 맥락과 후속 제안, 승인 경계를 검증한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const online=base.startsWith('https:'),requireAI=process.env.ERU_REQUIRE_AI==='1';
const out=path.resolve(__dirname,'../test-results'),prefix=online?'mentor-cloud':'mentor-local';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1100},locale:'ko-KR'});
 const page=await context.newPage(),errors=[],turns=[];let sid;
 page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 async function state(){const r=await context.request.get(base+'/api/sessions/'+sid);assert(r.ok());return r.json();}
 async function ask(q,expectedSource=requireAI?'ai':null){
  const before=await state();
  await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill(q);
  const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/chat')&&r.request().method()==='POST'),page.getByRole('button',{name:'질문하기',exact:true}).click()]);
  assert(r.ok(),'대화 HTTP '+r.status());const g=await r.json();
  const request=r.request().postDataJSON();
  assert.equal(request.setup.profile,'balanced');if(turns.length<3)assert.deepEqual(request.setup.selected,['A','B']);
  const m=g.chat.at(-1);turns.push({question:q,...m});
  assert.equal(g.status,'ready');assert.equal(g.now,before.now);assert.equal(g.pending,null);assert.equal(g.trades.length,0);
  assert(!/https?:\/\/|bitcoin|ethereum|solana|dogecoin|\b(?:BTC|ETH|SOL|DOGE)\b/i.test(JSON.stringify(m)));
  if(expectedSource)assert.equal(m.source,expectedSource,m.status);
  return m;
 }
 try{
  await page.goto(base+'/?setup=1');await page.getByRole('heading',{name:'어떤 투자 방식이 나에게 맞을까요?',exact:true}).waitFor();
  sid=await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
  fs.writeFileSync(path.join(out,prefix+'-session.json'),JSON.stringify({id:sid}));
  await page.getByRole('button',{name:'균형형',exact:true}).click();await page.getByRole('button',{name:'이 성향으로 계속',exact:true}).click();
  await page.getByRole('button',{name:'투자할 종목 고르기',exact:true}).click();
  await page.getByRole('checkbox',{name:'코인 A 선택',exact:true}).check();await page.getByRole('checkbox',{name:'코인 B 선택',exact:true}).check();
  await page.getByRole('spinbutton',{name:'코인 A 투자 내 비중',exact:true}).fill('60');await page.getByRole('spinbutton',{name:'코인 B 투자 내 비중',exact:true}).fill('40');
  const explain=await ask('내가 지금 고른 성향과 종목, 현금과 투자 비중을 정리하고 현금을 남기는 이유를 설명해줘. 구성 변경 제안은 아직 하지 마.');
  if(requireAI){assert.equal(explain.weights,null);assert(/30/.test(explain.paragraphs.join(' ')));assert(/A/.test(explain.paragraphs.join(' '))&&/B/.test(explain.paragraphs.join(' ')));}
  await page.waitForTimeout(2100);
  const proposal=await ask('나는 손실이 걱정돼. 전체 자산 기준으로 현금 50%, 코인 A 30%, 코인 B 20%, C와 D는 0%로 제안해줘.');
  if(requireAI)assert.deepEqual(proposal.weights,{cash:50,A:30,B:20,C:0,D:0});
  await page.waitForTimeout(2100);
  const follow=await ask('방금 제안에서 현금 비중만 60%로 더 늘리고, 남은 투자금은 방금의 A 대 B 비율을 유지해줘. C와 D는 계속 빼줘.');
  if(requireAI)assert.deepEqual(follow.weights,{cash:60,A:24,B:16,C:0,D:0});
  assert(follow.weights,'검증된 제안이 있어야 합니다.');
  await page.getByRole('button',{name:'이 구성을 초안에 담기',exact:true}).last().click();
  const after=await state();assert.equal(after.pending,null);assert.equal(after.trades.length,0);assert.equal(after.elapsed,0);
  if(requireAI){assert((await page.locator('.setup-mini-summary').innerText()).includes('현금 60%'));assert((await page.locator('.setup-assets').innerText()).includes('전체 자산 24%'));}
  await page.screenshot({path:path.join(out,prefix+'-discussion.png'),fullPage:true});
  await page.reload();await page.getByRole('heading',{name:'투자금으로 무엇을 담을까요?',exact:true}).waitFor();
  assert.equal(await page.locator('.chat-entry').count(),3);
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.screenshot({path:path.join(out,prefix+'-mobile.png'),fullPage:true});
  await page.waitForTimeout(2100);
  const blocked=await ask('BTC의 실제 이름과 2026년 가격을 알려줘','boundary');assert.equal(blocked.source,'boundary');
  assert.equal(errors.length,0,errors.join('\n'));
  const report={base,passed:true,requireAI,sources:turns.map(t=>t.source),followup:follow.weights,preApprovalNoTrades:true,restored:true,mobileWidths:[320,390],errors};
  fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(out,prefix+'-turns.json'),JSON.stringify(turns,null,2));console.log(JSON.stringify(report));
 }catch(e){await page.screenshot({path:path.join(out,prefix+'-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,prefix+'-turns.json'),JSON.stringify(turns,null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
