import { useEffect, useRef, useState } from 'react';
import { assetName, type Alias, type Allocation, type Discussion, type RiskRule, type SetupPreference } from './model';
import {RiskSummary} from './RiskRules';

export default function Mentor({messages, busy, selected, onSelect, onAsk, onApply, onApplyRisk, onApplyPreference, setupStage=0, conversation=false, setup = false}: {
  onApplyRisk?:(rules:RiskRule[])=>void; onApplyPreference?:(p:SetupPreference)=>void; setupStage?:number; conversation?:boolean;
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
    <div className="eyebrow">ERU AI</div><h2>{conversation?'우리의 투자 상담':'AI와 이야기하기'}</h2>
    <p className="fine">{conversation?'평소 투자에 대한 생각을 편하게 들려주세요. 이야기를 이어가며 자금 배분과 리스크 조건을 하나의 계획으로 정리해요. 마지막 승인 전까지 거래는 시작되지 않아요.':setup?'지금 설정과 앞선 대화를 바탕으로 함께 정해요. 제안은 승인 전 초안이에요.':'이전 대화와 현재 포트폴리오를 바탕으로 논의해요. 질문 중에는 시장이 멈추고, 승인한 매매만 실행해요.'}</p>
    {setup && !conversation && <button className="btn secondary wide" disabled={busy} onClick={()=>void send(['처음부터 투자 성향을 함께 정하고 싶어. 내게 필요한 질문부터 하나씩 해줘.','지금까지의 상담과 내 성향을 바탕으로 현금과 투자 비중을 함께 정해줘.','현재 현금 비중과 선택한 종목을 바탕으로 코인의 특징과 위험을 비교하면서 투자 구성을 함께 정해줘.','현재 포트폴리오와 성향을 바탕으로 리스크 알림 조건을 함께 정하고 싶어. 지금 초안의 조건을 설명하고 내게 필요한 질문부터 해줘.','지금까지 함께 만든 구성과 리스크 조건을 정리하고 확인할 점을 알려줘.'][setupStage])}>AI와 이 단계 상담하기</button>}
    {!setup && <label className="mentor-select">함께 살펴볼 자산<select aria-label="논의할 자산" value={selected} onChange={e => onSelect(e.target.value as Alias)}>{['A','B','C','D'].map(a => <option key={a} value={a}>{assetName(a)}</option>)}</select></label>}
    <div className="chat-history" aria-live="polite">
      {!messages.length && <div className="mentor-welcome"><b>{conversation?'안녕하세요, ERU AI예요. 함께 계획을 만들어볼까요?':'어떤 투자 경험을 해보고 싶으세요?'}</b><p>{conversation?'1억 원으로 모의투자를 시작하기 전에, 어떤 마음으로 투자해보고 싶은지부터 듣고 싶어요. 경험이 없어도 괜찮아요. 가장 기대되거나 걱정되는 점은 무엇인가요?':'지금 보유한 자산과 고민을 이야기해 주세요. 현재 정보로 함께 판단해요.'}</p></div>}
      {messages.map(m => <article className="chat-entry" key={m.id}><div className="question">{m.question}</div><small className={m.source === 'ai' ? 'ai-status' : 'rules-status'}>{m.status}</small><div className="answer">{m.paragraphs.map((p,i) => <p key={i}>{p}</p>)}</div>{!conversation && m.setup_preference && <div className="risk-summary"><b>{({cautious:'안정형',balanced:'균형형',active:'공격형'})[m.setup_preference.profile]}</b><p>현금 {m.setup_preference.cash}% · 투자 {Number((100-m.setup_preference.cash).toFixed(2))}%</p>{onApplyPreference && <button className="btn secondary" disabled={busy} onClick={()=>onApplyPreference(m.setup_preference!)}>이 성향·자금 배분을 초안에 담기</button>}</div>}{!conversation && m.weights && <><div className="suggested-weights">{Object.entries(m.weights).map(([a,w]) => <span key={a}>{a === 'cash' ? '현금' : assetName(a)} <b>{w}%</b></span>)}</div><button className="btn secondary" disabled={busy} onClick={() => onApply(m.weights!)}>이 구성을 초안에 담기</button><small>초안에 담아도 주문되지 않아요</small></>}{!conversation && m.risk_rules && <><h3>제안한 리스크 조건</h3><RiskSummary rules={m.risk_rules}/>{onApplyRisk && <button className="btn secondary" disabled={busy} onClick={()=>onApplyRisk(m.risk_rules!)}>이 알림 조건을 초안에 담기</button>}<small>최종 승인 전에는 적용되지 않아요</small></>}{conversation&&m.source==='ai'&&(m.weights||m.setup_preference||m.risk_rules)&&<small className="consultation-update">상담 계획에 제안을 정리했어요 · 최종 승인 전</small>}</article>)}
      {busy && <p role="status">현재 시점의 정보로 논의하고 있어요…</p>}
      <div ref={latest}/>
    </div>
    <div className="question-chips">{(conversation ? messages.length ? ['지금까지 이야기한 계획을 정리해줘', '조금 더 안정적으로 바꿔보면 어떨까?', '어떤 상황에서 다시 판단하면 좋을까?'] : ['투자가 처음이라 손실이 걱정돼요', '수익 기회와 안정성을 함께 생각하고 싶어요', '변동을 감수하고 적극적으로 투자해보고 싶어요'] : setup ? setupStage>=3 ? ['지금 구성에 맞는 리스크 알림 조건 추천해줘', '새벽코인은 매수원가보다 8% 하락하면 알려줘', '전체 자산 손실과 종목 손실은 어떻게 달라?', '알림이 오면 자동으로 매도되는 거야?'] : ['안정형과 공격형의 차이는?', '현금 이자는 어떻게 쌓여?', '균형형 구성 추천해줘', '투자금을 나누는 이유는?'] : ['이 코인의 특징과 위험은?', '현금의 이자는?', '안정형 구성 추천해줘', '지금 구성을 유지하면?']).map(q => <button disabled={busy} key={q} onClick={() => void send(q)}>{q}</button>)}</div>
    <form onSubmit={e => {e.preventDefault(); void send(question);}} className="chat-form"><label className="sr-only" htmlFor="mentor-question">AI에게 질문</label><textarea id="mentor-question" maxLength={600} rows={2} placeholder="ERU AI에게 생각이나 궁금한 점을 이야기해 주세요" value={question} disabled={busy} onChange={e => setQuestion(e.target.value)}/><button className="btn primary" disabled={busy || !question.trim()} type="submit">{conversation?'보내기':'질문하기'}</button></form>
  </section>;
}
