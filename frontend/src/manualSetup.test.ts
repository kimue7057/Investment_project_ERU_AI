import {describe,it,expect} from 'vitest';
import {emptyManualPlan,selectProfile,changeCash,toggleCoin,changeShare,shareEqually,moveManualPhase,manualAllocation,chooseRule,canChooseRule,manualContext,manualReady,restoreManualPlan} from './manualSetup';
import type {Discussion} from './model';
const plan=()=>{
 let s=moveManualPhase(selectProfile(emptyManualPlan(),'balanced'),'assets');
 s=toggleCoin(toggleCoin(s,'A'),'B');s=changeShare(changeShare(s,'A','60'),'B','40');return s;
};
const proposal=(s:ReturnType<typeof plan>,id='r'):Discussion=>({id,at:'',question:'',paragraphs:[],source:'ai',status:'',weights:null,phase:'rules',risk_rules:[{metric:'asset_loss',asset:'held',threshold:8,enabled:true}],setup_basis:{profile:s.profile,cash:Number(s.cash),allocation:manualAllocation(s)}});
describe('직접 선택하고 마지막에만 AI 조건 상담',()=>{
 it('코인 체크·해제와 잘못된 비율은 숨은 배분 없이 막는다',()=>{
  let s=plan();expect(manualAllocation(s)).toEqual({cash:30,A:42,B:28,C:0,D:0});
  s=changeShare(s,'A','');expect(manualAllocation(s)).toBeNull();expect(moveManualPhase(s,'rules')).toBe(s);
  s=changeShare(s,'A','50');expect(manualAllocation(s)).toBeNull();
  s=toggleCoin(s,'B');expect(s.shares.B).toBe('0');expect(manualAllocation(s)).toBeNull();
  s=shareEqually(s);expect(manualAllocation(s)).toEqual({cash:30,A:70,B:0,C:0,D:0});
 });
 it('기타의 소수 비중과 현금 100%를 지원하고 빈 입력은 막는다',()=>{
  let s=selectProfile(emptyManualPlan(),'custom');s=changeCash(s,'33.33');s=shareEqually(toggleCoin(toggleCoin(toggleCoin(s,'A'),'B'),'C'));
  const w=manualAllocation(s)!;expect(Object.values(w).reduce((n,v)=>n+Math.round(v*100),0)).toBe(10000);
  s=changeCash(s,'');expect(manualAllocation(s)).toBeNull();
  s=changeCash(s,'100');expect(s.coins).toEqual([]);expect(manualAllocation(s)).toEqual({cash:100,A:0,B:0,C:0,D:0});
 });
 it('조건 선택만 승인 계획이 되며 구성 변경은 기존 조건과 오래된 제안을 해제한다',()=>{
  let s=moveManualPhase(plan(),'rules'),m=proposal(s);
  expect(manualReady(s)).toBe(false);s=chooseRule(s,m,'declined');expect(s.rules).toBeNull();
  s=chooseRule(s,{...m,id:'new'},'accepted');expect(manualReady(s)).toBe(true);expect(manualContext(s).allocation).toEqual(manualAllocation(s));
  s=changeShare(s,'A','50');s=changeShare(s,'B','50');expect(s.rules).toBeNull();expect(manualReady(s)).toBe(false);expect(canChooseRule(s,m)).toBe(false);
 });
 it('현재 배분과 조건을 복원하며 다른 단계의 AI 제안은 선택하지 않는다',()=>{
  const s=moveManualPhase(plan(),'rules');expect(restoreManualPlan(JSON.stringify(s))).toEqual(s);
  expect(canChooseRule(s,{...proposal(s),phase:'assets'})).toBe(false);
  expect(restoreManualPlan(JSON.stringify({...s,coins:['A','A']}))).toEqual(emptyManualPlan());
 });
});
