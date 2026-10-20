import {aliases, validWeights, type Allocation, type Discussion, type SetupContext, type SetupPreference, type RiskRule} from './model';
import {emptyShares, sharesFromAllocation} from './setup';
import {validRules} from './RiskRules';

export type Consultation = {profile:SetupPreference['profile']|null; cash:number; allocation:Allocation|null; rules:RiskRule[]|null; processed:string[]};
export const emptyConsultation = ():Consultation => ({profile:null,cash:30,allocation:null,rules:null,processed:[]});
export function restoreConsultation(raw:string|null):Consultation {
  try {
    const s=JSON.parse(raw||'null');
    if(s && (s.profile===null||['cautious','balanced','active'].includes(s.profile)) && Number.isFinite(s.cash) && s.cash>=0 && s.cash<=100 &&
       (s.allocation===null||validWeights(s.allocation)&&s.allocation.cash===s.cash) && (s.rules===null||validRules(s.rules)) &&
       Array.isArray(s.processed)&&s.processed.length<=40&&s.processed.every((id:unknown)=>typeof id==='string'))return s;
  }catch{/* 새 상담부터 복원 */}
  return emptyConsultation();
}
export function absorbReplies(state:Consultation,messages:Discussion[]):Consultation {
  let s=state;
  for(const m of messages){
    if(s.processed.includes(m.id))continue;
    s={...s,processed:[...s.processed,m.id].slice(-40)};
    // 연결 실패의 고정 안내를 사용자와 논의한 계획처럼 적용하지 않는다.
    if(m.source!=='ai')continue;
    if(m.setup_preference){
      const p=m.setup_preference;
      s={...s,profile:p.profile,cash:p.cash,allocation:s.allocation?{...s.allocation,cash:p.cash,...Object.fromEntries(aliases.map(a=>[a,(100-s.cash)>0?s.allocation![a]*(100-p.cash)/(100-s.cash):0]))} as Allocation:null};
      // 기존 종목 비율을 보존하면서 전체 자금 비중을 0.01% 단위로 환산한다.
      if(s.allocation){
        const values=aliases.map(a=>({a,exact:s.allocation![a]*100,units:Math.floor(s.allocation![a]*100)}));
        const rest=10000-Math.round(p.cash*100)-values.reduce((n,v)=>n+v.units,0);
        if(rest>=0&&rest<=4){for(const v of [...values].sort((a,b)=>(b.exact-b.units)-(a.exact-a.units)).slice(0,rest))v.units++;
          s={...s,allocation:{cash:p.cash,...Object.fromEntries(values.map(v=>[v.a,v.units/100]))} as Allocation};
        }else s={...s,allocation:null};
      }
      if(p.cash===100)s={...s,allocation:{cash:100,...emptyShares()}};
    }
    if(m.weights&&validWeights(m.weights))s={...s,allocation:{...m.weights},cash:m.weights.cash};
    if(m.risk_rules!==undefined&&validRules(m.risk_rules))s={...s,rules:m.risk_rules.map(r=>({...r}))};
  }
  return s;
}
export function consultationContext(s:Consultation):SetupContext {
  return {mode:'conversation',profile:s.profile,cash:s.cash,allocation:s.allocation,
    step:!s.profile?0:!s.allocation?2:s.rules===null?3:4,
    selected:s.allocation?aliases.filter(a=>s.allocation![a]>0):[],shares:s.allocation?sharesFromAllocation(s.allocation):emptyShares(),risk_rules:s.rules};
}
export function consultationReady(s:Consultation){return !!s.profile&&!!s.allocation&&validWeights(s.allocation)&&s.rules!==null&&validRules(s.rules);}
