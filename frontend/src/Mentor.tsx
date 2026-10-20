import { useEffect, useRef, useState } from 'react';
import { type Alias, type Allocation, type Discussion } from './model';

export default function Mentor({messages, busy, selected, onSelect, onAsk, onApply, setup = false}: {
  setup?: boolean; messages: Discussion[]; busy: boolean; selected: Alias; onSelect: (a: Alias) => void;
  onAsk: (q: string) => Promise<void>; onApply: (w: Allocation) => void;
}) {
  const [question, setQuestion] = useState('');
  const latest = useRef<HTMLDivElement>(null);
  useEffect(()=>{if (messages.length) latest.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[messages.length,busy]);
  async function send(q: string) {
    if (!q.trim() || busy) return;
    setQuestion(''); await onAsk(q);
  }
  return <section className="panel mentor-panel" aria-label="AI와 투자 논의">
    <div className="eyebrow">함께 판단하는 투자</div><h2>AI와 이야기하기</h2>
    <p className="fine">{setup ? '지금 고른 성향과 비중을 바탕으로 함께 정해요. 이유를 물어보거나 원하는 변경을 말해보세요.' : '이전 대화와 현재 포트폴리오를 바탕으로 논의해요. 질문 중에는 시장이 멈춰요.'} 제안은 초안에 담고 승인해야 반영돼요.</p>
    {!setup && <label className="mentor-select">함께 살펴볼 자산<select aria-label="논의할 자산" value={selected} onChange={e => onSelect(e.target.value as Alias)}>{['A','B','C','D'].map(a => <option key={a} value={a}>코인 {a}</option>)}</select></label>}
    <div className="chat-history" aria-live="polite">
      {!messages.length && <div className="mentor-welcome"><b>어떤 구성으로 시작하고 싶으세요?</b><p>각 코인의 특징부터, 현금의 역할과 투자 비중까지 함께 살펴봐요.</p></div>}
      {messages.map(m => <article className="chat-entry" key={m.id}><div className="question">{m.question}</div><small className={m.source === 'ai' ? 'ai-status' : 'rules-status'}>{m.status}</small><div className="answer">{m.paragraphs.map((p,i) => <p key={i}>{p}</p>)}</div>{m.weights && <><div className="suggested-weights">{Object.entries(m.weights).map(([a,w]) => <span key={a}>{a === 'cash' ? '현금' : '코인 ' + a} <b>{w}%</b></span>)}</div><button className="btn secondary" disabled={busy} onClick={() => onApply(m.weights!)}>이 구성을 초안에 담기</button><small>초안에 담아도 주문되지 않아요</small></>}</article>)}
      {busy && <p role="status">현재 시점의 정보로 논의하고 있어요…</p>}
      <div ref={latest}/>
    </div>
    <div className="question-chips">{(setup ? ['안정형과 공격형의 차이는?', '현금 이자는 어떻게 쌓여?', '균형형 구성 추천해줘', '투자금을 나누는 이유는?'] : ['이 코인의 특징과 위험은?', '현금의 이자는?', '안정형 구성 추천해줘', '지금 구성을 유지하면?']).map(q => <button disabled={busy} key={q} onClick={() => void send(q)}>{q}</button>)}</div>
    <form onSubmit={e => {e.preventDefault(); void send(question);}} className="chat-form"><label className="sr-only" htmlFor="mentor-question">AI에게 질문</label><textarea id="mentor-question" maxLength={600} rows={2} placeholder="궁금한 점이나 원하는 투자 비중을 알려주세요" value={question} disabled={busy} onChange={e => setQuestion(e.target.value)}/><button className="btn primary" disabled={busy || !question.trim()} type="submit">질문하기</button></form>
  </section>;
}
