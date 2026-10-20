import {aliases,validWeights,type Allocation,type Discussion,type SetupContext,type SetupPreference,type SetupPhase,type RiskRule} from './model';
import {emptyShares,sharesFromAllocation} from './setup';
import {validRules} from './RiskRules';
export const phases:SetupPhase[]=['portfolio','assets','rules'];
export const phaseNames:Record<SetupPhase,string>={portfolio:'포트폴리오 방향',assets:'투자 자산',rules:'리스크 조건'};
export type Consultation={phase:SetupPhase;profile:SetupPreference['profile']|null;cash:number;allocation:Allocation|null;rules:RiskRule[]|null;choices:Record<string,'accepted'|'declined'>;selected:Partial<Record<SetupPhase,string>>};
export const emptyConsultation=():Consultation=>({phase:'portfolio',profile:null,cash:30,allocation:null,rules:null,choices:{},selected:{}});
export function restoreConsultation(raw:string|null):Consultation{
  try{const s=JSON.parse(raw||'null');
    if(s&&phases.includes(s.phase)&&(s.profile===null||['cautious','balanced','active'].includes(s.profile))&&Number.isFinite(s.cash)&&s.cash>=0&&s.cash<=100&&
      (s.allocation===null||validWeights(s.allocation)&&s.allocation.cash===s.cash)&&(s.rules===null||validRules(s.rules))&&s.choices&&Object.keys(s.choices).length<=40&&Object.values(s.choices).every(c=>c==='accepted'||c==='declined')&&s.selected&&
      Object.entries(s.selected).every(([phase,id])=>phases.includes(phase as SetupPhase)&&typeof id==='string'&&s.choices[id]==='accepted')&&
      (!!s.profile===!!s.selected.portfolio)&&(!!s.allocation===!!s.selected.assets)&&((s.rules!==null)===!!s.selected.rules)&&
      (!s.selected.assets||s.selected.portfolio)&&(!s.selected.rules||s.selected.assets)&&
      (s.phase==='portfolio'||s.selected.portfolio)&&(s.phase!=='rules'||s.selected.assets))return s;
  }catch{/* 저장된 선택이 유효하지 않으면 첫 상담부터 */}return emptyConsultation();
}
const sameAllocation=(a:Allocation|null,b:Allocation|null)=>a===b||!!a&&!!b&&(['cash',...aliases] as const).every(k=>a[k]===b[k]);
export function hasProposal(m:Discussion,phase:SetupPhase){return m.source==='ai'&&m.phase===phase&&(phase==='portfolio'?!!m.setup_preference:phase==='assets'?!!m.weights:m.risk_rules!==undefined);}
export function canChoose(s:Consultation,m:Discussion){
  if(!hasProposal(m,s.phase))return false;
  if(s.phase==='portfolio')return !!m.setup_preference;
  const b=m.setup_basis;
  if(!b||b.profile!==s.profile||b.cash!==s.cash)return false;
  if(s.phase==='assets')return !!m.weights&&validWeights(m.weights)&&m.weights.cash===s.cash;
  return sameAllocation(b.allocation,s.allocation)&&validRules(m.risk_rules);
}
export function chooseProposal(s:Consultation,m:Discussion,choice:'accepted'|'declined'):Consultation{
  if(!canChoose(s,m))return s;
  let next={...s,choices:{...s.choices,[m.id]:choice}};
  if(choice==='declined')return next;
  if(s.phase==='portfolio'&&m.setup_preference){
    const p=m.setup_preference,changed=s.profile!==p.profile||s.cash!==p.cash;
    next={...next,profile:p.profile,cash:p.cash,selected:changed?{portfolio:m.id}:{...s.selected,portfolio:m.id},allocation:changed?null:s.allocation,rules:changed?null:s.rules};
  }else if(s.phase==='assets'&&m.weights){
    const changed=!sameAllocation(s.allocation,m.weights);
    next={...next,allocation:{...m.weights},rules:changed?null:s.rules,selected:changed?{portfolio:s.selected.portfolio,assets:m.id}:{...s.selected,assets:m.id}};
  }else if(s.phase==='rules'&&m.risk_rules){next={...next,rules:m.risk_rules.map(r=>({...r})),selected:{...s.selected,rules:m.id}};}
  return next;
}
export function phaseReady(s:Consultation){return s.phase==='portfolio'?!!s.profile&&!!s.selected.portfolio:s.phase==='assets'?!!s.allocation&&!!s.selected.assets:s.rules!==null&&!!s.selected.rules;}
export function movePhase(s:Consultation,phase:SetupPhase):Consultation{
  if(phase==='assets'&&!s.selected.portfolio||phase==='rules'&&!s.selected.assets)return s;
  return {...s,phase};
}
export function consultationContext(s:Consultation):SetupContext{return {mode:'conversation',phase:s.phase,proposal_choices:Object.fromEntries(Object.entries(s.choices).map(([id,c])=>[id,c==='accepted'&&!Object.values(s.selected).includes(id)?'superseded':c])),profile:s.profile,cash:s.cash,allocation:s.allocation,step:s.phase==='portfolio'?0:s.phase==='assets'?2:3,selected:s.allocation?aliases.filter(a=>s.allocation![a]>0):[],shares:s.allocation?sharesFromAllocation(s.allocation):emptyShares(),risk_rules:s.rules};}
export function consultationReady(s:Consultation){return !!s.selected.portfolio&&!!s.selected.assets&&!!s.selected.rules&&!!s.profile&&!!s.allocation&&validWeights(s.allocation)&&s.rules!==null&&validRules(s.rules);}
