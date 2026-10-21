// 실제 API·DB로 기존 ID 전환, 승인 매도, 손익 저장과 새 브라우저 복원을 검증한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const sessionPath=process.env.ERU_HISTORY_SESSION_PATH;
if(!sessionPath)throw Error('초기 매매·가드 검증에서 생성한 ERU_HISTORY_SESSION_PATH가 필요합니다.');
const {id}=JSON.parse(fs.readFileSync(sessionPath,'utf8').replace(/^\uFEFF/,''));
const out=path.resolve(__dirname,'../test-results');
(async()=>{
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100}}),errors=[];
 async function api(url,body){const r=body===undefined?await context.request.get(base+url):await context.request.post(base+url,{data:body});assert(r.ok(),`${r.status()} ${url.split('/').at(-1)}`);return r.json();}
 try{
  const url='/api/sessions/'+id,before=await api(url);assert.equal(before.status,'paused');
  // 화면 검사만 재시도할 때 이미 체결된 승인 주문을 다시 보내지 않는다.
  if(before.trades.length===2){
   const alert=before.alerts.find(a=>a.decision===null);assert(alert);
   const accepted=await api(url+'/approved-order',{kind:'trade',alert_id:alert.id,asset:'A',side:'sell',percent:25});
   assert(accepted.pending);assert.equal(accepted.trades.length,2);assert(accepted.pending.at>accepted.now);
   let filled;for(let n=0;n<40;n++){filled=await api(url);if(filled.trades.length===3)break;await new Promise(r=>setTimeout(r,400));}
   assert.equal(filled.trades.length,3);await api(url+'/pause',{});
  }
  const paused=await api(url),sell=paused.trades.at(-1);assert.equal(paused.trades.length,3);
  const approval=paused.choices.findLast(c=>c.action==='trade');assert(approval&&sell.at>approval.at);
  assert.equal(sell.side,'sell');assert.equal(sell.asset,'A');assert.notEqual(sell.realized_pnl,null);assert.equal(typeof sell.realized_pnl,'string');
  await context.addInitScript(id=>localStorage.setItem('eru-guided-v3-session',id),id);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  await page.getByRole('heading',{name:/나의 투자 여정|지금, 어떤 선택이 좋을까요/}).waitFor();
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'자산 살펴보기',exact:true}).click();
  await page.locator('.tabs').getByRole('button',{name:'Asterra',exact:true}).click();
  await page.getByRole('heading',{name:'Asterra 거래 내역',exact:true}).waitFor();assert.equal(await page.locator('.fill-card').count(),2);
  const card=page.locator('[data-trade-id="'+sell.id+'"]');
  const won=n=>Number(n).toLocaleString('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:2});
  assert((await card.innerText()).includes(won(sell.realized_pnl)));assert((await card.innerText()).includes(won(sell.cost_basis)));
  await page.screenshot({path:path.join(out,'supabase-restored-history.png'),fullPage:true});
  await page.reload();await page.getByRole('heading',{name:/나의 투자 여정|지금, 어떤 선택이 좋을까요/}).waitFor();
  const restored=await api(url);assert.deepEqual(restored.trades,paused.trades);assert.equal(restored.now,paused.now);assert.equal(restored.cash,paused.cash);
  const migration=await browser.newContext(),m=await migration.newPage(),oldId='00000000-0000-4000-8000-000000000000';let creates=0;
  await migration.addInitScript(id=>localStorage.setItem('eru-guided-v3-session',id),oldId);
  m.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/guided-sessions'))creates++;});
  await m.goto(base);await m.getByRole('radio',{name:'균형형',exact:true}).waitFor();
  assert.equal(await m.evaluate(()=>localStorage.getItem('eru-guided-previous-session')),oldId);
  assert.notEqual(await m.evaluate(()=>localStorage.getItem('eru-guided-v3-session')),oldId);assert.equal(creates,1);
  assert.deepEqual(errors,[]);
  const report={base,passed:true,approvedSellAtNextOpen:true,tradeCount:3,realized:sell.realized_pnl,restoredLedger:true,previousIdPreserved:true,errors};
  fs.writeFileSync(path.join(out,'storage-restore-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
