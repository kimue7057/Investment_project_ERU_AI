import {describe,it,expect} from 'vitest';
import {krwPerSgd,parseAmount,inputAmount,amountLimits,presets,formatMoney} from './currency';
describe('통화 전환과 원금 보존',()=>{
 it('SGD 센트를 원화 소수 둘째 자리로 환산한다',()=>{expect(parseAmount('100,000.00','en')).toBe(103807249.23);expect(parseAmount('10000.01','en')).toBe(10380735.30);expect(parseAmount('100000000','ko')).toBe(100000000);});
 it('환산된 입력창을 그대로 제출해도 기존 원금이 바뀌지 않는다',()=>{for(const n of [10000,100000000,103807249.23,10000000000])expect(parseAmount(inputAmount(n,'en'),'en',n)).toBe(n);});
 it('통화별 정밀도와 금액 범위를 검증한다',()=>{for(const raw of ['1e5','Infinity','-1','100.001','bad'])expect(parseAmount(raw,'en')).toBeNull();expect(parseAmount('100.50','ko')).toBeNull();const [min,max]=amountLimits('en');expect(parseAmount(min.toFixed(2),'en')).toBeGreaterThanOrEqual(10000);expect(parseAmount(max.toFixed(2),'en')).toBeLessThanOrEqual(10000000000);expect(parseAmount((min-.01).toFixed(2),'en')).toBeLessThan(10000);expect(parseAmount((max+.01).toFixed(2),'en')).toBeGreaterThan(10000000000);});
 it('비교·거래·수수료에 같은 환산을 적용하고 부호를 보존한다',()=>{const value=103807249.23;expect(formatMoney(value,'en')).toBe('S$100K');expect(formatMoney(-value,'en')).toBe('−S$100K');expect(formatMoney(krwPerSgd/100,'en')).toBe('S$0.01');expect(formatMoney(100000000,'ko')).toBe('1억 원');expect(presets('en').map(n=>inputAmount(n,'en'))).toEqual(['10,000.00','50,000.00','100,000.00']);});
});
