import {aliases,type Alias} from './model';
import {buildAllocation,equalShares,profiles,type Profile} from './setup';

export type ManualPhase='portfolio'|'assets';
export const setupPhases:ManualPhase[]=['portfolio','assets'];
export const setupLabels={portfolio:'포트폴리오 유형',assets:'코인과 비율'};
type ShareInputs=Record<Alias,string>;
export type ManualPlan={version:2;phase:ManualPhase;profile:Profile|null;cash:string;coins:Alias[];shares:ShareInputs};
const zeroInputs=():ShareInputs=>({A:'0',B:'0',C:'0',D:'0'});
export const emptyManualPlan=():ManualPlan=>({version:2,phase:'portfolio',profile:null,cash:'30',coins:[],shares:zeroInputs()});
const percent=(s:string)=>s.trim()!==''&&Number.isFinite(Number(s))&&Number(s)>=0&&Number(s)<=100&&Math.abs(Number(s)*100-Math.round(Number(s)*100))<1e-8;
export const profileReady=(s:ManualPlan)=>!!s.profile&&percent(s.cash);
export function manualAllocation(s:ManualPlan){
  if(!profileReady(s))return null;
  if(Number(s.cash)===100)return buildAllocation(100,{A:0,B:0,C:0,D:0});
  if(!s.coins.length||s.coins.some(a=>!percent(s.shares[a])||Number(s.shares[a])<=0))return null;
  const w=buildAllocation(Number(s.cash),Object.fromEntries(aliases.map(a=>[a,s.coins.includes(a)?Number(s.shares[a]):0])) as Record<Alias,number>);
  return w&&s.coins.every(a=>w[a]>0)?w:null;
}
export function selectProfile(s:ManualPlan,profile:Profile):ManualPlan{
  const p=profiles.find(p=>p.id===profile)!;
  return {...s,profile,cash:profile==='custom'&&s.profile?s.cash:String(p.cash)};
}
export function changeCash(s:ManualPlan,cash:string):ManualPlan{
  return s.profile!=='custom'?s:{...s,cash,...(Number(cash)===100?{coins:[],shares:zeroInputs()}: {})};
}
export function toggleCoin(s:ManualPlan,a:Alias):ManualPlan{
  if(!profileReady(s)||Number(s.cash)===100)return s;
  const removing=s.coins.includes(a),coins=removing?s.coins.filter(c=>c!==a):[...s.coins,a];
  return {...s,coins,shares:{...s.shares,[a]:removing?'0':s.coins.length?'0':'100'}};
}
export function changeShare(s:ManualPlan,a:Alias,value:string):ManualPlan{
  return s.coins.includes(a)?{...s,shares:{...s.shares,[a]:value}}:s;
}
export function shareEqually(s:ManualPlan):ManualPlan{
  return !s.coins.length?s:{...s,shares:Object.fromEntries(Object.entries(equalShares(s.coins)).map(([a,n])=>[a,String(n)])) as ShareInputs};
}
export function moveManualPhase(s:ManualPlan,phase:ManualPhase):ManualPlan{
  return phase==='assets'&&!profileReady(s)?s:{...s,phase};
}
export function restoreManualPlan(raw:string|null):ManualPlan{
  try{
    const s=JSON.parse(raw||'null');
    if(!s||![1,2].includes(s.version)||!['portfolio','assets','rules'].includes(s.phase)||s.profile!==null&&!profiles.some(p=>p.id===s.profile)||typeof s.cash!=='string'||
      !Array.isArray(s.coins)||s.coins.length>4||new Set(s.coins).size!==s.coins.length||s.coins.some((a:string)=>!aliases.includes(a as Alias))||
      !s.shares||Object.keys(s.shares).sort().join(',')!=='A,B,C,D'||Object.values(s.shares).some(v=>typeof v!=='string'))return emptyManualPlan();
    // 이전 조건 상담 화면의 코인·비율도 유지하며 복원한다.
    const restored:ManualPlan={version:2,phase:s.phase==='rules'?'assets':s.phase,profile:s.profile,cash:s.cash,coins:s.coins,shares:s.shares};
    return profileReady(restored)?restored:{...restored,phase:'portfolio'};
  }catch{return emptyManualPlan();}
}
