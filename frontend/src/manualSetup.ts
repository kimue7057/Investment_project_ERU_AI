import {aliases, type Alias, type Discussion, type RiskRule, type SetupContext, type SetupPhase} from './model';
import {buildAllocation, equalShares, profiles, type Profile} from './setup';
import {validRules} from './RiskRules';

export const setupPhases:SetupPhase[]=['portfolio','assets','rules'];
export const setupLabels={portfolio:'포트폴리오 유형',assets:'코인과 비율',rules:'매매 조건 상담'};
type ShareInputs=Record<Alias,string>;
export type ManualPlan={version:1;phase:SetupPhase;profile:Profile|null;cash:string;coins:Alias[];shares:ShareInputs;rules:RiskRule[]|null;ruleId:string|null;choices:Record<string,'accepted'|'declined'>};
const zeroInputs=():ShareInputs=>({A:'0',B:'0',C:'0',D:'0'});
export const emptyManualPlan=():ManualPlan=>({version:1,phase:'portfolio',profile:null,cash:'30',coins:[],shares:zeroInputs(),rules:null,ruleId:null,choices:{}});
const percent=(s:string)=>s.trim()!==''&&Number.isFinite(Number(s))&&Number(s)>=0&&Number(s)<=100&&Math.abs(Number(s)*100-Math.round(Number(s)*100))<1e-8;
export const profileReady=(s:ManualPlan)=>!!s.profile&&percent(s.cash);
export function manualAllocation(s:ManualPlan){
  if(!profileReady(s))return null;
  if(Number(s.cash)===100)return buildAllocation(100,{A:0,B:0,C:0,D:0});
  if(!s.coins.length||s.coins.some(a=>!percent(s.shares[a])||Number(s.shares[a])<=0))return null;
  const w=buildAllocation(Number(s.cash),Object.fromEntries(aliases.map(a=>[a,s.coins.includes(a)?Number(s.shares[a]):0])) as Record<Alias,number>);
  return w&&s.coins.every(a=>w[a]>0)?w:null;
}
function clearRules(s:ManualPlan):ManualPlan{return {...s,rules:null,ruleId:null};}
export function selectProfile(s:ManualPlan,profile:Profile):ManualPlan{
  const p=profiles.find(p=>p.id===profile)!;
  const cash=profile==='custom'&&s.profile?s.cash:String(p.cash);
  if(s.profile===profile&&s.cash===cash)return s;
  return clearRules({...s,profile,cash});
}
export function changeCash(s:ManualPlan,cash:string):ManualPlan{
  if(s.profile!=='custom'||s.cash===cash)return s;
  return clearRules({...s,cash,...(Number(cash)===100?{coins:[],shares:zeroInputs()}: {})});
}
export function toggleCoin(s:ManualPlan,a:Alias):ManualPlan{
  if(!profileReady(s)||Number(s.cash)===100)return s;
  const removing=s.coins.includes(a),coins=removing?s.coins.filter(c=>c!==a):[...s.coins,a];
  return clearRules({...s,coins,shares:{...s.shares,[a]:removing?'0':s.coins.length?'0':'100'}});
}
export function changeShare(s:ManualPlan,a:Alias,value:string):ManualPlan{
  return s.coins.includes(a)&&s.shares[a]!==value?clearRules({...s,shares:{...s.shares,[a]:value}}):s;
}
export function shareEqually(s:ManualPlan):ManualPlan{
  if(!s.coins.length)return s;
  const shares=Object.fromEntries(Object.entries(equalShares(s.coins)).map(([a,n])=>[a,String(n)])) as ShareInputs;
  return aliases.every(a=>s.shares[a]===shares[a])?s:clearRules({...s,shares});
}
export function moveManualPhase(s:ManualPlan,phase:SetupPhase):ManualPlan{
  if(phase!=='portfolio'&&!profileReady(s)||phase==='rules'&&!manualAllocation(s))return s;
  return {...s,phase};
}
export function canChooseRule(s:ManualPlan,m:Discussion){
  const w=manualAllocation(s),b=m.setup_basis;
  return s.phase==='rules'&&!!w&&m.phase==='rules'&&m.source==='ai'&&validRules(m.risk_rules)&&!!b&&b.profile===s.profile&&b.cash===Number(s.cash)&&!!b.allocation&&(['cash',...aliases] as const).every(a=>b.allocation![a]===w[a]);
}
export function chooseRule(s:ManualPlan,m:Discussion,choice:'accepted'|'declined'):ManualPlan{
  if(!canChooseRule(s,m))return s;
  return {...s,choices:{...s.choices,[m.id]:choice},...(choice==='accepted'?{rules:m.risk_rules!.map(r=>({...r})),ruleId:m.id}:{})};
}
export const manualReady=(s:ManualPlan)=>!!manualAllocation(s)&&!!s.ruleId&&s.rules!==null&&validRules(s.rules);
export function manualContext(s:ManualPlan):SetupContext{
  const allocation=manualAllocation(s);
  return {mode:'conversation',phase:'rules',profile:s.profile,cash:Number(s.cash),step:3,selected:allocation?aliases.filter(a=>allocation[a]>0):[],shares:Object.fromEntries(aliases.map(a=>[a,s.coins.includes(a)?Number(s.shares[a]):0])) as Record<Alias,number>,allocation,risk_rules:s.rules,proposal_choices:Object.fromEntries(Object.entries(s.choices).map(([id,c])=>[id,c==='accepted'&&id!==s.ruleId?'superseded':c]))};
}
export function restoreManualPlan(raw:string|null):ManualPlan{
  try{
    const s=JSON.parse(raw||'null');
    if(!s||s.version!==1||!setupPhases.includes(s.phase)||s.profile!==null&&!profiles.some(p=>p.id===s.profile)||typeof s.cash!=='string'||
      !Array.isArray(s.coins)||s.coins.length>4||new Set(s.coins).size!==s.coins.length||s.coins.some((a:string)=>!aliases.includes(a as Alias))||
      !s.shares||Object.keys(s.shares).sort().join(',')!=='A,B,C,D'||Object.values(s.shares).some(v=>typeof v!=='string')||
      s.rules!==null&&!validRules(s.rules)||s.ruleId!==null&&typeof s.ruleId!=='string'||!s.choices||Object.keys(s.choices).length>40||Object.values(s.choices).some(v=>v!=='accepted'&&v!=='declined')||
      (s.rules===null)!==(s.ruleId===null)||s.ruleId&&s.choices[s.ruleId]!=='accepted')return emptyManualPlan();
    let restored=s as ManualPlan;
    if(!manualAllocation(restored))restored=clearRules({...restored,phase:profileReady(restored)?restored.phase==='rules'?'assets':restored.phase:'portfolio'});
    return restored;
  }catch{return emptyManualPlan();}
}
