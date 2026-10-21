import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {accountApi} from './client';
import {loginReturn} from './loginReturn';
import {money,pct,date,type GuidedGame} from './model';
import './account.css';
const InvestmentGame=lazy(()=>import('./InvestmentGame'));
type User={id:string;email:string};
type GameSummary={id:string;status:GuidedGame['status'];created_at:number|null;now:string;elapsed:number;nav:number;return_pct:number;trade_count:number;initial_plan:Record<string,string>|null};
type GameList={games:GameSummary[];next_offset:number|null};
const authNotice=()=>localStorage.setItem('eru-auth-notice',crypto.randomUUID());
const statusLabel={ready:'계획 작성 중',running:'진행 중',paused:'잠시 멈춤',finished:'투자 완료'};

function Login({configured,onLogin,initialMessage}:{configured:boolean;onLogin:(user:User)=>void;initialMessage:string}){
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(initialMessage),[remaining,setRemaining]=useState(0);
 const codeInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{setError(initialMessage);},[initialMessage]);
 useEffect(()=>{if(!remaining)return;const timer=setTimeout(()=>setRemaining(n=>Math.max(0,n-1)),1000);return()=>clearTimeout(timer);},[remaining]);
 useEffect(()=>{if(sent)codeInput.current?.focus();},[sent]);
 async function send(){if(busy)return;setBusy(true);setError('');try{const r=await accountApi<{retry_after:number}>('/auth/send-code',{email:email.trim()});setEmail(email.trim().toLowerCase());setSent(true);setCode('');setRemaining(r.retry_after);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function verify(){if(busy)return;setBusy(true);setError('');try{const r=await accountApi<{user:User}>('/auth/verify',{email,code});onLogin(r.user);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="account-shell"><header className="account-header"><span className="brand">ERU <span>AI 동행 투자</span></span></header><main className="account-login-layout"><section className="account-intro"><span className="eyebrow">YOUR INVESTMENT JOURNEY</span><h1>나의 투자 경험을<br/>하나의 계정에.</h1><p>직접 계획하고, 판단하고, 결과를 돌아보세요.<br/>매매부터 AI와의 대화까지 내 계정에 차곡차곡 남아요.</p><div className="account-preview"><span>01 · 나만의 포트폴리오</span><span>02 · 실제 시세로 5분 투자</span><span>03 · 선택과 손익을 복기</span></div></section><section className="panel account-login"><span className="eyebrow">WELCOME TO ERU</span><h2>{sent?'이메일을 확인해 주세요':'이메일로 시작하기'}</h2><p>{sent?`${email}로 보낸 최신 메일을 확인해 주세요. 로그인 링크를 누르거나 인증번호를 입력하면 돼요.`:'비밀번호 없이 이메일 인증으로 로그인해요. 처음 사용하는 이메일이면 계정이 만들어져요.'}</p>{!configured&&<p className="account-error" role="alert">이메일 인증 연결을 준비하고 있어요. 잠시 후 다시 접속해 주세요.</p>}
 <form onSubmit={e=>{e.preventDefault();void(sent?verify():send());}}>{!sent?<label>이메일<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@example.com" disabled={busy||!configured}/></label>:<label>인증번호<input ref={codeInput} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="인증번호 입력" disabled={busy}/></label>}{error&&<p className="account-error" role="alert">{error}</p>}<button className="btn primary wide" disabled={busy||!configured}>{busy?'처리 중…':sent?'인증하고 내 기록 열기':'인증메일 받기'}</button></form>
 {sent&&<div className="account-code-actions"><button disabled={busy||remaining>0} onClick={()=>void send()}>{remaining>0?`${remaining}초 후 다시 받기`:'인증메일 다시 받기'}</button><button disabled={busy} onClick={()=>{setSent(false);setCode('');setError('');}}>다른 이메일 사용</button><small>메일 링크는 인증을 요청한 브라우저에서 열어 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.</small></div>}<div className="account-login-note">인증 후 시작한 모든 투자 기록은 이 계정에 자동 보관해요.<br/>다른 기기에서도 같은 이메일로 이어서 확인할 수 있어요.</div></section></main></div>;
}

function Dashboard({user,onOpen,onNew,onLogout,busy}:{user:User;onOpen:(id:string)=>void;onNew:()=>void;onLogout:()=>void;busy:boolean}){
 const [data,setData]=useState<GameList|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');accountApi<GameList>('/account/games',undefined,controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);});return()=>controller.abort();},[user.id,retry]);
 async function more(){if(data?.next_offset==null||loading)return;setLoading(true);setError('');try{const next=await accountApi<GameList>('/account/games?offset='+data.next_offset);setData({games:[...data.games,...next.games.filter(g=>!data.games.some(old=>old.id===g.id))],next_offset:next.next_offset});}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 return <div className="account-shell"><header className="account-header"><span className="brand">ERU <span>AI 동행 투자</span></span><div className="account-user"><span>{user.email}</span><button disabled={busy} onClick={onLogout}>로그아웃</button></div></header><main className="account-dashboard"><div className="account-title"><div><span className="eyebrow">MY INVESTMENTS</span><h1>내 투자 기록</h1><p>내가 세운 계획과 선택, 그 결과를 이어서 확인해요.</p></div><button className="btn primary" disabled={busy} onClick={onNew}>{busy?'준비 중…':'+ 새 투자 시작'}</button></div>
 <section className="account-save-note"><b>모든 기록은 계정에 자동 보관돼요</b><span>초기 포트폴리오 · 판단과 체결 · AI 대화 · 결과 복기</span></section>
 {error&&<div className="account-error" role="alert">{error}<button className="btn secondary" onClick={()=>setRetry(n=>n+1)}>다시 불러오기</button></div>}
 {!data&&!error&&<section className="panel">투자 기록을 불러오고 있어요…</section>}
 {data&&!data.games.length&&<section className="panel account-empty"><span>↗</span><h2>첫 번째 투자 기록을 만들어 볼까요?</h2><p>이메일 인증을 마쳤어요. 성향과 투자할 코인을 선택하면 시작할 수 있어요.</p><button className="btn primary" disabled={busy} onClick={onNew}>첫 투자 시작하기</button><small>예전 비회원 기록은 보존되어 있지만 이 계정에 자동 연결하지 않아요.</small></section>}
 <div className="account-games">{data?.games.map(g=><article className="panel account-game-card" key={g.id}><header><span className={'account-game-status '+g.status}>{statusLabel[g.status]}</span><small>{g.created_at?new Date(g.created_at*1000).toLocaleDateString('ko-KR'):'저장된 투자'}</small></header><h2>{g.status==='ready'?'나만의 투자 계획':g.status==='finished'?'투자를 마쳤어요':'이어서 투자할까요?'}</h2><span className="account-game-nav">{money(g.nav)}</span><strong className={g.return_pct>=0?'up':'down'}>{pct(g.return_pct)}</strong><div className="account-game-progress"><i style={{width:g.elapsed/3+'%'}}/></div><div className="account-game-meta"><span>{date(g.now)} · {Math.floor(g.elapsed)}/300초</span><span>체결 {g.trade_count}건</span></div><button className="btn secondary wide" disabled={busy} onClick={()=>onOpen(g.id)}>{g.status==='finished'?'결과 복기 보기':g.status==='ready'?'계획 이어서 작성':'투자 이어하기'}</button></article>)}</div>
 {data?.next_offset!=null&&<button className="btn secondary account-more" disabled={loading} onClick={()=>void more()}>{loading?'불러오는 중…':'이전 투자 기록 더 보기'}</button>}<footer>실제 과거 시세 · 시작 자산 1억 원 · 활성 재생 300초</footer></main></div>;
}

export default function App(){
 const codeToExchange=useRef(new URL(location.href).searchParams.get('code')),linkExchange=useRef<Promise<{user:User}>|null>(null);
 const [returned,setReturned]=useState(()=>loginReturn(location.href));
 useEffect(()=>{const clean=()=>{const next=loginReturn(location.href);history.replaceState(null,'',next.href);if(next.message)setReturned(next);};window.addEventListener('hashchange',clean);return()=>window.removeEventListener('hashchange',clean);},[]);
 useEffect(()=>{history.replaceState(null,'',returned.href);},[returned.href]);
 const [user,setUser]=useState<User|null|undefined>(undefined),[configured,setConfigured]=useState(true),[gameId,setGameId]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();
  const load=async()=>{
   if(codeToExchange.current){
    // StrictMode에서 효과가 재실행돼도 일회용 코드는 한 번만 교환한다.
    linkExchange.current??=accountApi<{user:User}>('/auth/exchange',{code:codeToExchange.current});
    try{await linkExchange.current;}
    catch(e){
     if(!controller.signal.aborted){setReturned(prev=>({...prev,message:(e as Error).message}));setUser(null);}
     return;
    }finally{codeToExchange.current=null;}
    if(controller.signal.aborted)return;
   }
   const r=await accountApi<{configured:boolean;user:User|null}>('/auth/session',undefined,controller.signal);
   if(controller.signal.aborted)return;
   setConfigured(r.configured);setUser(r.user);
   if(r.user&&retry===0)authNotice();
   if(r.user){
    const url=new URL(location.href),fresh=url.searchParams.get('setup')==='1';
    if(!fresh)setGameId(sessionStorage.getItem('eru-account-game:'+r.user.id));
    else{url.searchParams.delete('setup');history.replaceState(null,'',url.pathname+url.search+url.hash);}
   }
  };
  void load().catch(e=>{if(!controller.signal.aborted)setError((e as Error).message);});
  return()=>controller.abort();
 },[retry]);
 useEffect(()=>{const expired=()=>{setUser(null);setGameId(null);setError('');};window.addEventListener('eru-auth-expired',expired);return()=>window.removeEventListener('eru-auth-expired',expired);},[]);
 useEffect(()=>{const refresh=()=>{if(!document.hidden&&user===null)setRetry(n=>n+1);};document.addEventListener('visibilitychange',refresh);return()=>document.removeEventListener('visibilitychange',refresh);},[user]);
 useEffect(()=>{const changed=(e:StorageEvent)=>{if(e.key==='eru-auth-notice')setRetry(n=>n+1);};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 function open(id:string){if(!user)return;setError('');sessionStorage.setItem('eru-account-game:'+user.id,id);setGameId(id);}
 async function home(){if(gameId)try{await accountApi('/sessions/'+gameId+'/leave',{});}catch(e){if((e as {status?:number}).status!==404)throw e;}if(user)sessionStorage.removeItem('eru-account-game:'+user.id);setGameId(null);}
 async function logout(){await accountApi('/auth/logout',{...(gameId?{session_id:gameId}:{})});if(user)sessionStorage.removeItem('eru-account-game:'+user.id);setUser(null);setGameId(null);authNotice();}
 async function newGame(){const g=await accountApi<GuidedGame>('/guided-sessions',{...(gameId?{previous_id:gameId}:{})});open(g.id);}
 async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(user===undefined)return <main><section className="panel"><h1>{error?'연결을 확인해 주세요':'이메일 로그인 상태를 확인하고 있어요'}</h1>{error&&<><p role="alert">{error}</p><button className="btn primary" onClick={()=>{setError('');setRetry(n=>n+1);}}>다시 연결</button></>}</section></main>;
 if(!user)return <Login initialMessage={returned.message} configured={configured} onLogin={u=>{setError('');setUser(u);setGameId(null);authNotice();}}/>;
 return <>{error&&<div className="message error account-global-error" role="alert">{error}<button aria-label="오류 닫기" onClick={()=>setError('')}>×</button></div>}{gameId?<Suspense fallback={<main><section className="panel">내 투자 기록을 열고 있어요…</section></main>}><InvestmentGame key={user.id+gameId} sessionId={gameId} email={user.email} onHome={home} onLogout={logout} onNew={newGame}/></Suspense>:<Dashboard user={user} onOpen={open} onNew={()=>void run(newGame)} onLogout={()=>void run(logout)} busy={busy}/>}</>;
}
