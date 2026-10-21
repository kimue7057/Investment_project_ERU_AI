import {describe,it,expect} from 'vitest';
import {emptyManualPlan,selectProfile,changeCash,toggleCoin,changeShare,shareEqually,moveManualPhase,manualAllocation,restoreManualPlan,setupPhases} from './manualSetup';
const plan=()=>{
 let s=moveManualPhase(selectProfile(emptyManualPlan(),'balanced'),'assets');
 s=toggleCoin(toggleCoin(s,'A'),'B');s=changeShare(changeShare(s,'A','60'),'B','40');return s;
};
describe('성향·코인 직접 선택 후 기본 가드로 시작',()=>{
 it('코인 체크·해제와 잘못된 비율은 숨은 배분 없이 막는다',()=>{
  let s=plan();expect(manualAllocation(s)).toEqual({cash:30,A:42,B:28,C:0,D:0});
  s=changeShare(s,'A','');expect(manualAllocation(s)).toBeNull();
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
 it('이전 조건 상담 초안에서 코인 배분만 복원하며 조건 단계는 제거한다',()=>{
  const s=plan(),legacy={...s,version:1,phase:'rules',rules:[{metric:'asset_loss',asset:'held',threshold:8,enabled:true}],ruleId:'old',choices:{old:'accepted'}};
  expect(restoreManualPlan(JSON.stringify(legacy))).toEqual(s);
  expect(setupPhases).toEqual(['portfolio','assets']);
  expect('rules' in restoreManualPlan(JSON.stringify(legacy))).toBe(false);
 });
 it('현재 배분을 복원하고 손상된 종목 선택은 초기화한다',()=>{
  const s=plan();expect(restoreManualPlan(JSON.stringify(s))).toEqual(s);
  expect(restoreManualPlan(JSON.stringify({...s,coins:['A','A']}))).toEqual(emptyManualPlan());
  expect(moveManualPhase(emptyManualPlan(),'assets').phase).toBe('portfolio');
 });
});
