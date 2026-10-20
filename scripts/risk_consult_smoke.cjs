// 초기 AI 상담 → 조건 제안/후속 수정 → 승인 저장 → 실제 시세 감지/정지를 검증한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,''),requireAI=process.env.ERU_REQUIRE_AI==='1';
const out=path.resolve(__dirname,'../test-results'),prefix=base.startsWith('https:')?'risk-cloud':'risk-local';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100},locale:'ko-KR'});
 const page=await context.newPage(),errors=[],turns=[];let sid;page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 async function get(){const r=await context.request.get(base+'/api/sessions/'+sid);assert(r.ok());return r.json();}
 async function ask(q){
  const before=await get();await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill(q);
  const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/chat')&&r.request().method()==='POST'),page.getByRole('button',{name:'질문하기',exact:true}).click()]);
  assert(r.ok(),'대화 HTTP '+r.status());const g=await r.json(),m=g.chat.at(-1);turns.push(m);
  assert.equal(g.now,before.now);assert.equal(g.status,'ready');assert.equal(g.pending,null);assert.equal(g.trades.length,0);assert.equal(g.risk_rules,null);
  if(requireAI)assert.equal(m.source,'ai',m.status);
  assert(!/https?:\/\/|bitcoin|ethereum|solana|dogecoin|\b(?:BTC|ETH|SOL|DOGE)\b/i.test(JSON.stringify(m)));
  return m;
 }
 async function fits(){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 try{
  await page.goto(base+'/?setup=1');await page.getByRole('heading',{name:'어떤 투자 방식이 나에게 맞을까요?',exact:true}).waitFor();
  await page.waitForFunction(()=>localStorage.getItem('eru-guided-v3-session'));sid=await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
  fs.writeFileSync(path.join(out,prefix+'-session.json'),JSON.stringify({id:sid}));
  if(requireAI){const m=await ask('성향부터 같이 정하고 싶어. 균형형으로 현금 30%, 투자 70%를 제안해줘. 아직 종목은 선택하지 않았으니 코인 배분과 리스크 조건은 제안하지 마.');assert.deepEqual(m.setup_preference,{profile:'balanced',cash:30});assert.equal(m.weights,null);await page.getByRole('button',{name:'이 성향·자금 배분을 초안에 담기',exact:true}).click();assert.equal(await page.getByRole('button',{name:'균형형',exact:true}).getAttribute('aria-pressed'),'true');}
  await page.getByRole('button',{name:'균형형',exact:true}).click();await page.getByRole('button',{name:'이 성향으로 계속',exact:true}).click();
  await page.getByRole('button',{name:'투자할 종목 고르기',exact:true}).click();await page.getByRole('checkbox',{name:'새벽코인 선택',exact:true}).check();
  await page.getByRole('button',{name:'리스크 조건 상담하기',exact:true}).click();
  let expected;
  if(requireAI){
   const m=await ask('기존 리스크 조건을 모두 대체해서 두 개만 만들자. 새벽코인이 수수료 포함 매수원가보다 8% 이상 손실이면 알림, 새벽코인이 전체 자산의 50% 이상이면 알림. 두 조건 모두 켜줘. 다른 조건과 비중 변경은 제안하지 마.');
   assert.equal(m.weights,null);assert.equal(m.risk_rules.length,2);
   assert(m.risk_rules.some(r=>r.metric==='asset_loss'&&r.asset==='A'&&r.threshold===8&&r.enabled));
   assert(m.risk_rules.some(r=>r.metric==='concentration'&&r.asset==='A'&&r.threshold===50&&r.enabled));
   await page.getByRole('button',{name:'이 알림 조건을 초안에 담기',exact:true}).last().click();
   const m2=await ask('방금 새벽코인의 매수원가 대비 손실 기준만 9%로 바꿔줘. 새벽코인 쏠림 50% 조건은 그대로, 전체 목록 두 개만 유지해줘. 비중 변경은 하지 마.');
   assert.equal(m2.weights,null);assert.equal(m2.risk_rules.length,2);
   assert(m2.risk_rules.some(r=>r.metric==='asset_loss'&&r.asset==='A'&&r.threshold===9));
   assert(m2.risk_rules.some(r=>r.metric==='concentration'&&r.asset==='A'&&r.threshold===50));
   await page.getByRole('button',{name:'이 알림 조건을 초안에 담기',exact:true}).last().click();expected=m2.risk_rules;
  }else{
   await ask('새벽코인 매수원가 대비 8% 손실 알림 조건을 만들고 싶어');
   assert.equal(turns[0].source,'rules');assert.equal(turns[0].risk_rules,undefined);
   // 키 없는 경우 수동 편집도 같은 서버 조건으로 연결한다.
   for(let i=4;i>=2;i--)await page.getByRole('button',{name:`리스크 조건 ${i} 삭제`,exact:true}).click();
   await page.getByRole('combobox',{name:'조건 1 대상',exact:true}).selectOption('A');await page.getByRole('spinbutton',{name:'조건 1 기준',exact:true}).fill('50');
   await page.getByRole('button',{name:'조건 추가',exact:true}).click();await page.getByRole('combobox',{name:'조건 2 지표',exact:true}).selectOption('asset_loss');await page.getByRole('combobox',{name:'조건 2 대상',exact:true}).selectOption('A');await page.getByRole('spinbutton',{name:'조건 2 기준',exact:true}).fill('9');
   expected=[{metric:'concentration',asset:'A',threshold:50,enabled:true},{metric:'asset_loss',asset:'A',threshold:9,enabled:true}];
  }
  // 잘못된 조건은 다음 단계로 진행되지 않는다. 수정한 초안은 새로고침 복구한다.
  const field=page.getByRole('spinbutton',{name:'조건 1 기준',exact:true}),original=await field.inputValue();await field.fill('0');
  assert.equal(await page.getByRole('button',{name:'이 구성 확인하기',exact:true}).isDisabled(),true);await field.fill(original);
  for(const width of [320,390]){await page.setViewportSize({width,height:844});await fits();await page.screenshot({path:path.join(out,prefix+'-conditions-'+width+'.png'),fullPage:true});}
  await page.setViewportSize({width:1440,height:1100});await page.reload();await page.getByRole('heading',{name:'나의 리스크 알림 조건',exact:true}).waitFor();
  assert.equal(await page.locator('.risk-rule').count(),2);
  await page.screenshot({path:path.join(out,prefix+'-conditions.png'),fullPage:true});
  await page.getByRole('button',{name:'이 구성 확인하기',exact:true}).click();await page.getByRole('checkbox').check();await page.getByRole('button',{name:'이 구성으로 투자 시작',exact:true}).click();
  await page.getByRole('dialog').waitFor();assert((await page.getByRole('dialog').innerText()).includes('50%'));
  const before=await get();assert.equal(before.risk_rules,null);assert.equal(before.trades.length,0);
  const [start]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/start')&&r.request().method()==='POST'),page.getByRole('button',{name:'확정하고 자동 투자 시작',exact:true}).click()]);
  assert(start.ok());const approved=await start.json();assert.deepEqual(approved.risk_rules,expected);assert.equal(approved.trades.length,0);assert(approved.pending);
  let g;
  for(let i=0;i<30;i++){g=await get();if(g.alerts.length)break;await page.waitForTimeout(400);}
  assert.equal(g.status,'paused');assert.equal(g.trades.length,1);assert.equal(g.pending,null);
  const a=g.alerts.at(-1);assert.equal(a.metric,'concentration');assert.equal(a.asset,'A');assert.equal(a.threshold,50);assert(Number(a.observed)>=50);assert(a.summary.includes('50%'));
  await page.getByRole('heading',{name:'시장을 잠시 멈췄어요',exact:true}).waitFor();
  const at=g.now;await page.waitForTimeout(1500);assert.equal((await get()).now,at);
  await page.reload();await page.getByRole('heading',{name:'시장을 잠시 멈췄어요',exact:true}).waitFor();assert.deepEqual((await get()).risk_rules,expected);
  await page.screenshot({path:path.join(out,prefix+'-guard.png'),fullPage:true});assert.deepEqual(errors,[]);
  const report={base,passed:true,requireAI,sources:turns.map(m=>m.source),savedRules:expected,trigger:{metric:a.metric,threshold:a.threshold,observed:a.observed},preApprovalNoTrade:true,restored:true,mobileWidths:[320,390],errors};
  fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){await page.screenshot({path:path.join(out,prefix+'-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify({base,passed:false,error:e.message,turns,errors},null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
