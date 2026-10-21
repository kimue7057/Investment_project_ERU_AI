import {RiskSummary} from './RiskRules';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import AssetDetail from './AssetDetail';
import TradeHistory from './TradeHistory';
import PlanEditor from './PlanEditor';
import Mentor from './Mentor';
import PortfolioSetup from './PortfolioSetup';
import { aliases, assetName, assetShort, money, pct, date, clock, validWeights, type Alias, type Allocation, type Asset, type GuidedGame, type Approval, type SetupContext } from './model';

const InvestmentReview = lazy(()=>import('./InvestmentReview'));

type View = 'portfolio'|'assets'|'discussion'|'records'|'result';
const SESSION = 'eru-guided-v3-session';
const DEFAULT: Allocation = {cash:30,A:30,B:20,C:15,D:5};
const qty = (n: string|number) => Number(n).toLocaleString('ko-KR',{maximumFractionDigits:8});
function Pair({label, children}:{label:string; children:React.ReactNode}) {return <div className="pair"><span>{label}</span><strong>{children}</strong></div>;}
function Badge({asset}:{asset:string}) {return <span className={'asset-badge asset-' + asset}>{assetShort(asset)}</span>;}
async function api(path:string, body?:object):Promise<GuidedGame> {
  const r = await fetch('/api' + path,{method:body === undefined ? 'GET':'POST',headers:{'Content-Type':'application/json'},...(body === undefined ? {}:{body:JSON.stringify(body)})});
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(typeof data.detail === 'string' ? data.detail:'입력값을 확인해 주세요.'),{status:r.status});
  return data;
}

