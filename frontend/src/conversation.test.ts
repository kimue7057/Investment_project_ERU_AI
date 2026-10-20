import {describe,it,expect} from 'vitest';
import {absorbReplies,emptyConsultation,consultationContext,consultationReady,restoreConsultation} from './conversation';
import type {Discussion} from './model';

const reply=(id:string,patch:Partial<Discussion>={}):Discussion=>({id,at:'',question:'',paragraphs:['함께 정해요'],source:'ai',status:'',weights:null,...patch});
const allocation={cash:30,A:42,B:28,C:0,D:0};
const rules=[{metric:'portfolio_loss' as const,asset:'portfolio' as const,threshold:10,enabled:true}];
describe('한 대화에서 만드는 미승인 상담 계획',()=>{
  it('새 상담은 성향·자산·조건을 미리 확정하지 않고 세 내용을 한 응답으로 정리할 수 있다',()=>{
    const start=emptyConsultation();expect(consultationReady(start)).toBe(false);expect(consultationContext(start).risk_rules).toBeNull();
    const s=absorbReplies(start,[reply('1',{weights:allocation,setup_preference:{profile:'balanced',cash:30},risk_rules:rules})]);
    expect(consultationReady(s)).toBe(true);expect(s.allocation).toEqual(allocation);expect(s.rules).toEqual(rules);
    expect(consultationContext(s).allocation).toEqual(allocation);expect(restoreConsultation(JSON.stringify(s))).toEqual(s);
  });
  it('질문·비교와 연결 실패 안내는 계획으로 오인하지 않고 조건만 수정하면 구성을 보존한다',()=>{
    let s=absorbReplies(emptyConsultation(),[reply('1',{weights:allocation,setup_preference:{profile:'balanced',cash:30},risk_rules:rules})]);
    s=absorbReplies(s,[reply('2'),reply('3',{source:'rules',weights:{cash:10,A:90,B:0,C:0,D:0}}),reply('4',{risk_rules:[{...rules[0],threshold:8}]})]);
    expect(s.allocation).toEqual(allocation);expect(s.rules?.[0].threshold).toBe(8);
    expect(absorbReplies(s,[reply('1',{weights:{cash:100,A:0,B:0,C:0,D:0}})])).toBe(s);
  });
  it('현금 비중 대화 수정은 기존 종목 비율과 합계 100을 보존하고 전액 현금에서 투자로 돌아오면 다시 구성한다',()=>{
    let s=absorbReplies(emptyConsultation(),[reply('1',{weights:allocation})]);
    s=absorbReplies(s,[reply('2',{setup_preference:{profile:'cautious',cash:60}})]);
    expect(s.allocation).toEqual({cash:60,A:24,B:16,C:0,D:0});
    s=absorbReplies(s,[reply('3',{setup_preference:{profile:'cautious',cash:100}})]);
    expect(s.allocation).toEqual({cash:100,A:0,B:0,C:0,D:0});
    s=absorbReplies(s,[reply('4',{setup_preference:{profile:'balanced',cash:30}})]);
    expect(s.allocation).toBeNull();expect(consultationReady(s)).toBe(false);
  });
  it('조건 미논의와 명시적으로 알림을 끈 계획을 구분한다',()=>{
    const s=absorbReplies(emptyConsultation(),[reply('1',{setup_preference:{profile:'cautious',cash:100}})]);
    expect(consultationReady(s)).toBe(false);
    expect(consultationReady(absorbReplies(s,[reply('2',{risk_rules:[]})]))).toBe(true);
  });
});
