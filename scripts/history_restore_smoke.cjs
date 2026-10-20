// 실제 저장된 기존 세션을 열어 전량 매도·종료 후에도 종목 내역을 확인할 수 있는지 검증한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const sessionPath=process.env.ERU_HISTORY_SESSION_PATH;
if(!sessionPath)throw Error('기존 검증에서 저장한 ERU_HISTORY_SESSION_PATH가 필요합니다.');
const {id}=JSON.parse(fs.readFileSync(sessionPath,'utf8').replace(/^\uFEFF/,''));
(async()=>{
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100}});
 await context.addInitScript(id=>localStorage.setItem('eru-guided-v3-session',id),id);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  const r=await context.request.get(base+'/api/sessions/'+id);assert(r.ok());const game=await r.json();assert(game.trades.length>0);
  if(process.env.ERU_EXPECT_FINISHED==='1')assert.equal(game.status,'finished');
  await page.goto(base);await page.getByRole('heading',{name:game.status==='finished'?'이번 투자 실험을 마쳤어요':/나의 투자 여정|지금, 어떤 선택이 좋을까요/}).waitFor();
  await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'자산 살펴보기',exact:true}).click();
  await page.getByRole('heading',{name:'Asterra 거래 내역',exact:true}).waitFor();await page.waitForTimeout(2300);
  assert.equal(await page.getByRole('heading',{name:'Asterra 거래 내역',exact:true}).count(),1);
  assert.equal(await page.locator('.fill-card').count(),game.trades.filter(t=>t.asset==='A').length);
  if(game.status==='finished')assert.equal(await page.getByRole('button',{name:'AI와 매매 검토',exact:true}).count(),0);
  assert(!/코인\s*[ABCD]/.test(await page.locator('main').innerText()));assert.equal(errors.length,0);
  const out=path.resolve(__dirname,'../test-results'),prefix=base.startsWith('https:')?'history-restore-cloud':'history-restore-local';
  await page.screenshot({path:path.join(out,prefix+'.png'),fullPage:true});
  const report={base,passed:true,status:game.status,trades:game.trades.length,assetNavigationAfterPolling:true,errors};
  fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
