// 반복 조회와 연결 실패를 별도 검증한다. 장애 응답은 명시적인 UI 픽스처다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=process.env.ERU_BASE_URL||'http://127.0.0.1:8000';
(async()=>{const browser=await chromium.launch({headless:true}),c=await browser.newContext(),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));let reads=0;
try{
 p.on('request',r=>{if(r.method()==='GET'&&/\/api\/sessions\//.test(r.url()))reads++;});
 await p.goto(base+'/?setup=1');await p.getByRole('radio',{name:'균형형',exact:true}).waitFor();const before=reads;await p.waitForTimeout(4200);assert.equal(reads,before,'설정 화면의 반복 읽기 금지');
 const sid=await p.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
 await c.request.post(base+'/api/sessions/'+sid+'/start',{data:{weights:{cash:100,A:0,B:0,C:0,D:0},risk_rules:[]}});await p.reload();await p.getByRole('heading',{name:'나의 투자 여정',exact:true}).waitFor();
 await c.request.post(base+'/api/sessions/'+sid+'/pause',{data:{}});await p.reload();await p.getByRole('heading',{name:'나의 투자 여정',exact:true}).waitFor();const pausedReads=reads;await p.waitForTimeout(4200);assert.equal(reads,pausedReads,'일시정지 화면의 반복 읽기 금지');
 let failedReads=0;await p.route(/\/api\/sessions\/[^/?]+\?asset=/,async route=>{failedReads++;await route.fulfill({status:503,json:{detail:'검증용 저장소 연결 장애'}});});
 await c.request.post(base+'/api/sessions/'+sid+'/resume',{data:{}});await p.reload();await p.getByRole('heading',{name:'나의 투자 여정',exact:true}).waitFor();await p.getByRole('button',{name:'연결 다시 확인',exact:true}).waitFor();assert.equal(failedReads,3);await p.waitForTimeout(3000);assert.equal(failedReads,3,'연속 실패 후 무한 재조회 금지');
 await p.unroute(/\/api\/sessions\/[^/?]+\?asset=/);await p.getByRole('button',{name:'연결 다시 확인',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('.message.error'));await c.request.post(base+'/api/sessions/'+sid+'/pause',{data:{}});
 const c2=await browser.newContext(),p2=await c2.newPage();let creates=0;await p2.addInitScript(()=>localStorage.setItem('eru-guided-v3-session','saved-game-preserved'));
 await p2.route('**/api/guided-sessions',async route=>{creates++;await route.fulfill({status:503,json:{detail:'온라인 게임 저장소 접근이 차단되어 게임을 열 수 없습니다.'}});});await p2.goto(base+'/?setup=1');await p2.getByRole('heading',{name:'게임을 연결하지 못했어요',exact:true}).waitFor();assert((await p2.getByRole('alert').innerText()).includes('차단'));await p2.waitForTimeout(2500);assert.equal(creates,1);assert.equal(await p2.evaluate(()=>localStorage.getItem('eru-guided-v3-session')),'saved-game-preserved');await p2.screenshot({path:'test-results/connection-create-error.png',fullPage:true});
 assert.deepEqual(errors,[]);const report={passed:true,readyNoPolling:true,pausedNoPolling:true,failedRequestsStoppedAt:failedReads,manualRetryRecovered:true,initialFailurePreservesSavedGame:true,errors};fs.writeFileSync('test-results/connection-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
