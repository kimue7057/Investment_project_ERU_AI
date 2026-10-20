import {describe,it,expect} from 'vitest';
import {emptyConsultation,chooseProposal,movePhase,phaseReady,consultationContext,consultationReady,restoreConsultation,canChoose} from './conversation';
import type {Discussion} from './model';
const reply=(id:string,patch:Partial<Discussion>={}):Discussion=>({id,at:'',question:'',paragraphs:[],source:'ai',status:'',weights:null,...patch});
const portfolio=reply('p',{phase:'portfolio',setup_preference:{profile:'balanced',cash:30}});
const allocation={cash:30,A:42,B:28,C:0,D:0};
const asset=reply('a',{phase:'assets',weights:allocation,setup_basis:{profile:'balanced',cash:30,allocation:null}});
const rules=reply('r',{phase:'rules',risk_rules:[{metric:'asset_loss',asset:'held',threshold:10,enabled:true}],setup_basis:{profile:'balanced',cash:30,allocation}});
describe('사용자가 선택하며 진행하는 세 AI 상담 페이지',()=>{
 it('제안을 받거나 거절하기만 하면 계획은 바뀌지 않고 다음 페이지에 갈 수 없다',()=>{
  const start=emptyConsultation();expect(phaseReady(start)).toBe(false);expect(movePhase(start,'assets')).toBe(start);
  const s=chooseProposal(start,portfolio,'declined');expect(s.profile).toBeNull();expect(s.choices.p).toBe('declined');expect(phaseReady(s)).toBe(false);
 });
 it('각 페이지 선택만 맥락에 전달하며 세 가지를 선택해야 전체 검토가 가능하다',()=>{
  let s=chooseProposal(emptyConsultation(),portfolio,'accepted');expect(phaseReady(s)).toBe(true);expect(consultationReady(s)).toBe(false);
  s=movePhase(s,'assets');expect(consultationContext(s).profile).toBe('balanced');expect(s.allocation).toBeNull();
  s=movePhase(chooseProposal(s,asset,'accepted'),'rules');expect(consultationContext(s).allocation).toEqual(allocation);expect(s.rules).toBeNull();
  s=chooseProposal(s,rules,'accepted');expect(consultationReady(s)).toBe(true);expect(restoreConsultation(JSON.stringify(s))).toEqual(s);
 });
 it('이전 배분 변경은 자산·조건 선택을 해제하고 오래된 제안을 차단한다',()=>{
  let s=chooseProposal(movePhase(chooseProposal(emptyConsultation(),portfolio,'accepted'),'assets'),asset,'accepted');
  s=movePhase(chooseProposal(movePhase(s,'rules'),rules,'accepted'),'portfolio');
  s=chooseProposal(s,reply('new',{phase:'portfolio',setup_preference:{profile:'cautious',cash:60}}),'accepted');
  expect(s.allocation).toBeNull();expect(s.rules).toBeNull();expect(s.selected.assets).toBeUndefined();
  s=movePhase(s,'assets');expect(canChoose(s,asset)).toBe(false);expect(chooseProposal(s,asset,'accepted')).toBe(s);
 });
 it('다른 페이지·대체 안내는 선택 불가하며 알림 없음도 명시적으로 선택해야 한다',()=>{
  expect(canChoose(emptyConsultation(),{...portfolio,source:'rules'})).toBe(false);expect(canChoose(emptyConsultation(),asset)).toBe(false);
  let s=movePhase(chooseProposal(movePhase(chooseProposal(emptyConsultation(),portfolio,'accepted'),'assets'),asset,'accepted'),'rules');
  expect(consultationReady(s)).toBe(false);s=chooseProposal(s,{...rules,risk_rules:[]},'accepted');expect(consultationReady(s)).toBe(true);expect(s.rules).toEqual([]);
 });
});
