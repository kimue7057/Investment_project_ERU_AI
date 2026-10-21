const messages:Record<string,string>={
 browser:'인증을 요청한 브라우저에서 최신 메일 링크를 열어 주세요. 다른 브라우저라면 여기서 인증메일을 다시 받아 주세요.',
 expired:'이 로그인 링크는 만료되었거나 이미 사용됐어요. 아래에서 인증메일을 새로 받아 주세요.',
 service:'로그인 서버가 일시적으로 응답하지 않았어요. 잠시 후 인증메일을 다시 받아 주세요.',
 legacy:'이전 방식으로 발송된 메일이에요. 아래에서 새 인증메일을 받고 최신 링크를 열어 주세요.'
};
export function loginReturn(raw:string){
 const u=new URL(raw),hash=new URLSearchParams(u.hash.slice(1));
 let message=messages[u.searchParams.get('login_error')??'']??'';
 if(hash.has('access_token')||hash.has('refresh_token'))message=messages.legacy;
 else if(hash.has('error')||u.searchParams.has('error_code')||u.searchParams.has('code'))message=messages.expired;
 for(const key of ['login_error','code','error','error_code','error_description'])u.searchParams.delete(key);
 if(hash.has('access_token')||hash.has('refresh_token')||hash.has('error')||hash.has('error_code'))u.hash='';
 return {href:u.pathname+u.search+u.hash,message};
}
