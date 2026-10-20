// 실제 시세로 체결한 주문을 종목별 화면·손익·필터·복원에서 검증한다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const out=path.resolve(__dirname,'../test-results'),prefix=base.startsWith('https:')?'history-cloud':'history-local';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1100},locale:'ko-KR'});
 const page=await context.newPage(),errors=[];let sid;page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));
 async function get(){const r=await context.request.get(base+'/api/sessions/'+sid);assert(r.ok());return r.json();}
 async function wait(fn){for(let i=0;i<80;i++){const g=await get();if(fn(g))return g;await page.waitForTimeout(350);}throw Error('체결 대기 초과');}
 async function approve(){const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/approved-order')&&r.request().method()==='POST'),page.getByRole('button',{name:'이 주문 승인하고 자동 실행',exact:true}).click()]);assert(r.ok());const g=await r.json();assert.equal(g.id,sid);assert(g.pending,'승인 응답에 대기 주문이 있어야 합니다.');}
 async function assets(){await page.getByRole('navigation',{name:'주 메뉴',exact:true}).getByRole('button',{name:'자산 살펴보기',exact:true}).click();}
 const won=n=>Number(n).toLocaleString('ko-KR',{style:'currency',currency:'KRW',maximumFractionDigits:2});
 try{
  await page.goto(base+'/?setup=1');await page.getByRole('button',{name:'균형형',exact:true}).click();sid=await page.evaluate(()=>localStorage.getItem('eru-guided-v3-session'));
  fs.writeFileSync(path.join(out,prefix+'-session.json'),JSON.stringify({id:sid}));
  await page.getByRole('button',{name:'이 성향으로 계속',exact:true}).click();await page.getByRole('button',{name:'투자할 종목 고르기',exact:true}).click();
  await page.getByRole('checkbox',{name:'새벽코인 선택',exact:true}).check();await page.getByRole('button',{name:'이 구성 확인하기',exact:true}).click();await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'이 구성으로 투자 시작',exact:true}).click();await page.getByRole('button',{name:'확정하고 자동 투자 시작',exact:true}).click();
  await wait(g=>g.trades.length===1&&g.status==='paused');
  await page.getByRole('button',{name:'이 제안을 주문 초안에 담기 →',exact:true}).click();await page.getByRole('spinbutton',{name:'매도 비율',exact:true}).fill('25');await page.getByRole('button',{name:'변경 내용 확인',exact:true}).click();await approve();
  await wait(g=>g.trades.length===2);
  await page.getByRole('button',{name:'AI와 구성 다시 논의',exact:true}).click();await page.getByRole('button',{name:'종목 매수·매도',exact:true}).click();
  await page.getByRole('combobox',{name:'주문 종목',exact:true}).selectOption('B');await page.getByRole('button',{name:'매수',exact:true}).click();await page.getByRole('spinbutton',{name:'매수 금액',exact:true}).fill('1000000');
  await page.getByRole('button',{name:'변경 내용 확인',exact:true}).click();await approve();await wait(g=>g.trades.length===3);
  await page.getByRole('button',{name:'잠시 멈추기',exact:true}).click();let g=await wait(g=>g.status==='paused');
  await assets();await page.locator('.tabs').getByRole('button',{name:'새벽코인',exact:true}).click();
  const history=page.getByRole('generic',{name:'새벽코인 거래 내역',exact:true});
  await page.getByRole('heading',{name:'새벽코인 거래 내역',exact:true}).waitFor();assert.equal(await page.locator('.fill-card').count(),2);
  const sell=g.trades.find(t=>t.asset==='A'&&t.side==='sell');assert(sell.realized_pnl!==null);
  const card=page.locator('[data-trade-id="'+sell.id+'"]');assert((await card.innerText()).includes(won(sell.cost_basis)));assert((await card.innerText()).includes(won(sell.realized_pnl)));
  assert((await card.innerText()).includes(won(sell.cash_flow)));assert((await page.locator('.asset-position').innerText()).includes(won(g.asset_performance[0].realized_pnl)));
  assert(!/코인\s*[ABCD]/.test(await page.locator('main').innerText()));
  await page.getByRole('group',{name:'거래 종류 필터',exact:true}).getByRole('button',{name:'매도',exact:true}).click();assert.equal(await page.locator('.fill-card').count(),1);
  await page.getByRole('group',{name:'거래 종류 필터',exact:true}).getByRole('button',{name:'전체',exact:true}).click();
  await page.screenshot({path:path.join(out,prefix+'-asset.png'),fullPage:true});
  await page.locator('.tabs').getByRole('button',{name:'물결코인',exact:true}).click();assert.equal(await page.locator('.fill-card').count(),1);assert((await page.locator('.fill-profit').innerText()).includes('손익 미확정'));
  await page.locator('.tabs').getByRole('button',{name:'산들코인',exact:true}).click();assert.equal(await page.locator('.fill-card').count(),0);assert((await page.locator('.history-empty').innerText()).includes('체결 내역이 없어요'));
  await page.reload();await page.getByRole('heading',{name:'나의 투자 여정',exact:true}).waitFor();await assets();await page.locator('.tabs').getByRole('button',{name:'새벽코인',exact:true}).click();assert.equal(await page.locator('.fill-card').count(),2);
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,prefix+'-mobile-'+width+'.png'),fullPage:true});}
  const again=await get();assert.equal(again.now,g.now);assert.equal(again.trades.length,3);assert.equal(errors.length,0,errors.join('\n'));
  const report={base,passed:true,tradeCount:3,perAssetCounts:{A:2,B:1,C:0},realized:sell.realized_pnl,restored:true,mobileWidths:[320,390],errors};
  fs.writeFileSync(path.join(out,prefix+'-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){await page.screenshot({path:path.join(out,prefix+'-failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
