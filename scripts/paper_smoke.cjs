// 실제 과거 데이터로 새 모의투자 UI와 체결 결과를 확인한다.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base = (process.env.ERU_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const out = path.resolve(__dirname, '../test-results');
fs.mkdirSync(out, {recursive: true});
(async () => {
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, locale: 'ko-KR'});
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(30000);
  const prefix = base.startsWith('https:') ? 'paper-cloud' : 'paper-local';
  let sid;
  let transientReads = 0;
  const get = async () => { for(let i=0;i<3;i++) { const r = await context.request.get(`${base}/api/sessions/${sid}`); if(r.ok())return r.json(); if(i<2 && [409,503].includes(r.status())) {transientReads++;await page.waitForTimeout(500);continue;} assert(r.ok(),await r.text()); } };
  const waitFor = async fn => { for (let i = 0; i < 50; i++) { const g = await get(); if (fn(g)) return g; await page.waitForTimeout(400); } throw new Error('체결 상태 확인 시간 초과'); };
  try {
    const recovery = process.env.ERU_RESUME_PATH ? JSON.parse(fs.readFileSync(process.env.ERU_RESUME_PATH,'utf8').replace(/^\uFEFF/,'')) : null;
    if(recovery) {sid=recovery.id;await context.addInitScript(id=>localStorage.setItem('eru-paper-session',id),sid);}
    await page.goto(base);
    await page.getByRole('heading', {name: '어떤 종목에 투자해 볼까요?'}).waitFor();
    sid = await page.evaluate(() => localStorage.getItem('eru-paper-session'));
    let g = await get();
    if(recovery) {
      assert.equal(g.mode,'paper');assert.equal(g.trades.length,2);
      if(g.status==='paused') {await page.getByRole('button',{name:'시장 재개',exact:true}).click();g=await waitFor(v=>v.status==='running');}
      console.log(JSON.stringify({stage:'recovered-same-session',elapsed:g.elapsed,trades:g.trades.length}));
    } else {
    assert.equal(g.mode, 'paper'); assert.equal(g.cash, 100000000); assert.equal(g.pending, null);
    assert.deepEqual(g.trades, []);
    assert(!/준비 중|주식 E|주식 F|부동산 G|제안 수용|자동 일시정지|새로운.*자료/.test(await page.locator('main').innerText()));
    assert(!('identities' in g) && !('research' in g) && !('alerts' in g));
    await page.screenshot({path: path.join(out, `${prefix}-01-market.png`), fullPage: true});
    await page.getByLabel('종목 검색', {exact: true}).fill('코인 B');
    assert.equal(await page.locator('.asset-row').count(), 1);
    await page.getByLabel('종목 검색', {exact: true}).fill('');
    await page.getByRole('button', {name: '종목 보기', exact: true}).first().click();
    await page.getByRole('button', {name: '모의투자 시작하고 매수 주문 확인'}).click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', {name: '매수 주문 접수', exact: true}).click();
    await page.getByRole('heading', {name: '코인 A 매수 접수'}).waitFor();
    g = await get(); assert.equal(g.pending.side, 'buy'); assert.equal(g.cash, 100000000);
    const paused = g.now; await page.waitForTimeout(700); assert.equal((await get()).now, paused);
    await page.getByRole('button', {name: '주문 취소', exact: true}).click();
    await page.getByRole('heading', {name: '대기 중인 주문이 없어요'}).waitFor();
    assert.equal((await get()).pending, null);
    await page.getByRole('navigation', {name: '주 메뉴', exact: true}).getByRole('button', {name: '종목 찾기', exact: true}).click();
    await page.getByRole('button', {name: '종목 보기', exact: true}).first().click();
    await page.getByRole('spinbutton', {name: '매수 금액', exact: true}).fill('10000000');
    await page.getByRole('button', {name: '매수 주문 확인', exact: true}).click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({path: path.join(out, `${prefix}-02-confirm.png`), fullPage: true});
    await page.getByRole('button', {name: '매수 주문 접수', exact: true}).click();
    await page.getByRole('button', {name: '시장 재개하고 체결 보기', exact: true}).click();
    g = await waitFor(g => g.trades.length === 1);
    assert.equal(g.cash, 90000000); assert(Number(g.holdings[0].quantity) > 0);
    await page.getByRole('navigation', {name: '주 메뉴', exact: true}).getByRole('button', {name: '내 투자', exact: true}).click();
    await page.getByRole('button', {name: '매도', exact: true}).click();
    await page.getByRole('button', {name: '25%', exact: true}).click();
    await page.getByRole('button', {name: '매도 주문 확인', exact: true}).click();
    await page.getByRole('dialog').waitFor();
    const held = Number((await get()).holdings[0].quantity);
    await page.getByRole('button', {name: '매도 주문 접수', exact: true}).click();
    await page.getByRole('button', {name: '시장 재개하고 체결 보기', exact: true}).click();
    g = await waitFor(g => g.trades.length === 2);
    assert(Math.abs(Number(g.holdings[0].quantity) / held - .75) < 1e-9);
    assert(g.cash > 90000000);
    await page.getByRole('navigation', {name: '주 메뉴', exact: true}).getByRole('button', {name: '내 투자', exact: true}).click();
    await page.screenshot({path: path.join(out, `${prefix}-03-account.png`), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: path.join(out, `${prefix}-04-mobile-account.png`), fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('navigation', {name: '모바일 주 메뉴'}).getByRole('button', {name: '종목', exact: true}).click();
    await page.locator('.coin-name').filter({hasText: '코인 B'}).click();
    await page.getByRole('spinbutton', {name: '매수 금액', exact: true}).waitFor();
    await page.screenshot({path: path.join(out, `${prefix}-05-mobile-detail.png`), fullPage: true});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({width: 1440, height: 1000});
    // 연결 오류 때문에 기존 게임을 새 세션으로 덮어쓰면 안 된다.
    await page.route(`**/api/sessions/${sid}`, route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'연결 복원 회귀 검사'})}),{times:1});
    await page.reload();
    await page.getByRole('alert').filter({hasText:'연결 복원 회귀 검사'}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('eru-paper-session')),sid);
    await page.reload();
    await page.getByRole('heading', {name: '어떤 종목에 투자해 볼까요?'}).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('eru-paper-session')), sid);
    assert.equal((await get()).trades.length, 2);
    console.log(JSON.stringify({stage: 'orders-and-mobile-passed', base, errors}));
    }
    if (process.env.ERU_E2E_QUICK === '1') { assert.deepEqual(errors, []); return; }
    const started = Date.now(); let polls = 0;
    while (true) {
      g = await get();
      if (g.status === 'finished') break;
      assert.equal(g.status, 'running', '자동 신호로 정지하면 안 됩니다.');
      assert(!('identities' in g) && !('research' in g) && !('alerts' in g));
      if (++polls % 30 === 0) console.log(JSON.stringify({stage: 'replay', elapsed: g.elapsed, now: g.now}));
      assert(Date.now() - started < 420000, '300초 실제 재생 제한 초과');
      await page.waitForTimeout(1000);
    }
    assert.equal(g.elapsed, 300); assert(g.identities); assert.equal(g.trades.length, 2);
    await page.getByRole('heading', {name: '5분의 투자, 이렇게 마무리됐어요'}).waitFor();
    await page.screenshot({path: path.join(out, `${prefix}-06-result.png`), fullPage: true});
    await page.getByRole('button', {name: '실제 자산 확인', exact: true}).click();
    await page.getByText('비트코인 · BTC', {exact: true}).waitFor();
    await page.getByRole('button', {name: '다시 투자하기', exact: true}).click();
    await page.getByRole('heading', {name: '어떤 종목에 투자해 볼까요?'}).waitFor();
    const next = await page.evaluate(() => localStorage.getItem('eru-paper-session'));
    assert.notEqual(next, sid);
    const newGame = await context.request.get(`${base}/api/sessions/${next}`).then(r => r.json());
    assert.equal(newGame.cash, 100000000); assert.equal(newGame.elapsed, 0); assert.deepEqual(newGame.trades, []);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, `${prefix}-report.json`), JSON.stringify({base, passed: true, recoveredSession:!!recovery, transientReads, elapsed: g.elapsed, trades: g.trades.length, finalNav: g.nav, errors}, null, 2));
    console.log(JSON.stringify({stage: 'complete', elapsed: g.elapsed, trades: g.trades.length, errors}));
  } catch (e) { await page.screenshot({path: path.join(out, `${prefix}-failure.png`), fullPage: true}).catch(() => {}); throw e; }
  finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