export default function App() {
  const [game,setGame] = useState<GuidedGame|null>(null), [catalog,setCatalog] = useState<Asset[]>([]);
  const [view,setView] = useState<View>('portfolio');
  const [selected,setSelected] = useState<Alias>('A'), [draft,setDraft] = useState<Allocation>(()=>{try {const saved = JSON.parse(localStorage.getItem('eru-guided-draft') || 'null'); if (saved && Object.keys(saved).length === 5 && validWeights(saved)) return saved;} catch {/* 초안 복구 */} return DEFAULT;});
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [connectionRetry,setConnectionRetry]=useState(0),[pollBlocked,setPollBlocked]=useState(false);
  const [review,setReview] = useState<Approval|'start'|null>(null);
  const [decision,setDecision] = useState<'hold'|'trade'|'rebalance'>('hold');
  const [side,setSide] = useState<'buy'|'sell'>('sell'), [amount,setAmount] = useState('1000000'), [percent,setPercent] = useState('20');
  const current = useRef<GuidedGame|null>(null), inFlight = useRef(false), mutating = useRef(false);
  const bootstrap = useRef<Promise<GuidedGame>|null>(null), seenAlert = useRef(''), lastTrades = useRef(0);
  const draftLoaded = useRef(false);
  const modal = useRef<HTMLElement|null>(null);
  function receive(g:GuidedGame) {
    const previouslyFinished = current.current?.status === 'finished';
    current.current = g; setGame(g);
    if (!draftLoaded.current) {
      const saved = g.status === 'ready' ? localStorage.getItem('eru-guided-draft') : null;
      if (saved) {try {const w = JSON.parse(saved); if (validWeights(w)) setDraft(w);} catch {/* 손상된 초안은 기본 구성으로 복구 */}}
      else if (g.initial_plan) setDraft(Object.fromEntries(Object.entries(g.targets).map(([k,v])=>[k,Number(v)])) as Allocation);
      draftLoaded.current = true;
    }
    if (g.trades.length > lastTrades.current) {setNotice('승인한 매매가 체결됐어요. 거래 내역에서 실제 수량·가격·수수료를 확인하세요.'); lastTrades.current = g.trades.length;}
    const alert = g.alerts.find(a=>a.decision === null);
    if (alert && alert.id !== seenAlert.current) {
      seenAlert.current = alert.id; setSelected(alert.asset); setSide(alert.side ?? 'sell'); setPercent(String(alert.percent ?? 20)); setDecision('hold'); setReview(null); setView('discussion');
    }
    if (g.status === 'finished' && !previouslyFinished) {setView('result'); setReview(null);}
  }
  useEffect(()=>{
    if (!bootstrap.current) bootstrap.current = (async()=>{
      const r = await fetch('/api/catalog'); if (!r.ok) throw new Error('자산 정보를 불러오지 못했어요.');
      const c = await r.json(); setCatalog(c.assets);
      const id = localStorage.getItem(SESSION);
      const freshSetup = new URLSearchParams(location.search).get('setup') === '1';
      if (id && !freshSetup) {try {const g = await api('/sessions/' + id); if (g.mode === 'guided') return g;} catch(e) {if ((e as {status?:number}).status !== 404) throw e;}}
      const g = await api('/guided-sessions',{});
      if (id) localStorage.setItem('eru-guided-previous-session',id);
      if (freshSetup) {
        localStorage.removeItem('eru-guided-draft'); setDraft(DEFAULT);
        const url = new URL(location.href); url.searchParams.delete('setup');
        history.replaceState(null,'',url.pathname+url.search+url.hash);
      }
      localStorage.setItem(SESSION,g.id); return g;
    })();
    void bootstrap.current.then(receive).catch(e=>setError(e.message));
  },[]);
  useEffect(()=>{
    if (!game?.id) return; let stopped = false; const id = game.id;
    let timer:ReturnType<typeof setTimeout>|undefined,failures=0;
    const running=game.status==='running';
    // 준비·정지·종료 중에는 자산 차트가 바뀔 때 한 번만 읽는다.
    if(!running&&current.current?.chart_asset===selected)return;
    setPollBlocked(false);
    function schedule(delay:number){if(!stopped&&running)timer=setTimeout(()=>void poll(),delay);}
    const poll = async()=>{
      if(stopped)return;
      if (inFlight.current || mutating.current || document.hidden) {schedule(1300);return;}
      inFlight.current = true;
      let delay:number|null=1300;
      try {const g = await api('/sessions/' + id + '?asset=' + selected); if (!stopped && current.current?.id === id) {receive(g);failures=0;setPollBlocked(false);setError(e=>e.startsWith('연결 확인 중:') ? '' : e);if(g.status!=='running')delay=null;}}
      catch(e) {if (!stopped) {failures++;delay=running&&failures<3?Math.min(30000,1300*2**failures):null;setPollBlocked(delay===null);setError('연결 확인 중: ' + (e as Error).message);}}
      finally {inFlight.current = false;}
      if(delay!==null)schedule(delay);
    };
    void poll(); return ()=>{stopped = true;clearTimeout(timer);};
  },[game?.id,game?.status,selected,connectionRetry]);
  useEffect(()=>{if (!notice) return; const t = setTimeout(()=>setNotice(''),10000); return ()=>clearTimeout(t);},[notice]);
  useEffect(()=>{localStorage.setItem('eru-guided-draft',JSON.stringify(draft));},[draft]);
  useEffect(()=>{const handler = (e:KeyboardEvent)=>{if (e.key === 'Escape' && !mutating.current) setReview(null);}; window.addEventListener('keydown',handler); return ()=>window.removeEventListener('keydown',handler);},[]);
  useEffect(()=>{
    if (!review || !modal.current) return;
    const previous = document.activeElement as HTMLElement|null;
    const root = modal.current;
    root.querySelector<HTMLButtonElement>('button')?.focus();
    function trap(e:KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const nodes = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
      const first = nodes[0], last = nodes[nodes.length-1];
      if (e.shiftKey && document.activeElement === first) {e.preventDefault();last?.focus();}
      else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first?.focus();}
    }
    root.addEventListener('keydown',trap);
    return ()=>{root.removeEventListener('keydown',trap);previous?.focus();};
  },[review]);
  async function action(name:string,body:object = {}) {
    if (!current.current || mutating.current) return null;
    mutating.current = true; setBusy(true); setError('');
    while (inFlight.current) await new Promise(r=>setTimeout(r,10));
    try {const g = await api('/sessions/' + current.current.id + '/' + name,body); receive(g); return g;}
    catch(e) {setError((e as Error).message); return null;}
    finally {mutating.current = false; setBusy(false);}
  }
  async function reset() {
    if (mutating.current) return; mutating.current = true; setBusy(true); setError('');
    while (inFlight.current) await new Promise(r=>setTimeout(r,10));
    try {const g = await api('/guided-sessions',{}); if(current.current)localStorage.setItem(SESSION+'-previous',current.current.id); localStorage.setItem(SESSION,g.id); localStorage.removeItem('eru-guided-draft'); draftLoaded.current = false; seenAlert.current = ''; lastTrades.current = 0; setDraft(DEFAULT); setView('portfolio'); receive(g);}
    catch(e) {setError((e as Error).message);}
    finally {mutating.current = false; setBusy(false);}
  }
  async function discuss() {
    if (!game || busy || game.pending || game.status === 'finished') return;
    if (game.status === 'running' && !await action('pause')) return;
    setView('discussion');
  }
  async function ask(question:string,setup?:SetupContext) {
    if (!validWeights(draft)) {setError('AI와 논의하려면 초안 비중 합계를 먼저 100%로 맞춰 주세요.'); return;}
    await action('chat',{request_id:crypto.randomUUID(),question,asset:selected,draft,...(setup ? {setup}: {})});
  }
  function apply(w:Allocation) {setDraft(w); setNotice('구성 초안에 담았어요. 확인·승인 전에는 주문하지 않아요.'); if (game?.status !== 'ready') setDecision('rebalance');}
  const alert = game?.alerts.find(a=>a.decision === null);
  const holding = game?.holdings.find(h=>h.asset === selected);
  const account = game?.interest_account, ready = game?.status === 'ready', finished = game?.status === 'finished';
  const active = game?.status === 'running', pending = game?.pending;
  const available = account?.available ?? 0;
  const buyAmount = Number(amount), sellPercent = Number(percent);
  const sellQuantity = Number(holding?.quantity ?? 0) * sellPercent / 100;
  const estimateGross = side === 'buy' ? buyAmount / 1.0005 : sellQuantity * (holding?.price ?? 0);
  const fee = estimateGross * .0005;
  const tradeValid = !pending && (side === 'buy' ? Number.isFinite(buyAmount) && buyAmount > 0 && buyAmount <= available : Number.isFinite(sellPercent) && sellPercent > 0 && sellPercent <= 100 && Number(holding?.quantity) > 0);
  const mentor = game && <Mentor messages={game.chat} busy={busy} selected={selected} onSelect={setSelected} onAsk={ask} onApply={apply}/>;
  function reviewDecision() {
    if (decision === 'hold') setReview({kind:'hold',...(alert ? {alert_id:alert.id}:{})});
    if (decision === 'rebalance' && validWeights(draft)) setReview({kind:'rebalance',weights:{...draft},...(alert ? {alert_id:alert.id}:{})});
    if (decision === 'trade' && tradeValid) setReview({kind:'trade',asset:selected,side,...(side === 'buy' ? {amount:buyAmount}:{percent:sellPercent}),...(alert ? {alert_id:alert.id}:{})});
  }
  async function approve() {
    if (!review) return;
    const g = review === 'start' ? await action('start',{weights:draft}) : await action('approved-order',review);
    if (g) {setReview(null); if (!g.alerts.some(a=>a.decision === null)) setView('portfolio'); setNotice(review === 'start' ? '구성을 확정했어요. 초기 주문은 다음 일봉 시가에 자동 체결돼요.' : '선택을 기록했어요. 승인한 주문이 있으면 다음 일봉 시가에 체결돼요.');}
  }
  const currentAsset = catalog.find(a=>a.alias === selected);
  const currentWeights = game && Object.fromEntries([['cash',Number((game.cash/game.nav*100).toFixed(1))],...game.holdings.map(h=>[h.asset,Number(h.weight.toFixed(1))])]);
  return <div className="app guided-app">
    <header className="topbar"><a className="brand" href="#" onClick={e=>{e.preventDefault();setView('portfolio');}}>ERU <span>AI 동행 투자</span></a><nav aria-label="주 메뉴">{([['portfolio',finished?'투자 복기':'내 포트폴리오'],['assets','자산 살펴보기'],['records','판단 기록']] as const).map(([v,label])=><button key={v} className={(view === v || finished && view === 'result' && v === 'portfolio') ? 'active':''} onClick={()=>setView(v)}>{label}</button>)}</nav><span className="virtual">과거 시장을 경험하는 5분</span></header>
    <div className="playbar"><span className={'play-state ' + game?.status}>{ready ? '투자 준비' : active ? '시장 진행 중' : finished ? '투자 종료' : '판단 시간 · 시장 정지'}</span><strong>{game ? date(game.now):'연결 중'}</strong><div className="timeline"><div><i style={{width:(game?.elapsed ?? 0)/3 + '%'}}/></div><small>2022.11.07 → 2026.08.05</small></div><span className="remaining">{clock(300 - (game?.elapsed ?? 0))}</span>{!ready && !finished && <button className="btn secondary" disabled={busy || !!alert} onClick={()=>void action(active ? 'pause':'resume')}>{active ? '잠시 멈추기' : pending ? '시장 재개하고 체결 보기':'시장 재개'}</button>}</div>
    <main>
      {error && <div className="message error" role="alert"><span>{error}</span>{pollBlocked&&<button className="btn secondary" disabled={busy} onClick={()=>setConnectionRetry(n=>n+1)}>연결 다시 확인</button>}<button aria-label="오류 닫기" onClick={()=>setError('')}>×</button></div>}
      {notice && <div className="message success" role="status"><span>{notice}</span><button aria-label="알림 닫기" onClick={()=>setNotice('')}>×</button></div>}
      {!game ? <section className="panel loading"><h1>{error?'게임을 연결하지 못했어요':'투자 실험을 준비하고 있어요'}</h1>{error && <><p>위 오류 내용을 확인해 주세요. 기존 게임과 설정은 삭제하지 않았어요.</p><button className="btn primary" onClick={()=>location.reload()}>다시 연결</button></>}</section> : <>
      {ready && view !== 'records' && <PortfolioSetup key={game.id} sessionId={game.id} catalog={catalog} total={game.initial}
        annualRate={account!.annual_rate} policy={account!.policy} terms={account!.terms} busy={busy} onChange={setDraft}
        onReview={w=>{setDraft(w);setReview('start');}}/>}
      {!ready && !finished && alert && <section className="guard-banner" role="status"><div><span className="eyebrow">리스크 가드</span><h2>시장을 잠시 멈췄어요</h2><p>{alert.summary}</p></div><button className="btn primary" onClick={()=>setView('discussion')}>AI와 대응 논의</button></section>}
      {!ready && view === 'portfolio' && !finished && <>
        <div className="page-title"><div className="eyebrow">계획이 실제 선택으로 바뀌는 중</div><h1>나의 투자 여정</h1><p>가격의 변화, 기다리는 돈의 이자, 내가 내린 판단을 함께 확인해요.</p></div>
        <div className="summary-grid"><section className="panel nav-summary"><small>총자산 · 미수이자 포함</small><div className="hero-price">{money(game.nav)}</div><span className={game.return_pct >= 0 ? 'up':'down'}>{pct(game.return_pct)} · {money(game.nav-game.initial)}</span></section><section className="panel"><small>매매 손익 · 수수료 반영</small><h2>{money(game.trading_profit)}</h2><small>가격 변동으로 얻거나 잃은 금액</small></section><section className="panel cash-summary"><small>누적 이자 · 세전</small><h2>{money(account?.accrued ?? 0)}</h2><small>현재 연 {account?.annual_rate}% · 게임 속 기간 기준</small></section></div>
        <section className="panel"><h2>기본 리스크 가드</h2><RiskSummary rules={game.risk_rules}/></section>{pending && <section className="panel pending-banner"><div><span className="status-chip">체결 대기</span><h2>{pending.kind === 'initial' ? '초기 구성 주문을 접수했어요' : pending.kind === 'rebalance' ? '변경한 구성의 매매를 기다려요':'승인한 주문을 기다려요'}</h2><p>{date(pending.at)} {pending.at.slice(11,16)} · 판단 이후 다음 일봉 시가에 체결돼요.</p></div>{game.status === 'paused' && <button className="btn primary" disabled={busy || !!alert} onClick={()=>void action('resume')}>시장 재개하고 체결 보기</button>}<button className="btn secondary" disabled={busy} onClick={async()=>{if (current.current?.status === 'running' && !await action('pause')) return; await action('cancel');}}>주문 취소</button></section>}
        <div className="guided-layout"><section className="panel portfolio-panel"><div className="section-title"><h2>내 포트폴리오</h2><button className="btn secondary" disabled={busy || !!pending} onClick={()=>void discuss()}>AI와 구성 다시 논의</button></div><div className="composition-label"><span>현재 비중</span><small>처음 계획과 가격 변화를 비교해요</small></div><div className="allocation-bar"><span className="segment segment-cash" style={{flex:game.cash/game.nav}}/>{game.holdings.map(h=><span key={h.asset} className={'segment segment-' + h.asset} style={{flex:h.value/game.nav}}/>)}</div>{game.holdings.map(h=><button className="portfolio-row" key={h.asset} onClick={()=>{setSelected(h.asset);setView('assets');}}><Badge asset={h.asset}/><span><b>{assetName(h.asset)}</b><small>{qty(h.quantity)}개 · 처음 {game.initial_plan?.[h.asset]}%</small></span><span><strong>{money(h.value)}</strong><small>현재 {h.weight.toFixed(1)}% · <em className={h.unrealized >= 0 ? 'up':'down'}>{money(h.unrealized)}</em></small></span></button>)}</section><section className="panel"><div className="eyebrow">기다리는 동안에도</div><h2>현금 (이자 수익)</h2><Pair label="현금 원금">{money(game.cash)}</Pair><Pair label="주문 예약금">{money(account?.reserved ?? 0)}</Pair><Pair label="주문 가능 금액">{money(available)}</Pair><Pair label="누적 미수이자">{money(account?.accrued ?? 0)}</Pair><p className="fine">{account?.terms}</p><details><summary>금리와 계산 방식</summary><p className="fine">{account?.policy}. 운용 가능 원금 × 연이율 × 게임 경과 일수 ÷ 365. 이자는 재투자하지 않아요.</p></details></section></div>
      </>}
      {!ready && view === 'assets' && <><div className="page-title"><h1>자산 살펴보기</h1><p>종목별 가격과 특징, 나의 체결 내역과 투자 손익을 확인해요.</p></div><div className="tabs">{aliases.map(a=><button key={a} className={selected === a ? 'selected':''} onClick={()=>setSelected(a)}>{assetName(a)}</button>)}</div><AssetDetail game={game} selected={selected} asset={currentAsset} busy={busy} onDiscuss={()=>void discuss()}/></>}
      {!ready && view === 'discussion' && !finished && <><div className="page-title"><h1>{alert ? '지금, 어떤 선택이 좋을까요?' : '구성을 다시 살펴볼까요?'}</h1><p>현재 시점에 멈춰서 근거와 영향을 비교해요. 대화만으로 매매가 실행되지는 않아요.</p></div>{active ? <section className="panel"><button className="btn primary" disabled={busy} onClick={()=>void action('pause')}>시장 멈추고 논의하기</button></section> : <div className="guided-layout discussion-layout">{mentor}<section className="panel decision-panel"><h2>논의 후 내 선택</h2>{alert && <div className="callout neutral"><b>{alert.title}</b><p>{alert.summary}</p><small>제안: {alert.side === 'buy' ? '사용 가능한 현금' : '해당 코인 보유 수량'}의 {alert.percent}% {alert.side === 'buy' ? '매수 검토':'매도 검토'}</small><button className="text-button" disabled={busy || !!pending} onClick={()=>{setSelected(alert.asset);setSide(alert.side ?? 'sell');setDecision('trade');setPercent(String(alert.percent ?? 20));if (alert.side === 'buy') setAmount(String(Math.floor(available*(alert.percent ?? 20)/100)));}}>이 제안을 주문 초안에 담기 →</button></div>}<div className="decision-options">{([['hold','그대로 유지'],['trade','종목 매수·매도'],['rebalance','전체 비중 조정']] as const).map(([v,label])=><button className={decision === v ? 'selected':''} key={v} disabled={busy || !!pending} onClick={()=>setDecision(v)}>{label}</button>)}</div>
        {decision === 'hold' && <p>매매 없이 현재 구성을 유지해요. 가격 변동 위험은 계속 부담하고, 현금에는 이자가 쌓여요.</p>}
        {decision === 'rebalance' && <><PlanEditor value={draft} onChange={setDraft} total={game.nav-(account?.accrued ?? 0)} disabled={busy}/><p className="fine">미수이자는 제외해요. 다음 시가에서 매도 후 수수료를 반영해 매수하므로 실제 금액·비중은 달라질 수 있어요.</p></>}
        {decision === 'trade' && <div className="trade-form"><label>종목<select aria-label="주문 종목" value={selected} onChange={e=>setSelected(e.target.value as Alias)}>{aliases.map(a=><option key={a} value={a}>{assetName(a)}</option>)}</select></label><div className="tabs"><button className={side === 'buy' ? 'selected':''} onClick={()=>setSide('buy')}>매수</button><button className={side === 'sell' ? 'selected':''} onClick={()=>setSide('sell')}>매도</button></div>{side === 'buy' ? <label>매수 예산 · 수수료 포함<input type="number" aria-label="매수 금액" min="1" max={available} value={amount} onChange={e=>setAmount(e.target.value)}/></label> : <label>보유 수량 중 매도할 비율 (%)<input type="number" aria-label="매도 비율" min=".1" max="100" step=".1" value={percent} onChange={e=>setPercent(e.target.value)}/></label>}<Pair label={side === 'buy' ? '주문 가능 금액':'매도할 수량'}>{side === 'buy' ? money(available):qty(sellQuantity) + '개'}</Pair><Pair label="예상 수수료">{money(Number.isFinite(fee) ? fee : 0)}</Pair><Pair label={side === 'buy' ? '주문 후 현금':'예상 매도 후 현금'}>{money(side === 'buy' ? game.cash-(buyAmount || 0) : game.cash+(estimateGross-fee || 0))}</Pair></div>}
        <button className="btn primary wide" disabled={busy || !!pending || (decision === 'trade' && !tradeValid) || (decision === 'rebalance' && !validWeights(draft))} onClick={reviewDecision}>{decision === 'hold' ? '유지 선택 확인':'변경 내용 확인'}</button>{pending && <p className="fine">기존 대기 주문을 먼저 체결하거나 취소해 주세요.</p>}</section></div>}</>}
      {finished && view !== 'assets' && view !== 'records' && <Suspense fallback={<section className="panel">투자 복기를 준비하고 있어요…</section>}><InvestmentReview key={game.id} game={game} onRestart={()=>void reset()} busy={busy}/></Suspense>}
      {view === 'records' && <section className="panel records-panel"><h2>판단과 실행 기록</h2>{game.choices.length ? [...game.choices].reverse().map((c,i)=><article className="record" key={'choice-' + i}><small>{date(c.at)}</small><b>{c.summary ?? c.action}</b></article>):<p>아직 투자 전이에요. 구성을 확정하면 기록이 시작돼요.</p>}<TradeHistory trades={game.trades}/>{pending && <p className="fine">접수된 주문이 있어요. 다음 일봉 시가 체결을 기다리고 있어요.</p>}<details><summary>대화 기록 ({game.chat.length})</summary>{game.chat.map(m=><article className="record" key={m.id}><small>{date(m.at)} · {m.status}</small><b>{m.question}</b>{m.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</article>)}</details></section>}
      <footer><span>실제 과거 시세 · 1억 원 · 활성 재생 300초</span><span>승인 후 다음 일봉 시가 체결 · 수수료 0.05%</span></footer>
      </>}
    </main>
    <nav className="mobile-nav" aria-label="모바일 주 메뉴">{([['portfolio',finished?'투자 복기':'포트폴리오'],['assets','자산'],['records','기록']] as const).map(([v,label])=><button key={v} className={(view === v || finished && view === 'result' && v === 'portfolio') ? 'selected':''} onClick={()=>setView(v)}>{label}</button>)}</nav>
    {review && game && <div className="modal-backdrop"><section ref={modal} className="confirm-modal panel" role="dialog" aria-modal="true" aria-labelledby="approval-title"><button className="close" aria-label="확인 닫기" disabled={busy} onClick={()=>setReview(null)}>×</button><div className="eyebrow">마지막으로 확인해 주세요</div><h2 id="approval-title">{review === 'start' ? '처음 구성으로 투자 시작' : review.kind === 'hold' ? '현재 구성 유지' : review.kind === 'rebalance' ? '변경한 비중으로 매매' : assetName(review.asset ?? selected) + ' ' + (review.side === 'buy' ? '매수':'매도')}</h2>{(review === 'start' || review.kind === 'rebalance') && (['cash',...aliases] as const).map(a=><Pair key={a} label={a === 'cash' ? '현금':assetName(a)}>{review === 'start' ? draft[a] : review.weights?.[a]}%</Pair>)}{review === 'start' && <RiskSummary rules={null}/>}
      {review !== 'start' && review.kind === 'trade' && <><Pair label={review.side === 'buy' ? '수수료 포함 매수 예산':'보유 수량 기준 매도 비율'}>{review.side === 'buy' ? money(review.amount ?? 0):review.percent + '%'}</Pair><Pair label="예상 수수료">{money(fee)}</Pair><Pair label="예상 주문 후 현금">{money(review.side === 'buy' ? game.cash-(review.amount ?? 0):game.cash+estimateGross-fee)}</Pair></>}{review !== 'start' && review.kind === 'hold' ? <p>새 주문 없이 현재 구성을 유지하고 시장을 재개해요.</p>:<div className="callout neutral"><b>승인 후 다음 일봉 시가에 자동 체결돼요</b><p>현재 표시한 예상과 실제 체결 수량·금액은 달라질 수 있어요. 비중 조정은 매도 후 확보한 자금으로 매수해요.</p></div>}{error && <p className="up" role="alert">{error}</p>}<button className="btn primary wide" disabled={busy} onClick={()=>void approve()}>{busy ? '처리 중…' : review === 'start' ? '확정하고 자동 투자 시작' : review.kind === 'hold' ? '유지하고 시장 재개':'이 주문 승인하고 자동 실행'}</button><button className="btn secondary wide" disabled={busy} onClick={()=>setReview(null)}>다시 논의하기</button></section></div>}
  </div>;
}
