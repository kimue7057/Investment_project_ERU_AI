import {describe,it,expect} from 'vitest';
import {loginReturn} from './loginReturn';
describe('이메일 로그인 복귀',()=>{
 it('이전 링크의 토큰을 URL에서 제거하고 재인증을 안내한다',()=>{
  const result=loginReturn('https://example.test/?setup=1#access_token=private&refresh_token=private');
  expect(result.href).toBe('/?setup=1');expect(result.message).toContain('새 인증메일');
 });
 it('공급자 오류 원문을 표시하지 않고 URL을 정리한다',()=>{
  const result=loginReturn('https://example.test/?error_code=expired&error_description=private');
  expect(result.href).toBe('/');expect(result.message).not.toContain('private');
 });
 it('다른 브라우저 안내와 일반 탐색 URL을 보존한다',()=>{
  expect(loginReturn('https://example.test/?login_error=browser').message).toContain('요청한 브라우저');
  expect(loginReturn('https://example.test/?setup=1#help')).toEqual({href:'/?setup=1#help',message:''});
 });
});
