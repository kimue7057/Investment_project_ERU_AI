import {useEffect,useRef,useState} from 'react';
import {aliases,assetName,date,money,pct,type GuidedGame} from './model';
import TradeHistory,{Profit} from './TradeHistory';
import {chartDomain,decisionTitle,pointAt,markerLayout,type InvestmentReviewData,type ReviewDecision,type Recap} from './reviewModel';
import './review.css';

async function request<T>(path:string,signal?:AbortSignal,post=false):Promise<T>{
  const response=await fetch(path,{signal,...(post?{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  const body=await response.json();
  if(!response.ok)throw new Error(typeof body.detail==='string'?body.detail:'복기 기록을 불러오지 못했어요.');
  return body;
}
function Row({label,children}:{label:string;children:React.ReactNode}){return <div className="review-row"><span>{label}</span><strong>{children}</strong></div>;}

function AssetChart({review,selected,onSelect}:{review:InvestmentReviewData;selected:string;onSelect:(id:string)=>void}){
  const all=[...review.history,...(review.baseline?.history??[])];
  const domain=chartDomain(all,review.decisions);
  const start=Date.parse(review.history[0].time),end=Date.parse(review.history.at(-1)!.time);
  const x=(t:string)=>(Date.parse(t)-start)/(end-start)*100;
  const y=(n:number)=>100-(n-domain.min)/(domain.max-domain.min)*100;
  const path=(points:typeof all)=>points.map((p,i)=>`${i?'L':'M'}${x(p.time)*10},${y(p.value)*2.6}`).join(' ');
  const [cursor,setCursor]=useState(1000);
  const plot=useRef<HTMLDivElement>(null),[size,setSize]=useState({width:900,height:260});
  useEffect(()=>{const target=plot.current;if(!target)return;const observer=new ResizeObserver(()=>{const r=target.getBoundingClientRect();if(r.width&&r.height)setSize({width:r.width,height:r.height});});observer.observe(target);return()=>observer.disconnect();},[]);
  const markers=markerLayout(review.decisions,start,end,domain,size.width,size.height);
  const t=start+(end-start)*cursor/1000,point=pointAt(review.history,t),base=review.baseline?pointAt(review.baseline.history,t):null;
  return <section className="panel review-chart-panel" aria-label="자산 변화와 투자 판단">
    <div className="section-title"><div><h2>내 자산이 지나온 길</h2><p>숫자를 선택하면 당시 판단과 체결을 함께 볼 수 있어요.</p></div><span className="review-period">2022.11.07 — 2026.08.05</span></div>
    <div className="review-legend"><span><i/>실제 총자산</span>{review.baseline&&<span><i className="baseline"/>처음 계획 그대로 보유</span>}</div>
    <div className="review-chart"><div className="review-y-labels">{[domain.max,(domain.max+domain.min)/2,domain.min].map(v=><span key={v}>{(v/100000000).toFixed(2)}억</span>)}</div>
      <div className="review-plot" ref={plot}><svg viewBox="0 0 1000 260" preserveAspectRatio="none" role="img" aria-label="실제 총자산과 처음 계획 보유 가정의 변화 그래프"><title>실제 자산과 처음 계획을 유지한 가정 비교</title><defs><linearGradient id="review-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#7970d8" stopOpacity=".15"/><stop offset="100%" stopColor="#7970d8" stopOpacity="0"/></linearGradient></defs>{[0,130,260].map(v=><line key={v} x1="0" x2="1000" y1={v} y2={v} stroke="#e9e7ef" strokeDasharray="4 5"/>)}<path d={path(review.history)+' L1000,260 L0,260 Z'} fill="url(#review-fill)"/>{review.baseline&&<path d={path(review.baseline.history)} fill="none" stroke="#a8a3b8" strokeWidth="2" strokeDasharray="7 5" vectorEffect="non-scaling-stroke"/>}<path d={path(review.history)} fill="none" stroke="#6560c8" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/><line x1={cursor} x2={cursor} y1="0" y2="260" stroke="#c7c1dc"/>{markers.map(m=><line key={m.id} x1={m.anchorX*10} y1={m.anchorY*2.6} x2={m.x*10} y2={m.y*2.6} stroke="#bdb4da" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}</svg>
      {review.decisions.map((d,i)=><button key={d.id} className={'review-marker '+(selected===d.id?'selected':'')} style={{left:`${markers[i].x}%`,top:`${markers[i].y}%`}} onClick={()=>onSelect(d.id)} aria-pressed={selected===d.id} aria-label={`${i+1}번 ${date(d.at)} ${decisionTitle(d)}`}>{i+1}</button>)}
      </div></div><div className="review-x-labels"><span>2022.11</span><span>2024.09</span><span>2026.08</span></div>
    <label className="review-cursor">날짜별 자산 확인<input aria-label="자산 그래프 날짜" type="range" min="0" max="1000" value={cursor} onChange={e=>setCursor(Number(e.target.value))}/></label>
    <div className="review-chart-values" aria-live="polite"><span>{date(point.time)}</span><strong>실제 {money(point.value)}</strong>{base&&<span>처음 계획 {money(base.value)}</span>}</div>
    {review.baseline&&<div className="review-baseline-note"><span>처음 계획 그대로 보유했다면 <b>{money(review.baseline.nav)}</b></span><span>실제와의 차이 <Profit value={review.baseline.difference}/></span><small>첫 승인 비중을 다음 일봉 시가에 매수한 뒤 추가 매매 없이 보유한 가정이에요. 양쪽 모두 매매 수수료·예약금 제외 현금 단리 이자를 반영했어요. 실제 초기 주문을 취소했어도 비교는 첫 계획을 기준으로 해요.</small></div>}
  </section>;
}

function DecisionDetail({decision,index}:{decision:ReviewDecision;index:number}){
  const d=decision;
  return <section className="panel review-detail" tabIndex={-1} aria-labelledby="decision-detail-title" data-review-detail={d.id}>
    <div className="eyebrow">선택 {index+1} · {date(d.at)}</div><h2 id="decision-detail-title">{decisionTitle(d)}</h2><p>{d.summary}</p>
    <div className="review-situation"><h3>그때의 상황</h3><p>{d.situation}</p>{d.nav&&<Row label="판단 당시 총자산">{money(d.nav)}</Row>}{d.composition&&<div className="review-composition">{(['cash',...aliases] as const).filter(a=>Number(d.composition![a])>.01).map(a=><span key={a}>{assetName(a)} {Number(d.composition![a]).toFixed(1)}%</span>)}</div>}</div>
    {d.linkage==='legacy'&&<p className="fine">이전 판단 기록에는 승인 식별자가 없어요. 체결과 대화의 연결을 추측하지 않았어요.</p>}
    {d.discussions.length>0&&<details><summary>이 선택 전에 나눈 대화 {d.discussions.length}개</summary>{d.discussions.map(m=><article className="record" key={m.id}><b>{m.question}</b><small>{m.status}</small>{m.paragraphs.map((p,i)=><p key={i}>{p}</p>)}</article>)}</details>}
    <h3>실제로 실행된 내용</h3>
    {d.fills.length?<><Row label="체결 시점">{date(d.fills[0].at)} {d.fills[0].at.slice(11,16)}</Row><Row label="매매 현금 흐름">{Number(d.cash_flow)>0?'+':''}{money(d.cash_flow)}</Row>{d.realized_pnl!==null?<Row label="이 매도의 실현손익"><Profit value={d.realized_pnl}/></Row>:<p className="fine">매수만으로 실현손익이 확정되지는 않아요. 남은 보유분은 종목별 평가손익에서 확인해요.</p>}<p className="fine">실현손익은 이동평균 매수원가와 매수·매도 수수료를 반영해요. 현금 흐름은 손익과 달라요.</p><details><summary>체결가·수량·수수료 보기 ({d.fills.length}건)</summary><TradeHistory trades={d.fills}/></details></>:<div className="review-empty">{d.cancelled||d.action==='cancel'?'체결 전에 취소했어요. 이 선택으로 발생한 체결은 없어요.':d.action==='hold'||d.action==='ignore'?'새 주문 없이 현재 구성을 유지했어요.':d.action==='start'&&d.linkage==='recorded'?'현금으로 운용했어요. 체결된 초기 코인 주문은 없어요.':'연결된 체결 기록이 없어요.'}</div>}
    {d.comparison&&<div className="review-comparison"><span className="eyebrow">가정 비교 · 실제 최종 손익과 별도</span><h3>이 매매를 하지 않았다면?</h3><Row label="매매 후 그대로 보유">{money(d.comparison.acted)}</Row><Row label="매매 없이 그대로 보유">{money(d.comparison.unchanged)}</Row><div className="review-comparison-diff"><span>두 가정의 종료 자산 차이</span><strong><Profit value={d.comparison.difference}/></strong></div><p>{Number(d.comparison.difference)>0?'이후 추가 거래를 하지 않는 가정에서는 이 매매를 한 쪽의 종료 자산이 더 커요.':Number(d.comparison.difference)<0?'이후 추가 거래를 하지 않는 가정에서는 매매하지 않은 쪽의 종료 자산이 더 커요.':'두 가정의 종료 자산이 같아요.'}</p><small>체결 직전 구성에서 두 갈래로 비교했어요. 이후의 실제 주문은 양쪽 모두 제외하고 종료일까지 보유해요. 체결 수수료와 이후 현금 단리 이자를 반영하며, 체결 전 적립 이자는 양쪽 공통으로 제외해요. 선택별 비교 차액은 서로 합산하지 않아요.</small></div>}
    {d.period&&<div className="review-period-change"><h3>그 후 전체 자산은?</h3><Row label={`${date(d.period.until)}${d.period.until.endsWith('23:59:59+09:00')?' 종료':' 다음 판단'}까지`}><Profit value={d.period.change}/></Row><p className="fine">그 기간의 전체 자산 변화예요. 시장 변동·이자·다른 매매가 함께 반영되므로 이 선택만의 손익을 뜻하지 않아요.</p></div>}
  </section>;
}

export default function InvestmentReview({game,onRestart,busy}:{game:GuidedGame;onRestart:()=>void;busy:boolean}){
  const [review,setReview]=useState<InvestmentReviewData|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[selected,setSelected]=useState('');
  const [recap,setRecap]=useState<Recap|null>(null),[recapBusy,setRecapBusy]=useState(false),[recapError,setRecapError]=useState(''),[revealed,setRevealed]=useState(false);
  const detailAnchor=useRef<HTMLDivElement>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{const controller=new AbortController();setError('');request<InvestmentReviewData>(`/api/sessions/${game.id}/review`,controller.signal).then(data=>{setReview(data);setRecap(data.recap);setSelected(data.decisions[0]?.id??'');}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);});return()=>controller.abort();},[game.id,retry]);
  function select(id:string){setSelected(id);if(matchMedia('(max-width: 1000px)').matches)detailAnchor.current?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
  async function summarize(){setRecapBusy(true);setRecapError('');try{const r=await request<Recap>(`/api/sessions/${game.id}/review/recap`,undefined,true);if(alive.current)setRecap(r);}catch(e){if(alive.current)setRecapError((e as Error).message);}finally{if(alive.current)setRecapBusy(false);}}
  if(!review)return <section className="panel"><h1>{error?'복기를 불러오지 못했어요':'투자 기록을 정리하고 있어요'}</h1>{error&&<><p role="alert">{error}</p><button className="btn primary" onClick={()=>setRetry(n=>n+1)}>다시 불러오기</button></>}</section>;
  const chosen=review.decisions.find(d=>d.id===selected)??review.decisions[0];
  return <div className="investment-review"><div className="review-heading"><div><span className="eyebrow">MY INVESTMENT REPLAY</span><h1>나의 선택은 자산을<br className="review-mobile-break"/> 어떻게 바꿨을까요?</h1><p>5분의 투자, 이제 판단의 과정을 돌아볼 시간이에요.</p></div><span className="review-complete">투자 종료 · 300초</span></div>
    <section className="panel review-summary"><div><span>나의 최종 자산</span><h2>{money(review.final_nav)}</h2><strong><Profit value={review.net_profit}/> <span>({pct(Number(review.return_pct))})</span></strong><small>시작 자산 {money(review.initial)}</small></div><div className="review-metrics"><div><span>매매 순손익</span><b><Profit value={review.trading_profit}/></b><small>실현 + 평가 · 수수료 반영</small></div><div><span>현금 이자</span><b>{money(review.interest)}</b><small>종료 시 정산 · 세전 단리</small></div><div><span>포함된 수수료</span><b>{money(review.fees)}</b><small>손익에서 다시 빼지 않아요</small></div><div><span>최대 낙폭</span><b>{Number(review.mdd_pct).toFixed(2)}%</b><small>고점 대비 가장 큰 하락</small></div></div></section>
    <AssetChart review={review} selected={chosen?.id??''} onSelect={select}/>
    <div className="review-body"><div className="review-left"><section className="panel review-choices"><div className="section-title"><div><h2>선택별로 돌아보기</h2><p>유지한 판단도, 매수와 매도도 함께 남겼어요.</p></div><span>{review.decisions.length}개</span></div><div className="review-choice-list">{review.decisions.map((d,i)=><button key={d.id} className={'review-choice '+(chosen?.id===d.id?'selected':'')} onClick={()=>select(d.id)} aria-pressed={chosen?.id===d.id}><span className="review-number">{i+1}</span><div><small>{date(d.at)}</small><b>{decisionTitle(d)}</b><p>{d.summary}</p></div><span className="review-choice-outcome">{d.realized_pnl!==null?<><small>실현손익</small><Profit value={d.realized_pnl}/></>:d.fills.length?`${d.fills.length}건 체결`:d.cancelled?'미체결':'주문 없음'}<span aria-hidden="true"> ↗</span></span></button>)}</div></section>
    <section className="panel review-assets"><h2>종목별로 남은 결과</h2><p>전체 기간의 누적 매도 손익과 아직 보유한 자산의 평가손익이에요.</p>{review.assets.filter(a=>Number(a.buy_total)>0).map(a=><article key={a.asset}><div><b>{a.name}</b><strong><Profit value={a.total_pnl}/></strong></div><Row label="매도 실현손익"><Profit value={a.realized_pnl}/></Row><Row label="남은 보유분 평가손익"><Profit value={a.unrealized_pnl}/></Row><Row label="남은 보유 자산">{money(a.value)}</Row></article>)}{!review.assets.some(a=>Number(a.buy_total)>0)&&<p className="review-empty">코인 매매 없이 현금으로 운용했어요.</p>}<Row label="현금 (이자 정산 포함)">{money(game.cash)}</Row><details><summary>처음 계획과 마지막 비중</summary>{(['cash',...aliases] as const).map(a=><Row key={a} label={assetName(a)}>{review.initial_plan?.[a]??'—'}% → {(a==='cash'?game.cash/game.nav*100:game.holdings.find(h=>h.asset===a)?.weight??0).toFixed(1)}%</Row>)}</details></section>
    </div><div ref={detailAnchor} className="review-detail-anchor">{chosen?<DecisionDetail decision={chosen} index={review.decisions.indexOf(chosen)}/>:<section className="panel">선택 기록이 없어요. 종목별 결과에서 자산을 확인해 주세요.</section>}</div></div>
    <section className="panel review-recap"><div><span className="eyebrow">ERU AI REVIEW</span><h2>결과를 다음 판단의 기준으로</h2><p>AI가 서버에서 계산한 사실 중 복기할 기록과 질문을 골라줘요. 기록에 없는 투자 의도를 추측하지 않아요.</p></div>{!recap&&<button className="btn primary" disabled={recapBusy} onClick={()=>void summarize()}>{recapBusy?'기록을 읽는 중…':'ERU AI와 복기하기'}</button>}{recap&&<div className="review-recap-answer"><small>{recap.status}</small>{recap.paragraphs.map((p,i)=><p key={i}>{p}</p>)}<b>다음 투자 전에 생각해 보세요</b>{recap.questions.map(q=><p key={q}>↳ {q}</p>)}{recap.source!=='ai'&&<button className="btn secondary" disabled={recapBusy} onClick={()=>void summarize()}>{recapBusy?'연결 중…':'AI 연결 다시 시도'}</button>}</div>}{recapError&&<p role="alert">{recapError}</p>}</section>
    <section className="panel review-next"><div><h2>다시 한다면, 어떤 선택을 바꿔볼까요?</h2><p>이번 기록은 현재 브라우저에서 확인할 수 있어요. 새 게임을 시작하면 이전 게임 ID는 이전 세션 키에 보관해요.</p>{revealed?<div className="review-identities">{Object.entries(game.identities??{}).map(([a,n])=><span key={a}>{assetName(a)} → {n}</span>)}</div>:<button className="text-button" onClick={()=>setRevealed(true)}>실제 자산 이름 확인 →</button>}</div><button className="btn primary" disabled={busy} onClick={onRestart}>새 계획으로 다시 투자</button></section>
  </div>;
}
