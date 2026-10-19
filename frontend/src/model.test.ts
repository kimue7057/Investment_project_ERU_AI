import {describe,it,expect} from 'vitest';
import {validWeights,initialWeights,clock,money} from './model';
describe('사용자 입력과 표시',()=>{
  it('합계 및 비정상 숫자를 검증한다',()=>{
    expect(validWeights(initialWeights)).toBe(true);
    expect(validWeights({...initialWeights,A:31})).toBe(false);
    expect(validWeights({...initialWeights,A:NaN})).toBe(false);
    expect(validWeights({...initialWeights,cash:-1,A:51})).toBe(false);
  });
  it('재생 남은 시간과 원화 표시를 정확히 처리한다',()=>{
    expect(clock(300)).toBe('05:00');expect(clock(60.01)).toBe('01:01');expect(clock(0)).toBe('00:00');
    expect(money(100000000)).toBe('₩100,000,000');
  });
});
