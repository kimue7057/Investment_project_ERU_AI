// 실제 시세·게임 API로 두 단계 설정, 기본 가드, 승인 전 무매매, 재알림 간격을 확인한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,''),out=path.resolve(__dirname,'../test-results');
(async()=>{
 const browser=await chromium.launch({headless:true}),c=await browser.newContext({viewport:{width:1440,height:1100}}),p=await c.newPage(),errors=[];let chats=0,sid;
 p.setDefaultTimeout(45000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().endsWith('/chat')&&r.method()==='POST')chats++;});
 async function api(suffix='',body){const url=base+'/api/sessions/'+sid+suffix,r=body===undefined?await c.request.get(url):await c.request.post(url,{data:body});assert(r.ok(),r.status()+' '+suffix);return r.json();}
 try{
  await p.goto(base+'/?setup=1');await p.getByRole('radio',{name:'균형형',exact:true}).check();sid=await p.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
  fs.writeFileSync(path.join(out,'builtin-session.json'),JSON.stringify({id:sid}));
  assert.equal(await p.getByRole('textbox',{name:'AI에게 질문'}).count(),0);assert.equal(await p.locator('.consultation-pages li').count(),2);
  await p.getByRole('button',{name:'투자할 코인 고르기',exact:true}).click();
  await p.getByRole('checkbox',{name:'Asterra 선택',exact:true}).check();await p.getByRole('checkbox',{name:'Velora 선택',exact:true}).check();
  await p.getByRole('spinbutton',{name:'Asterra 투자금 내 비중',exact:true}).fill('60');await p.getByRole('spinbutton',{name:'Velora 투자금 내 비중',exact:true}).fill('40');
  assert.equal(await p.getByRole('textbox',{name:'AI에게 질문'}).count(),0);assert.equal(await p.getByRole('button',{name:'선택한 구성으로 조건 상담하기'}).count(),0);
  for(const width of [320,390]){await p.setViewportSize({width,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await p.setViewportSize({width:1440,height:1100});await p.reload();await p.getByRole('heading',{name:'어떤 자산에 투자할까요?',exact:true}).waitFor();
  assert.equal(await p.getByRole('spinbutton',{name:'Asterra 투자금 내 비중',exact:true}).inputValue(),'60');
  await p.getByRole('button',{name:'전체 계획 확인',exact:true}).click();await p.getByRole('heading',{name:'투자 계획을 확인해요',exact:true}).waitFor();
  assert.equal((await api()).trades.length,0);assert(await p.getByRole('button',{name:'이 계획으로 투자 시작',exact:true}).isDisabled());
  await p.locator('.consultation-confirm input[type=checkbox]').check();await p.getByRole('button',{name:'이 계획으로 투자 시작',exact:true}).click();await p.getByRole('dialog').waitFor();assert.equal((await api()).trades.length,0);
  const [r]=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/start')&&r.request().method()==='POST'),p.getByRole('button',{name:'확정하고 자동 투자 시작',exact:true}).click()]);assert(r.ok());assert(!Object.hasOwn(r.request().postDataJSON(),'risk_rules'));
  let g;for(let i=0;i<60;i++){g=await api();if(g.alerts.some(a=>a.decision===null))break;await new Promise(r=>setTimeout(r,400));}
  assert.equal(g.status,'paused');assert.equal(g.trades.length,2);assert.equal(g.risk_rules,null);const alert=g.alerts.find(a=>a.decision===null);assert(alert.id.startsWith('risk-'));
  await api('/approved-order',{kind:'hold',alert_id:alert.id});const count=g.alerts.length;
  for(let i=0;i<4;i++){await new Promise(r=>setTimeout(r,800));g=await api();assert.equal(g.status,'running');assert.equal(g.alerts.length,count);}
  await api('/pause',{});assert.equal(chats,0);assert.deepEqual(errors,[]);
  await p.reload();await p.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'내 포트폴리오',exact:true}).click();await p.getByRole('heading',{name:'기본 리스크 가드',exact:true}).waitFor();
  await p.screenshot({path:path.join(out,'builtin-guard.png'),fullPage:true});
  const legacy=await browser.newContext(),lp=await legacy.newPage();await legacy.addInitScript(({id})=>{localStorage.setItem('eru-guided-v3-session',id);localStorage.setItem('eru-manual-setup-v1-'+id,JSON.stringify({version:1,phase:'rules',profile:'balanced',cash:'30',coins:['A','B'],shares:{A:'60',B:'40',C:'0',D:'0'},rules:[{metric:'asset_loss',asset:'held',threshold:8,enabled:true}],ruleId:'old',choices:{old:'accepted'}}));},await (await c.request.post(base+'/api/guided-sessions',{data:{}})).json());
  await lp.goto(base);await lp.getByRole('heading',{name:'어떤 자산에 투자할까요?',exact:true}).waitFor();assert.equal(await lp.getByRole('textbox',{name:'AI에게 질문'}).count(),0);assert(await lp.getByRole('button',{name:'전체 계획 확인',exact:true}).isEnabled());
  const report={base,passed:true,twoSetupSteps:true,setupAIRequests:chats,builtinGuard:true,noImmediateRepeat:true,preApprovalNoTrade:true,tradeCount:2,legacyDraftRestored:true,mobileWidths:[320,390],errors};fs.writeFileSync(path.join(out,'builtin-guard-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){await p.screenshot({path:path.join(out,'builtin-failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
