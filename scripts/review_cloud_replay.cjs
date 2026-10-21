// 운영 서버의 실제 300초 시계로 본인 검증 게임을 완료한다. 시간/가격 우회 API를 사용하지 않는다.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=(process.env.ERU_BASE_URL||'https://eru-ai-investment-simulator.vercel.app').replace(/\/$/,''),out=path.resolve(__dirname,'../test-results');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function call(url,body){const r=await fetch(base+url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});if(!r.ok)throw new Error(r.status+' '+url+' '+await r.text());return r.json();}
(async()=>{
 const started=Date.now(),created=await call('/api/guided-sessions',{}),sid=created.id,url='/api/sessions/'+sid;
 fs.writeFileSync(path.join(out,'review-cloud-session.json'),JSON.stringify({id:sid}));
 const denied=await fetch(base+url+'/review');assert.equal(denied.status,400);
 let g=await call(url+'/start',{weights:{cash:30,A:42,B:28,C:0,D:0}}),decisions=0,lastLog=0;
 while(g.status!=='finished'){
  assert(Date.now()-started<900000,'게임 완료 시간 초과');
  if(g.status==='paused'){
   const alert=g.alerts.find(a=>a.decision===null);
   if(alert){
    const body=decisions===0?{kind:'trade',asset:'A',side:'sell',percent:25}:decisions===2?{kind:'rebalance',weights:{cash:40,A:25,B:25,C:10,D:0}}:{kind:'hold'};
    g=await call(url+'/approved-order',{...body,alert_id:alert.id});decisions++;
   }else g=await call(url+'/resume',{});
  }
  if(Date.now()-lastLog>20000){console.log(JSON.stringify({elapsed:Math.round(g.elapsed),status:g.status,decisions,trades:g.trades.length}));lastLog=Date.now();}
  await delay(900);g=await call(url);
 }
 const review=await call(url+'/review');
 assert(Math.abs(Number(review.net_profit)-Number(review.trading_profit)-Number(review.interest))<.00001);
 assert(review.baseline&&review.decisions.some(d=>d.comparison&&d.realized_pnl!==null));
 assert(review.decisions.some(d=>d.action==='hold'));
 assert.equal(review.decisions.reduce((n,d)=>n+d.fills.length,0),g.trades.length);
 assert(review.decisions.every(d=>d.linkage==='recorded'));
 fs.writeFileSync(path.join(out,'review-cloud-report.json'),JSON.stringify({base,passed:true,activeSeconds:g.elapsed,wallSeconds:(Date.now()-started)/1000,decisions:review.decisions.length,fills:g.trades.length,finalNav:review.final_nav,interest:review.interest,netProfit:review.net_profit,baseline:review.baseline.nav},null,2));
 console.log(JSON.stringify({passed:true,activeSeconds:g.elapsed,decisions:review.decisions.length,trades:g.trades.length}));
})().catch(e=>{console.error(e);process.exitCode=1;});
