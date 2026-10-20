import { useEffect, useRef, useState } from 'react';
import Chart from './Chart';
import { money, pct, date, clock, type Alias, type Asset, type Game } from './model';

type View = 'market' | 'detail' | 'account' | 'orders' | 'result';
const SESSION = 'eru-paper-session';
const qty = (v: string | number) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 8 });
const stamp = (v: string) => date(v) + ' ' + v.slice(11, 16);
function Badge({ asset }: { asset: string }) { return <span className={'asset-badge asset-' + asset}>{asset}</span>; }
function Change({ value, children }: { value: number; children?: React.ReactNode }) { return <span className={value > 0 ? 'up' : value < 0 ? 'down' : 'muted'}>{children ?? pct(value)}</span>; }
function Pair({ label, children }: { label: string; children: React.ReactNode }) { return <div className="pair"><span>{label}</span><strong>{children}</strong></div>; }
async function api(path: string, body?: object): Promise<any> {
  const r = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await r.json();
  if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : '입력값을 확인해 주세요.');
  return data;
}

export default function App() {
  const [game, setGame] = useState<Game | null>(null);
  const [catalog, setCatalog] = useState<Asset[]>([]);
  const [view, setView] = useState<View>('market');
  const [selected, setSelected] = useState<Alias>('A');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('eru-favorites') || '[]'); } catch { return []; } });
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('1000000');
  const [fraction, setFraction] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [info, setInfo] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [period, setPeriod] = useState(0);
  const [orderTab, setOrderTab] = useState<'pending' | 'filled'>('pending');
  const inFlight = useRef(false), mutating = useRef(false);
  const current = useRef<Game | null>(null), lastTrades = useRef<number | null>(null);
  const bootstrap = useRef<Promise<Game> | null>(null);
  current.current = game;
  useEffect(() => { window.scrollTo(0, 0); }, [view, selected]);
  function receive(g: Game) {
    const wasFinished = current.current?.id === g.id && current.current.status === 'finished';
    if (lastTrades.current !== null && g.trades.length > lastTrades.current) {
      const t = g.trades[g.trades.length - 1];
      setNotice(`코인 ${t.asset} ${t.side === 'buy' ? '매수' : '매도'} 완료 · ${qty(t.quantity)} ${t.asset} · 체결가 ${money(t.price)} · 수수료 ${money(t.fee)}`);
    }
    lastTrades.current = g.trades.length; current.current = g; setGame(g);
    if (g.status === 'finished' && !wasFinished) { setView('result'); setConfirm(false); }
  }
  useEffect(() => {
    if (!bootstrap.current) bootstrap.current = (async () => {
      const c = await api('/catalog'); setCatalog(c.assets);
      const id = localStorage.getItem(SESSION);
      if (id) { try { const g = await api(`/sessions/${id}`); if (g.mode === 'paper') return g; } catch { /* 저장 세션이 없으면 새 게임 */ } }
      const g = await api('/paper-sessions', {}); localStorage.setItem(SESSION, g.id); return g;
    })();
    void bootstrap.current.then(receive).catch(e => setError(e.message));
  }, []);
  useEffect(() => {
    if (!game?.id) return;
    const id = game.id; let stopped = false;
    const poll = async () => {
      if (inFlight.current || mutating.current || document.hidden) return;
      inFlight.current = true;
      try { const g = await api(`/sessions/${id}?asset=${selected}`); if (!stopped && current.current?.id === id) receive(g); }
      catch (e) { if (!stopped) setError((e as Error).message); }
      finally { inFlight.current = false; }
    };
    void poll(); const t = setInterval(poll, 1000); return () => { stopped = true; clearInterval(t); };
  }, [game?.id, selected]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 10000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { const f = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setConfirm(false); }; window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [busy]);
  async function action(name: string, body = {}) {
    if (!current.current || mutating.current) return null;
    mutating.current = true; setBusy(true); setError('');
    while (inFlight.current) await new Promise(r => setTimeout(r, 10));
    try { const g = await api(`/sessions/${current.current.id}/${name}`, body); receive(g); return g as Game; }
    catch (e) { setError((e as Error).message); return null; }
    finally { mutating.current = false; setBusy(false); }
  }
  async function retry() {
    if (mutating.current) return; mutating.current = true; setBusy(true); setError('');
    while (inFlight.current) await new Promise(r => setTimeout(r, 10));
    try { const g = await api('/paper-sessions', {}); localStorage.setItem(SESSION, g.id); lastTrades.current = null; receive(g); setView('market'); setRevealed(false); setNotice('가상 현금 1억 원으로 새롭게 시작해요.'); }
    catch (e) { setError((e as Error).message); } finally { mutating.current = false; setBusy(false); }
  }
  function choose(a: Alias, next: 'buy' | 'sell' = 'buy') { setSelected(a); setSide(next); setAmount(next === 'buy' ? '1000000' : ''); setFraction(null); setView('detail'); setInfo(false); }
  function favorite(a: string) { setFavorites(old => { const next = old.includes(a) ? old.filter(x => x !== a) : [...old, a]; localStorage.setItem('eru-favorites', JSON.stringify(next)); return next; }); }
  const holding = game?.holdings.find(h => h.asset === selected), asset = catalog.find(a => a.alias === selected);
  const n = Number(amount), rate = game?.fee_rate ?? .0005;
  const gross = side === 'buy' ? n / (1 + rate) : n * (holding?.price ?? 0), fee = gross * rate;
  const expectedQuantity = side === 'buy' ? gross / (holding?.price || 1) : n;
  const valid = Number.isFinite(n) && n > 0 && !!game && !game.pending && game.status !== 'finished' && (side === 'buy' ? Number.isInteger(n) && n <= game.cash : fraction !== null ? Number(holding?.quantity) > 0 : n <= Number(holding?.quantity));
  async function prepare() {
    if (!valid) return; let g = current.current;
    if (g?.status === 'ready') g = await action('play');
    if (g?.status === 'running') g = await action('pause');
    if (g?.status === 'paused' && !g.pending) setConfirm(true);
  }
  async function submit() {
    const body = side === 'buy' ? { asset: selected, side, amount: n } : fraction !== null ? { asset: selected, side, percent: fraction } : { asset: selected, side, quantity: amount };
    if (await action('orders', body)) { setConfirm(false); setOrderTab('pending'); setView('orders'); setNotice('주문이 접수됐어요. 시장을 재개하면 다음 일봉 시가로 체결돼요.'); }
  }
  const pending = game?.pending, reserved = pending?.side === 'buy' ? Number(pending.budget) : 0;
  const available = Math.max(0, (game?.cash ?? 0) - reserved), owned = game?.holdings.filter(h => Number(h.quantity) > 0) ?? [];
  const filtered = catalog.filter(a => (!onlyFavorites || favorites.includes(a.alias)) && `코인 ${a.alias}`.toLowerCase().includes(search.toLowerCase()));
  const candles = game?.chart_asset === selected ? game.chart : [];
  const data = (period ? candles.slice(-period) : candles).map(c => ({ time: c.time, value: c.close }));
  const finished = game?.status === 'finished';
  return <div className="app">
    <header className="topbar"><a className="brand" href="#" onClick={e => { e.preventDefault(); setView('market'); }}>ERU <span>모의투자</span></a><nav aria-label="주 메뉴">{([['market', '종목 찾기'], ['account', '내 투자'], ['orders', '주문 내역']] as const).map(([v, label]) => <button key={v} className={view === v || (v === 'market' && view === 'detail') ? 'active' : ''} onClick={() => setView(v)}>{label}</button>)}</nav><label className="search"><span aria-hidden="true">⌕</span><input aria-label="종목 검색" placeholder="종목 이름 검색" value={search} onChange={e => { setSearch(e.target.value); setView('market'); }} /></label><span className="virtual">가상 투자</span></header>
    <div className="playbar"><span className={'play-state ' + game?.status}>{game?.status === 'running' ? '● 시장 재생 중' : game?.status === 'paused' ? '일시정지' : finished ? '투자 종료' : '시작 전'}</span><strong>{game ? stamp(game.now) : '불러오는 중…'}</strong><div className="timeline"><div><i style={{ width: `${(game?.elapsed ?? 0) / 3}%` }} /></div><small>2022.11.07 → 2026.08.05 · 5분 동안 투자해요</small></div><span className="remaining">남은 시간 <b>{clock(300 - (game?.elapsed ?? 0))}</b></span><button className={game?.status === 'ready' ? 'btn primary' : 'btn secondary'} disabled={!game || busy} onClick={() => finished ? setView('result') : void action(game?.status === 'ready' ? 'play' : game?.status === 'running' ? 'pause' : 'resume')}>{game?.status === 'ready' ? '모의투자 시작' : game?.status === 'running' ? '일시정지' : finished ? '투자 결과 보기' : '시장 재개'}</button></div>
    <main>{error && <div className="message error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="오류 닫기">×</button></div>}{notice && <div className="message success" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="알림 닫기">×</button></div>}
    {!game ? <section className="panel loading"><h1>실제 과거 시장을 불러오고 있어요</h1><p>가상 현금 1억 원으로 직접 투자해 보세요.</p>{error && <button className="btn primary" onClick={() => location.reload()}>다시 연결</button>}</section> : <>
      {view === 'market' && <><div className="page-title"><h1>어떤 종목에 투자해 볼까요?</h1><p>가상 현금 1억 원으로 시작해요. 종목을 고르고 원하는 금액만큼 매수하세요.</p></div><div className="market-layout"><section className="panel market-panel"><div className="tabs"><button className={!onlyFavorites ? 'selected' : ''} onClick={() => setOnlyFavorites(false)}>전체 종목</button><button className={onlyFavorites ? 'selected' : ''} onClick={() => setOnlyFavorites(true)}>관심 종목</button></div><div className="asset-table"><div className="asset-head"><span>종목</span><span>현재 가격</span><span>최근 확정일 등락</span><span /></div>{filtered.map(a => { const h = game.holdings.find(h => h.asset === a.alias)!; return <div className="asset-row" key={a.alias}><button className="coin-name" onClick={() => choose(a.alias as Alias)}><Badge asset={a.alias} /><span><b>{a.name}</b><small>{Number(h.quantity) > 0 ? `${qty(h.quantity)} ${a.alias} 보유` : '보유 없음'}</small></span></button><strong>{money(h.price)}</strong><Change value={h.change_pct} /><div className="row-actions"><button className={'favorite ' + (favorites.includes(a.alias) ? 'on' : '')} onClick={() => favorite(a.alias)} aria-label={`${a.name} 관심 ${favorites.includes(a.alias) ? '해제' : '추가'}`}>{favorites.includes(a.alias) ? '♥' : '♡'}</button><button className="btn secondary" onClick={() => choose(a.alias as Alias)}>종목 보기</button></div></div>; })}{!filtered.length && <p className="empty">{search ? '검색한 종목이 없어요.' : '하트를 눌러 관심 종목을 담아 보세요.'}</p>}</div><div className="callout"><b>종목을 누르면 차트와 매수 화면이 열려요</b><p>실제 과거 가격으로 투자해요. 실제 자산 이름은 투자가 끝나면 확인할 수 있어요.</p></div></section><aside className="stack"><section className="panel"><p className="muted">내 투자금</p><h2 className="balance">{money(game.nav)}</h2><Pair label="주문 가능 금액">{money(available)}</Pair><Pair label="보유 종목">{owned.length}개</Pair><button className="btn primary wide" disabled={busy} onClick={() => game.status === 'ready' ? void action('play') : setView('account')}>{game.status === 'ready' ? '모의투자 시작' : '내 투자 보기'}</button><small>총 5분 · 직접 멈추고 주문할 수 있어요</small></section><section className="panel howto"><h3>이렇게 투자해요</h3><p>1　종목과 차트를 살펴봐요</p><p>2　원하는 금액으로 주문해요</p><p>3　내 투자에서 체결을 확인해요</p></section></aside></div></>}
      {view === 'detail' && <div className="market-layout"><section className="panel detail-panel"><div className="quote-header"><Badge asset={selected} /><div><h2>코인 {selected}</h2><div className="quote"><strong>{money(holding?.price ?? 0)}</strong><Change value={holding?.change_pct ?? 0} /></div></div><button className="btn secondary favorite-detail" onClick={() => favorite(selected)}>{favorites.includes(selected) ? '♥ 관심 종목' : '♡ 관심 종목'}</button></div><div className="tabs"><button className={!info ? 'selected' : ''} onClick={() => setInfo(false)}>차트</button><button className={info ? 'selected' : ''} onClick={() => setInfo(true)}>종목 정보</button></div>{info ? <div className="asset-info"><h3>어떤 종목인가요?</h3><p>{asset?.overview}</p><h3>기술과 공급 구조</h3><p>{asset?.technology}</p><p>{asset?.supply}</p><h3>투자 전 알아둘 점</h3><ul>{asset?.risks?.map(r => <li key={r}>{r}</li>)}</ul></div> : <><Chart key={selected} data={data} label={`코인 ${selected} 확정 일봉 가격`} /><div className="period-tabs">{[[30, '1개월'], [90, '3개월'], [0, '전체']].map(([v, label]) => <button key={v} className={period === v ? 'selected' : ''} onClick={() => setPeriod(Number(v))}>{label}</button>)}</div><div className="quote-facts"><div><small>최근 확정일</small><b>{candles.length ? date(candles[candles.length - 1].time) : '아직 없어요'}</b></div><div><small>평균 매입가 · 수수료 포함</small><b>{Number(holding?.quantity) > 0 ? money(holding!.average_cost) : '보유 없음'}</b></div><div><small>내 보유 수량</small><b>{qty(holding?.quantity ?? 0)} {selected}</b></div></div><p className="fine">완료된 일봉만 표시해요. 현재 가격은 마지막으로 확인 가능한 시세예요.</p></>}</section><aside className="panel order-panel"><div className="tabs"><button className={side === 'buy' ? 'selected buy-tab' : ''} onClick={() => { setSide('buy'); setAmount('1000000'); setFraction(null); }}>매수</button><button className={side === 'sell' ? 'selected' : ''} onClick={() => { setSide('sell'); setAmount(''); setFraction(null); }}>매도</button></div><h2>{side === 'buy' ? '얼마나 살까요?' : '얼마나 팔까요?'}</h2><Pair label={side === 'buy' ? '주문 가능 금액' : '팔 수 있는 수량'}>{side === 'buy' ? money(available) : `${qty(holding?.quantity ?? 0)} ${selected}`}</Pair><label className="order-label">{side === 'buy' ? '매수 금액 · 수수료 포함' : '매도 수량'}<div className="number-input"><input aria-label={side === 'buy' ? '매수 금액' : '매도 수량'} inputMode="decimal" type="number" min="0" step={side === 'buy' ? '1' : 'any'} value={amount} onChange={e => { setAmount(e.target.value); setFraction(null); }} /><b>{side === 'buy' ? '원' : selected}</b></div></label><div className="quick-buttons">{(side === 'buy' ? ['+100만', '+500만', '최대'] : ['25%', '50%', '전량']).map((label, i) => <button className="btn secondary" key={label} onClick={() => { if (side === 'buy') { setAmount(String(i === 2 ? Math.floor(available) : Math.max(0, Number(amount)) + (i === 0 ? 1000000 : 5000000))); setFraction(null); } else { const p = [25, 50, 100][i]; setFraction(p); setAmount(i === 2 ? holding!.quantity : String(Number(holding?.quantity ?? 0) * p / 100)); } }}>{label}</button>)}</div><hr /><Pair label={side === 'buy' ? '예상 수량' : '예상 매도 금액'}>{side === 'buy' ? `${qty(Math.max(0, expectedQuantity || 0))} ${selected}` : money(Math.max(0, gross || 0))}</Pair><Pair label="예상 수수료">{money(Math.max(0, fee || 0))}</Pair><Pair label={side === 'buy' ? '총 필요 금액' : '예상 받을 금액'}>{money(Math.max(0, side === 'buy' ? n || 0 : gross - fee || 0))}</Pair><div className="callout neutral"><b>다음 일봉 시가로 체결돼요</b><p>주문할 때 시장을 멈춰요. 접수 후 시장을 재개하면 다음 거래 시점에 체결돼요.</p></div><button className={'btn wide ' + (side === 'buy' ? 'buy' : 'primary')} disabled={!valid || busy} onClick={() => void prepare()}>{game.status === 'ready' ? '모의투자 시작하고 ' : ''}{side === 'buy' ? '매수 주문 확인' : '매도 주문 확인'}</button>{pending && <button className="text-button" onClick={() => setView('orders')}>먼저 대기 주문을 확인해 주세요 →</button>}{side === 'sell' && !Number(holding?.quantity) && <p className="fine">보유한 수량이 있어야 매도할 수 있어요.</p>}<small>주문 전에는 자산이 바뀌지 않아요</small></aside></div>}
      {view === 'account' && <><div className="account-layout"><section className="panel"><h1>내 투자</h1><div className="hero-price">{money(game.nav)}</div><Change value={game.return_pct}>총 수익 {money(game.nav - game.initial)} ({pct(game.return_pct)})</Change><div className="account-stats"><div><small>보유 종목 평가금</small><h3>{money(owned.reduce((v, h) => v + h.value, 0))}</h3></div><div><small>현금 잔고</small><h3>{money(game.cash)}</h3></div><div><small>주문 대기</small><h3>{pending ? '1건' : '0건'}</h3></div></div></section><section className="panel"><h3>내 현금</h3><Pair label="현금 잔고">{money(game.cash)}</Pair><Pair label="매수 예약 금액">{money(reserved)}</Pair><Pair label="주문 가능 금액">{money(available)}</Pair><Pair label="누적 수수료">{money(game.fees)}</Pair></section></div><section className="panel holding-panel"><h2>보유 종목</h2>{owned.length ? owned.map(h => <div className="holding-row" key={h.asset}><button className="coin-name" onClick={() => choose(h.asset)}><Badge asset={h.asset} /><span><b>코인 {h.asset}</b><small>{qty(h.quantity)} {h.asset} · 평균 {money(h.average_cost)}</small></span></button><div><strong>{money(h.value)}</strong><small><Change value={h.unrealized}>{money(h.unrealized)} ({pct(h.average_cost ? (h.price / h.average_cost - 1) * 100 : 0)})</Change></small></div><button className="btn primary" onClick={() => choose(h.asset, 'sell')} disabled={finished}>매도</button></div>) : <div className="empty"><h3>아직 보유한 종목이 없어요</h3><p>종목을 살펴보고 첫 투자를 시작해 보세요.</p><button className="btn primary" onClick={() => setView('market')}>종목 찾아보기</button></div>}<p className="fine">평가손익과 총 수익에 수수료가 반영돼요. 평균 매입가는 매수 수수료를 포함해요.</p></section><button className="btn secondary" onClick={() => { setOrderTab('filled'); setView('orders'); }}>주문·체결 내역 보기</button></>}
      {view === 'orders' && <><h1>주문 내역</h1><div className="tabs"><button className={orderTab === 'pending' ? 'selected' : ''} onClick={() => setOrderTab('pending')}>대기 중 {pending ? 1 : 0}</button><button className={orderTab === 'filled' ? 'selected' : ''} onClick={() => setOrderTab('filled')}>체결 완료 {game.trades.length}</button></div>{orderTab === 'pending' ? pending ? <section className="panel pending-panel"><div className="quote-header"><Badge asset={pending.asset ?? 'A'} /><h2>코인 {pending.asset} {pending.side === 'buy' ? '매수' : '매도'} 접수</h2><span className="status-chip">체결 대기</span></div><Pair label={pending.side === 'buy' ? '총 매수 예산 · 수수료 포함' : '매도 수량'}>{pending.side === 'buy' ? money(pending.budget ?? 0) : `${qty(pending.quantity ?? 0)} ${pending.asset}`}</Pair><Pair label="체결 예정">{stamp(pending.at)} · 다음 일봉 시가</Pair><div className="callout"><b>주문은 접수됐고, 거래는 아직 완료되지 않았어요</b><p>체결되면 보유 수량과 현금이 바뀌고, 체결 완료 내역에 가격·수량·수수료가 표시돼요.</p></div><Pair label="현금 잔고">{money(game.cash)}</Pair><Pair label="추가 주문 가능 금액">{money(available)}</Pair><div className="actions"><button className="btn primary" disabled={busy || game.status !== 'paused'} onClick={() => void action('resume')}>{game.status === 'running' ? '시장 재생 중 · 체결 기다리는 중' : '시장 재개하고 체결 보기'}</button><button className="btn secondary" disabled={busy} onClick={async () => { if (current.current?.status === 'running' && !await action('pause')) return; if (await action('cancel')) setNotice('주문을 취소했어요. 예약 금액이 해제됐어요.'); }}>주문 취소</button></div></section> : <section className="panel empty"><h2>대기 중인 주문이 없어요</h2><p>{game.trades.length ? '체결 완료 탭에서 결과를 확인하세요.' : '종목을 선택해 직접 주문해 보세요.'}</p><button className="btn secondary" onClick={() => setView(game.trades.length ? 'account' : 'market')}>{game.trades.length ? '내 투자 보기' : '종목 찾아보기'}</button></section> : <section className="panel"><h2>체결 완료 내역</h2>{game.trades.length ? [...game.trades].reverse().map((t, i) => <article className="trade-row" key={`${t.at}-${i}`}><div className="coin-name"><Badge asset={t.asset} /><span><b>코인 {t.asset} <span className={t.side === 'buy' ? 'up' : 'down'}>{t.side === 'buy' ? '매수' : '매도'} 완료</span></b><small>{stamp(t.at)}</small></span></div><div><strong>{qty(t.quantity)} {t.asset} × {money(t.price)}</strong><small>수수료 {money(t.fee)} · {t.side === 'buy' ? '사용' : '받은'} 금액 {money(Number(t.gross) + (t.side === 'buy' ? Number(t.fee) : -Number(t.fee)))}</small></div></article>) : <p className="empty">아직 체결된 거래가 없어요.</p>}</section>}</>}
      {view === 'result' && <><section className="panel result-summary"><h1>5분의 투자, 이렇게 마무리됐어요</h1><div className="hero-price">{money(game.nav)}</div><Change value={game.return_pct}>시작보다 {money(game.nav - game.initial)} ({pct(game.return_pct)})</Change><div className="account-stats"><div><small>시작 자금</small><h3>{money(game.initial)}</h3></div><div><small>총 거래</small><h3>{game.trades.length}회</h3></div><div><small>총 수수료</small><h3>{money(game.fees)}</h3></div><div><small>가장 큰 하락폭</small><h3>-{game.mdd_pct.toFixed(2)}%</h3></div></div></section><div className="account-layout"><section className="panel"><h2>내가 투자한 실제 자산</h2>{revealed ? Object.entries(game.identities ?? {}).map(([a, name]) => <Pair key={a} label={`코인 ${a}`}>{name}</Pair>) : <><p>이제 가명 뒤에 있던 실제 자산을 확인할 수 있어요.</p><button className="btn secondary" onClick={() => setRevealed(true)}>실제 자산 확인</button></>}</section><section className="panel callout"><h2>다른 선택을 해볼까요?</h2><p>가상 현금 1억 원으로 새롭게 투자해 보세요.</p><button className="btn primary wide" disabled={busy} onClick={() => void retry()}>다시 투자하기</button><button className="text-button" onClick={() => { setOrderTab('filled'); setView('orders'); }}>내 거래 기록 보기 →</button></section></div></>}
      <footer><span>실제 과거 시세로 진행하는 가상 투자예요</span><span>매매 판단 뒤 다음 일봉 시가로 체결 · 수수료 0.05%</span></footer>
    </>}</main>
    <nav className="mobile-nav" aria-label="모바일 주 메뉴">{([['market', '종목'], ['account', '내 투자'], ['orders', '주문']] as const).map(([v, label]) => <button key={v} className={view === v || (v === 'market' && view === 'detail') ? 'selected' : ''} onClick={() => setView(v)}>{label}</button>)}</nav>
    {confirm && <div className="modal-backdrop" onClick={() => !busy && setConfirm(false)}><section className="confirm-modal panel" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={e => e.stopPropagation()}><button className="close" aria-label="주문 확인 닫기" disabled={busy} onClick={() => setConfirm(false)}>×</button><Badge asset={selected} /><h2 id="confirm-title">코인 {selected} {side === 'buy' ? money(n) + ' 매수' : qty(n) + ' ' + selected + ' 매도'}</h2><p>주문 내용을 한 번 더 확인해 주세요.</p><Pair label={side === 'buy' ? '매수대금 · 수수료 제외' : '예상 매도 금액'}>{money(gross)}</Pair><Pair label="예상 수수료">{money(fee)}</Pair><Pair label={side === 'buy' ? '총 필요 금액' : '예상 받을 금액'}>{money(side === 'buy' ? n : gross - fee)}</Pair>{side === 'buy' && <Pair label="주문 후 남을 현금">{money(game!.cash - n)}</Pair>}<div className="callout neutral"><b>다음 일봉 시가로 체결돼요</b><p>매수 수량과 매도 금액은 체결 가격에 따라 달라져요. 접수 후 시장을 재개해 주세요.</p></div>{error && <p className="up" role="alert">{error}</p>}<button className={'btn wide ' + (side === 'buy' ? 'buy' : 'primary')} disabled={busy || !valid} onClick={() => void submit()}>{busy ? '접수 중…' : side === 'buy' ? '매수 주문 접수' : '매도 주문 접수'}</button><button className="btn secondary wide" disabled={busy} onClick={() => setConfirm(false)}>다시 입력</button></section></div>}
  </div>;
}
