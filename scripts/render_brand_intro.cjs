// 원본 방패 로고로 4.8초 세로형 브랜드 인트로를 만듭니다.
// Playwright는 개발용 런타임에서 제공하며 앱 번들에는 포함하지 않습니다.
const fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:720,height:1280}});
  await page.setContent('<canvas width="720" height="1280"></canvas>');
  const logo=fs.readFileSync('frontend/public/assets/riskguard-logo.webp').toString('base64');
  const recorded=await page.evaluate(async logo=>{
   const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),img=new Image();
   img.src='data:image/webp;base64,'+logo;await img.decode();
   const icons={};for(const size of [192,512]){const icon=document.createElement('canvas');icon.width=size;icon.height=size;const ic=icon.getContext('2d');ic.fillStyle='#0c121e';ic.fillRect(0,0,size,size);const h=size*.7,w=h*img.naturalWidth/img.naturalHeight;ic.drawImage(img,(size-w)/2,(size-h)/2,w,h);icons[size]=icon.toDataURL('image/png').split(',')[1];}
   const stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:2400000}),chunks=[];
   const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve;});
   const ease=x=>1-Math.pow(1-Math.max(0,Math.min(1,x)),3);
   const draw=t=>{
    ctx.globalAlpha=1;ctx.fillStyle='#080d18';ctx.fillRect(0,0,720,1280);
    const glow=ctx.createRadialGradient(360+Math.sin(t)*70,535,0,360,535,420);glow.addColorStop(0,'#263653');glow.addColorStop(.55,'#101b2e');glow.addColorStop(1,'#080d18');ctx.fillStyle=glow;ctx.fillRect(0,0,720,1280);
    ctx.strokeStyle='#8593ac0d';ctx.lineWidth=1;
    for(let x=0;x<720;x+=60){ctx.beginPath();ctx.moveTo(x,150);ctx.lineTo(x,1050);ctx.stroke();}
    for(let y=150;y<1100;y+=60){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(720,y);ctx.stroke();}
    const appear=ease(t/1.5);ctx.globalAlpha=appear*.6;ctx.lineWidth=1.5;ctx.strokeStyle='#c9a66c';
    for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(360,530,153+i*40,153+i*40,0,-Math.PI/2,-Math.PI/2+Math.PI*2*ease((t-i*.15)/1.8));ctx.stroke();ctx.globalAlpha*=.45;}
    for(let i=0;i<24;i++){const a=i*2.399+t*.08,r=140+(i*19)%200;ctx.globalAlpha=(.15+.3*Math.sin(i+t)**2)*appear;ctx.fillStyle=i%3?'#9aabc8':'#e8bf77';ctx.beginPath();ctx.arc(360+Math.cos(a)*r,530+Math.sin(a)*r,1.1+(i%3)*.4,0,7);ctx.fill();}
    const reveal=ease((t-.4)/1.5),scale=.84+.16*reveal;ctx.globalAlpha=reveal;ctx.save();ctx.translate(360,530+(1-reveal)*40);ctx.scale(scale,scale);ctx.shadowColor='#0009';ctx.shadowBlur=40;ctx.drawImage(img,-114,-130,228,260);ctx.restore();
    ctx.globalAlpha=ease((t-1.3)/1);ctx.textAlign='center';ctx.fillStyle='#f4f6fb';ctx.font='600 46px Arial';ctx.fillText('RISK GUARD',360,770);
    ctx.globalAlpha=ease((t-1.8)/1);ctx.fillStyle='#bd9b64';ctx.font='500 17px Arial';ctx.letterSpacing='6px';ctx.fillText('E R U  A I',360,817);
    const sweep=ease((t-2.1)/1.5);ctx.globalAlpha=.7;const line=ctx.createLinearGradient(240,0,480,0);line.addColorStop(0,'#cba76400');line.addColorStop(.5,'#cba764');line.addColorStop(1,'#cba76400');ctx.fillStyle=line;ctx.fillRect(360-120*sweep,864,240*sweep,1);
    ctx.globalAlpha=ease((t-2.4)/1);ctx.fillStyle='#8291ac';ctx.font='12px Arial';ctx.fillText('CLARITY THROUGH VOLATILITY',360,910);
   };
   draw(0);recorder.start();const start=performance.now();
   await new Promise(resolve=>{function frame(now){const t=(now-start)/1000;draw(Math.min(t,4.8));if(t<4.8)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
   recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());
   const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return {video:btoa(raw),icons};
  },logo);
  fs.writeFileSync('test-results/riskguard-intro.webm',Buffer.from(recorded.video,'base64'));
  for(const [size,data] of Object.entries(recorded.icons))fs.writeFileSync(`frontend/public/assets/riskguard-icon-${size}.png`,Buffer.from(data,'base64'));
  console.log('브랜드 인트로 원본 렌더링 완료');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
