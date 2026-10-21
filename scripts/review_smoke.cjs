// 종료한 실제 게임의 복기 화면·선택 연결·모바일·복원을 검증한다. 가격/결과를 브라우저에 주입하지 않는다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base=(process.env.ERU_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,''),out=path.resolve(__dirname,'../test-results');
const sid=process.env.ERU_REVIEW_SESSION||JSON.parse(fs.readFileSync(path.join(out,'review-local-session.json'),'utf8')).id;
(async()=>{
 const browser=await chromium.launch({headless:true}),c=await browser.newContext({viewport:{width:1440,height:1100}}),p=await c.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(45000);
 try{
  await c.addInitScript(id=>localStorage.setItem('eru-guided-v3-session',id),sid);
  await p.goto(base);await p.getByRole('heading',{name:'나의 선택은 자산을 어떻게 바꿨을까요?',exact:true}).waitFor();
  const response=await c.request.get(base+'/api/sessions/'+sid+'/review');assert(response.ok());const review=await response.json();
  assert.equal(await p.locator('.review-choice').count(),review.decisions.length);
  const sell=review.decisions.find(d=>d.realized_pnl!==null&&d.comparison);assert(sell,'매도 비교 기록 필요');
  await p.locator('.review-marker').nth(review.decisions.indexOf(sell)).focus();await p.keyboard.press('Enter');
  await p.locator('[data-review-detail="'+sell.id+'"]').waitFor();assert(await p.getByRole('heading',{name:'이 매매를 하지 않았다면?',exact:true}).isVisible());
  await p.locator('.review-detail summary').filter({hasText:'체결가·수량·수수료 보기'}).click();assert.equal(await p.locator('.review-detail [data-trade-id]').count(),sell.fills.length);
  for(const f of sell.fills)assert(await p.locator('.review-detail [data-trade-id="'+f.id+'"]').isVisible());
  const hold=review.decisions.find(d=>['hold','ignore'].includes(d.action));assert(hold);
  await p.locator('.review-choice').nth(review.decisions.indexOf(hold)).click();await p.getByText('새 주문 없이 현재 구성을 유지했어요.',{exact:true}).waitFor();
  assert.equal(await p.getByRole('heading',{name:'이 매매를 하지 않았다면?',exact:true}).count(),0);
  await p.getByRole('slider',{name:'자산 그래프 날짜'}).fill('0');assert((await p.locator('.review-chart-values').innerText()).includes('2022.11.07'));
  await p.getByRole('slider',{name:'자산 그래프 날짜'}).fill('1000');
  await p.locator('.review-choice').nth(review.decisions.indexOf(sell)).click();
  await p.screenshot({path:path.join(out,'review-desktop.png'),fullPage:true});
  for(const width of [320,390]){await p.setViewportSize({width,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'가로 넘침 '+width);await p.locator('.review-choice').nth(review.decisions.indexOf(sell)).click();await p.screenshot({path:path.join(out,'review-mobile-'+width+'.png'),fullPage:true});}
  await p.setViewportSize({width:1440,height:1100});await p.reload();await p.locator('.investment-review').waitFor();
  const nav=p.getByRole('navigation',{name:'주 메뉴',exact:true});await nav.getByRole('button',{name:'판단 기록',exact:true}).click();await p.getByRole('heading',{name:'판단과 실행 기록',exact:true}).waitFor();
  await nav.getByRole('button',{name:'투자 복기',exact:true}).click();await p.locator('.investment-review').waitFor();
  if(!await p.locator('.review-recap-answer').count()){await p.getByRole('button',{name:'ERU AI와 복기하기',exact:true}).click();await p.locator('.review-recap-answer').waitFor();}
  const recap=await p.locator('.review-recap-answer').innerText();if(process.env.ERU_REVIEW_AI==='1')assert(recap.includes('OpenRouter 연결'),recap);
  const restored=await (await c.request.get(base+'/api/sessions/'+sid+'/review')).json();assert.equal(restored.final_nav,review.final_nav);assert.deepEqual(restored.decisions,review.decisions);assert(restored.recap);assert.deepEqual(errors,[]);
  const report={base,passed:true,decisions:review.decisions.length,linkedFills:review.decisions.reduce((n,d)=>n+d.fills.length,0),keyboardSelection:true,holdReviewed:true,counterfactual:true,mobileWidths:[320,390],restored:true,recapSource:restored.recap.source,errors};
  fs.writeFileSync(path.join(out,'review-smoke-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){await p.screenshot({path:path.join(out,'review-failure.png'),fullPage:true}).catch(()=>{});throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
