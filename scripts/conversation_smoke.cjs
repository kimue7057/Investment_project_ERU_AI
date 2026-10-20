// 폼 조작 없이 하나의 상담에서 구성과 공통 리스크 조건을 만들고 승인한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,''),real=process.env.ERU_REQUIRE_AI==='1';
const out=path.resolve(__dirname,'../test-results'),prefix=real?'conversation-cloud':'conversation-fixture';fs.mkdirSync(out,{recursive:true});
const weights={cash:30,A:42,B:28,C:0,D:0};
const rules=[{metric:'portfolio_loss',asset:'portfolio',threshold:10,enabled:true},{metric:'concentration',asset:'held',threshold:35,enabled:true}];
(async()=>{
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100},locale:'ko-KR'});
 const page=await context.newPage(),errors=[],turns=[];let sid;page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 async function get(){const r=await context.request.get(base+'/api/sessions/'+sid);assert(r.ok(),'상태 '+r.status());return r.json();}
 if(!real){
  const history=[];
  await page.route('**/api/sessions/*/chat',async route=>{
   const body=route.request().postDataJSON(),n=history.length;
   const g=await get(),m={id:body.request_id,at:g.now,question:body.question,paragraphs:[n===0?'먼저 투자에서 가장 걱정되는 부분을 함께 살펴봐요.':'말씀하신 구성과 공통 조건을 함께 정리했어요. 승인 전까지 거래는 시작하지 않아요.'],source:'ai',status:'브라우저 검증용 응답 (실제 AI 아님)',weights:n===1?weights:null,
    ...(n===1?{setup_preference:{profile:'balanced',cash:30},risk_rules:rules}:n===2?{risk_rules:rules.map(r=>r.metric==='portfolio_loss'?{...r,threshold:8}:r)}:{})};
   history.push(m);await route.fulfill({json:{...g,chat:[...history]}});
  });
 }
 async function ask(q){
  const before=await get();await page.getByRole('textbox',{name:'AI에게 질문',exact:true}).fill(q);
  const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/chat')&&r.request().method()==='POST'),page.getByRole('button',{name:'보내기',exact:true}).click()]);
  assert(r.ok(),'대화 '+r.status());const g=await r.json(),m=g.chat.at(-1);turns.push(m);
  assert.equal(r.request().postDataJSON().setup.mode,'conversation');
  assert.equal(g.status,'ready');assert.equal(g.now,before.now);assert.equal(g.risk_rules,null);assert.equal(g.initial_plan,null);assert.equal(g.pending,null);assert.equal(g.trades.length,0);
  if(real){assert.equal(m.source,'ai',m.status);assert(!/초안에 담기|체크박스|슬라이더|입력칸|다음 단계 버튼/.test(m.paragraphs.join(' ')),'설정 폼으로 돌려보내면 안 됩니다.');}
  assert(!/https?:\/\/|bitcoin|ethereum|solana|dogecoin|\b(?:BTC|ETH|SOL|DOGE)\b/i.test(JSON.stringify(m)));
  return m;
 }
 async function fits(width){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,prefix+'-'+width+'.png'),fullPage:true});}
 try{
  await page.goto(base+'/?setup=1');await page.getByRole('heading',{name:'이야기하며 만드는 나의 투자 계획',exact:true}).waitFor();
  await page.waitForFunction(()=>localStorage.getItem('eru-guided-v3-session'));sid=await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
  fs.writeFileSync(path.join(out,prefix+'-session.json'),JSON.stringify({id:sid}));
  assert.equal(await page.getByRole('spinbutton').count(),0);assert.equal(await page.getByRole('combobox').count(),0);assert.equal(await page.getByRole('checkbox').count(),0);
  assert.equal(await page.locator('.setup-progress,.profile-options,.risk-editor').count(),0);
  assert.equal(await page.getByRole('button',{name:'함께 만든 계획 확인',exact:true}).count(),0);
  await page.screenshot({path:path.join(out,prefix+'-initial.png'),fullPage:true});
  await ask('처음 투자해서 큰 손실이 걱정돼. 포트폴리오와 언제 다시 판단할지까지 너랑 이야기하면서 함께 정하고 싶어. 지금은 구성이나 조건을 제안하지 말고, 먼저 생각해볼 질문 하나만 해줘.');
  assert.equal(await page.getByRole('button',{name:'함께 만든 계획 확인',exact:true}).count(),0);
  await ask('균형형으로 현금 30%, 투자 70%로 해보자. 투자금 안에서는 새벽코인 60%, 물결코인 40%로 해보고 싶어. 전체 자산이 시작보다 10% 이상 손실이면, 또 보유한 어떤 종목이든 전체 자산 비중 35% 이상이면 멈추고 함께 논의하자. 코인별로 따로 입력하지 않고 공통 조건으로, 이 내용 전체를 계획으로 정리해줘.');
  await page.getByRole('button',{name:'함께 만든 계획 확인',exact:true}).waitFor();
  let saved=await page.evaluate(id=>JSON.parse(localStorage.getItem('eru-consult-v1-'+id)),sid);
  assert.deepEqual(saved.allocation,weights);assert.equal(saved.profile,'balanced');assert.equal(saved.rules.length,2);
  assert(saved.rules.some(r=>r.metric==='concentration'&&r.asset==='held'&&r.threshold===35));assert(saved.rules.some(r=>r.metric==='portfolio_loss'&&r.threshold===10));
  assert.equal(await page.getByRole('button',{name:/초안에 담기/}).count(),0);
  if(real)await page.waitForTimeout(2100);
  await ask('좋아. 방금 정리한 전체 자산 손실 알림만 10%에서 8%로 바꿔줘. 종목 공통 쏠림 35%와 균형형 자산 배분은 모두 그대로 두고, 조건 두 개의 전체 목록을 정리해줘.');
  await page.waitForFunction(id=>JSON.parse(localStorage.getItem('eru-consult-v1-'+id)).rules?.some(r=>r.metric==='portfolio_loss'&&r.threshold===8),sid);
  saved=await page.evaluate(id=>JSON.parse(localStorage.getItem('eru-consult-v1-'+id)),sid);assert.deepEqual(saved.allocation,weights);assert.equal(saved.rules.length,2);
  for(const width of [320,390])await fits(width);await page.setViewportSize({width:1440,height:1100});
  await page.reload();await page.getByRole('button',{name:'함께 만든 계획 확인',exact:true}).waitFor();
  const restored=await page.evaluate(id=>JSON.parse(localStorage.getItem('eru-consult-v1-'+id)),sid);assert.deepEqual(restored,saved);
  await page.screenshot({path:path.join(out,prefix+'-plan.png'),fullPage:true});
  await page.getByRole('button',{name:'함께 만든 계획 확인',exact:true}).click();await page.getByRole('heading',{name:'함께 만든 계획을 확인해요',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'이 계획으로 투자 시작',exact:true}).isDisabled(),true);
  await page.getByRole('checkbox').check();await page.getByRole('button',{name:'이 계획으로 투자 시작',exact:true}).click();
  await page.getByRole('dialog').waitFor();const before=await get();assert.equal(before.trades.length,0);assert.equal(before.initial_plan,null);
  const [start]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/start')&&r.request().method()==='POST'),page.getByRole('button',{name:'확정하고 자동 투자 시작',exact:true}).click()]);
  assert(start.ok());const approved=await start.json();assert.deepEqual(start.request().postDataJSON().weights,weights);assert.deepEqual(approved.risk_rules,saved.rules);assert.equal(approved.trades.length,0);assert(approved.pending);
  let g;for(let i=0;i<40;i++){g=await get();if(g.alerts.length)break;await page.waitForTimeout(400);}
  assert.equal(g.status,'paused');assert.equal(g.trades.length,2);assert.equal(g.pending,null);const alert=g.alerts.at(-1);assert.equal(alert.metric,'concentration');assert.equal(alert.threshold,35);
  assert(saved.rules.some(r=>r.metric===alert.metric&&r.asset==='held'));await page.getByRole('heading',{name:'시장을 잠시 멈췄어요',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,prefix+'-guard.png'),fullPage:true});assert.deepEqual(errors,[]);
  const report={base,passed:true,realAI:real,sources:turns.map(m=>m.source),noSetupForms:true,automaticDraft:true,weights,rules:saved.rules,preApprovalNoTrade:true,restored:true,trigger:{metric:alert.metric,threshold:alert.threshold},mobileWidths:[320,390],errors};
  fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){await page.screenshot({path:path.join(out,prefix+'-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify({base,passed:false,error:e.message,turns,errors},null,2));throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
