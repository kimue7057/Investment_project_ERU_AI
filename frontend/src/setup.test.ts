import {describe,it,expect} from 'vitest';
import {buildAllocation,equalShares,sharesFromAllocation,profiles} from './setup';
import {validWeights} from './model';

describe('성향 → 자산군 → 종목의 두 단계 배분',()=>{
  it('투자금 안의 비중을 전체 비중으로 환산하고 0.01% 반올림 후 합계를 보존한다',()=>{
    expect(buildAllocation(30,{A:60,B:40,C:0,D:0})).toEqual({cash:30,A:42,B:28,C:0,D:0});
    for (const p of profiles) for (const selected of [['A'],['A','B','C'],['A','B','C','D']] as const) {
      const w=buildAllocation(p.cash,equalShares([...selected]));
      expect(w && validWeights(w)).toBe(true);
      expect(Object.values(w!).reduce((s,v)=>s+Math.round(v*100),0)).toBe(10000);
    }
  });
  it('미선택·잘못된 내부 비중은 시작할 수 없고, 현금 100%는 종목 없이 시작한다',()=>{
    expect(buildAllocation(30,{A:0,B:0,C:0,D:0})).toBeNull();
    expect(buildAllocation(30,{A:60,B:60,C:0,D:0})).toBeNull();
    expect(buildAllocation(30,{A:NaN,B:0,C:0,D:0})).toBeNull();
    expect(buildAllocation(100,{A:50,B:50,C:0,D:0})).toEqual({cash:100,A:0,B:0,C:0,D:0});
  });
  it('선택 해제한 종목은 금액이 남지 않고 제안한 구성도 합계 100으로 복원한다',()=>{
    expect(equalShares(['B'])).toEqual({A:0,B:100,C:0,D:0});
    const proposed={cash:30,A:30,B:20,C:15,D:5};
    const w=buildAllocation(proposed.cash,sharesFromAllocation(proposed));
    expect(w && validWeights(w)).toBe(true);
    for (const a of ['A','B','C','D'] as const) expect(Math.abs(w![a]-proposed[a])).toBeLessThanOrEqual(.01);
  });
});
