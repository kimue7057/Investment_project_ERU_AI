export async function accountApi<T>(path:string,body?:object,signal?:AbortSignal):Promise<T>{
  const r=await fetch('/api'+path,{signal,credentials:'same-origin',method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await r.json();
  if(!r.ok){if(r.status===401)window.dispatchEvent(new Event('eru-auth-expired'));throw Object.assign(new Error(typeof data.detail==='string'?data.detail:'요청을 처리하지 못했어요.'),{status:r.status});}
  return data as T;
}
