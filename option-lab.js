"use strict";

const $=id=>document.getElementById(id);
const inputs=["spot","strike","vol","expiry","rate","dividend"];
const state={type:"call",greek:"delta",seed:481516,yaw:-0.72,pitch:0.62,drag:null};
const palette={ink:"#0b1e2d",deep:"#123b54",steel:"#2c5670",amber:"#e4a340",jade:"#3e8e7e",brick:"#b5443a",muted:"#8ba0ad",line:"#294352",white:"#edf3f6"};

function normPdf(x){return Math.exp(-.5*x*x)/Math.sqrt(2*Math.PI)}
function normCdf(x){
  const b=[.319381530,-.356563782,1.781477937,-1.821255978,1.330274429];
  const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+.2316419*a);
  let poly=0,p=t; for(let i=0;i<b.length;i++){poly+=b[i]*p;p*=t}
  const value=1-normPdf(a)*poly; return sign>0?value:1-value;
}
function optionMetrics(S,K,T,r,q,v,type=state.type){
  const dr=Math.exp(-r*T),dq=Math.exp(-q*T);
  if(T<=0||v<=0||S<=0||K<=0){
    const intrinsic=type==="call"?Math.max(S-K,0):Math.max(K-S,0);
    return {price:intrinsic,delta:type==="call"?(S>K?1:0):(S<K?-1:0),gamma:0,vega:0,theta:0,rho:0,intrinsic};
  }
  const root=Math.sqrt(T),vs=v*root,d1=(Math.log(S/K)+(r-q+.5*v*v)*T)/vs,d2=d1-vs;
  const nd1=normPdf(d1); let price,delta,theta,rho;
  if(type==="call"){
    price=S*dq*normCdf(d1)-K*dr*normCdf(d2);
    delta=dq*normCdf(d1);
    theta=-(S*dq*nd1*v)/(2*root)-r*K*dr*normCdf(d2)+q*S*dq*normCdf(d1);
    rho=K*T*dr*normCdf(d2);
  }else{
    price=K*dr*normCdf(-d2)-S*dq*normCdf(-d1);
    delta=-dq*normCdf(-d1);
    theta=-(S*dq*nd1*v)/(2*root)+r*K*dr*normCdf(-d2)-q*S*dq*normCdf(-d1);
    rho=-K*T*dr*normCdf(-d2);
  }
  const intrinsic=type==="call"?Math.max(S-K,0):Math.max(K-S,0);
  return {price,delta,gamma:dq*nd1/(S*vs),vega:S*dq*nd1*root,theta,rho,intrinsic};
}
function params(){return {S:+$("spot").value,K:+$("strike").value,T:+$("expiry").value,r:+$("rate").value/100,q:+$("dividend").value/100,v:+$("vol").value/100}}
function fmt(value,d=2){return Number.isFinite(value)?value.toFixed(d):"—"}
function resize(canvas){
  const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(rect.width*dpr)||canvas.height!==Math.round(rect.height*dpr)){
    canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
  }
  const ctx=canvas.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);return {ctx,w:rect.width,h:rect.height};
}
function mix(a,b,t){
  const pa=a.match(/\w\w/g).map(x=>parseInt(x,16)),pb=b.match(/\w\w/g).map(x=>parseInt(x,16));
  return "#"+pa.map((x,i)=>Math.round(x+(pb[i]-x)*t).toString(16).padStart(2,"0")).join("");
}

function updateReadouts(){
  const p=params(),m=optionMetrics(p.S,p.K,p.T,p.r,p.q,p.v);
  $("spot-out").textContent=fmt(p.S,0);$("strike-out").textContent=fmt(p.K,0);
  $("vol-out").textContent=fmt(p.v*100,0)+"%";$("expiry-out").textContent=fmt(p.T,2)+"y";
  $("rate-out").textContent=fmt(p.r*100,1)+"%";$("dividend-out").textContent=fmt(p.q*100,1)+"%";
  $("price").textContent=fmt(m.price);$("intrinsic").textContent=fmt(m.intrinsic);
  $("time-value").textContent=fmt(Math.max(0,m.price-m.intrinsic));$("delta").textContent=fmt(m.delta,3);
  $("gamma").textContent=fmt(m.gamma,4);$("vega").textContent=fmt(m.vega/100,3);$("theta").textContent=fmt(m.theta/365,3);
  return {p,m};
}

function drawSurface(){
  const canvas=$("surface"),{ctx,w,h}=resize(canvas),p=params();ctx.clearRect(0,0,w,h);
  const nx=34,nt=20,sLo=p.K*.4,sHi=p.K*1.6,scale=Math.min(w*.43,h*.48),cx=w*.51,cy=h*.74;
  const maxZ=Math.max(p.K*.72,1),yaw=state.yaw,depth=.2+state.pitch*.52;
  function project(x,y,z){
    const rx=x*Math.cos(yaw)-y*Math.sin(yaw),ry=x*Math.sin(yaw)+y*Math.cos(yaw);
    return [cx+rx*scale,cy+ry*scale*depth-z*scale*1.35];
  }
  const points=[];
  for(let j=0;j<=nt;j++){
    const row=[];for(let i=0;i<=nx;i++){
      const S=sLo+(sHi-sLo)*i/nx,T=p.T*j/nt,m=optionMetrics(S,p.K,T,p.r,p.q,p.v);
      row.push({S,T,v:m.price,tv:Math.max(0,m.price-m.intrinsic),pt:project((i/nx-.5)*1.9,(j/nt-.5)*1.45,m.price/maxZ)});
    }points.push(row);
  }
  ctx.fillStyle="#071620";ctx.fillRect(0,0,w,h);
  const cells=[];
  for(let j=0;j<nt;j++)for(let i=0;i<nx;i++)cells.push({i,j,depth:points[j][i].pt[1]+points[j+1][i+1].pt[1]});
  cells.sort((a,b)=>a.depth-b.depth);
  cells.forEach(({i,j})=>{
    const q=[points[j][i],points[j][i+1],points[j+1][i+1],points[j+1][i]],tv=(q[0].tv+q[1].tv+q[2].tv+q[3].tv)/4;
    const t=Math.min(1,tv/(p.K*.14));ctx.beginPath();q.forEach((x,k)=>k?ctx.lineTo(...x.pt):ctx.moveTo(...x.pt));ctx.closePath();
    ctx.fillStyle=t<.55?mix(palette.deep,palette.jade,t/.55):mix(palette.jade,palette.amber,(t-.55)/.45);ctx.globalAlpha=.82;ctx.fill();
    ctx.globalAlpha=.42;ctx.strokeStyle="#6f919e";ctx.lineWidth=.45;ctx.stroke();ctx.globalAlpha=1;
  });
  [0,nt].forEach(j=>{ctx.beginPath();points[j].forEach((x,i)=>i?ctx.lineTo(...x.pt):ctx.moveTo(...x.pt));ctx.strokeStyle=j?palette.amber:palette.white;ctx.lineWidth=j?2:2.5;ctx.stroke()});
  for(let j=0;j<=nt;j+=5){ctx.beginPath();points[j].forEach((x,i)=>i?ctx.lineTo(...x.pt):ctx.moveTo(...x.pt));ctx.strokeStyle="rgba(220,235,241,.28)";ctx.lineWidth=.7;ctx.stroke()}
  const current=optionMetrics(p.S,p.K,p.T,p.r,p.q,p.v),ix=(p.S-sLo)/(sHi-sLo),marker=project((ix-.5)*1.9,.725,current.price/maxZ),base=project((ix-.5)*1.9,.725,0);
  ctx.setLineDash([4,4]);ctx.strokeStyle=palette.white;ctx.beginPath();ctx.moveTo(...base);ctx.lineTo(...marker);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=palette.amber;ctx.beginPath();ctx.arc(marker[0],marker[1],5,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#071620";ctx.lineWidth=2;ctx.stroke();
  ctx.font="700 11px Segoe UI, sans-serif";ctx.fillStyle=palette.muted;
  const expiryLeft=points[0][0].pt,expiryRight=points[0][nx].pt,todayLeft=points[nt][0].pt;
  ctx.fillText("lower spot",expiryLeft[0]-14,expiryLeft[1]+24);ctx.fillText("higher spot",expiryRight[0]-35,expiryRight[1]+24);
  ctx.fillStyle=palette.white;ctx.fillText("EXPIRY PAYOFF",expiryLeft[0],expiryLeft[1]-13);ctx.fillStyle=palette.amber;ctx.fillText("TODAY",todayLeft[0],todayLeft[1]-13);
  canvas.setAttribute("aria-label",`${state.type} option value surface with spot ${p.S}, strike ${p.K}, volatility ${fmt(p.v*100,0)} percent and ${fmt(p.T,2)} years to expiry`);
}

const greekInfo={
  delta:["Delta","Delta is the slope of the value curve: near zero for an out-of-the-money call, near one when it is deep in the money."],
  gamma:["Gamma","Gamma concentrates around the strike and sharpens as expiry approaches. This is where delta changes fastest."],
  vega:["Vega","Vega is largest near the strike when there is still time left. Volatility matters most when the outcome remains genuinely uncertain."],
  theta:["Theta","Theta is usually most negative near the strike. Time decay is not a steady fee; it accelerates where time value is concentrated."],
  rho:["Rho","Rho shows sensitivity to rates. It grows with time and has the opposite sign for puts and calls."]
};
function greekValue(m,g){return g==="vega"?m.vega/100:g==="theta"?m.theta/365:g==="rho"?m.rho/100:m[g]}
let greekPlot=null;
function drawGreeks(){
  const canvas=$("greeks"),{ctx,w,h}=resize(canvas),p=params(),lo=p.K*.4,hi=p.K*1.6,n=220,vals=[];
  for(let i=0;i<=n;i++){const S=lo+(hi-lo)*i/n,m=optionMetrics(S,p.K,p.T,p.r,p.q,p.v);vals.push({S,y:greekValue(m,state.greek)})}
  let ymin=Math.min(0,...vals.map(x=>x.y)),ymax=Math.max(0,...vals.map(x=>x.y));if(ymax-ymin<1e-8){ymin=-1;ymax=1}
  const pad=(ymax-ymin)*.13;ymin-=pad;ymax+=pad;const m={l:58,r:24,t:25,b:42},X=s=>m.l+(s-lo)/(hi-lo)*(w-m.l-m.r),Y=y=>m.t+(ymax-y)/(ymax-ymin)*(h-m.t-m.b);
  ctx.clearRect(0,0,w,h);ctx.fillStyle=palette.night;ctx.fillRect(0,0,w,h);ctx.font="10px Segoe UI, sans-serif";ctx.textAlign="center";
  for(let i=0;i<=6;i++){const x=lo+(hi-lo)*i/6;ctx.strokeStyle="rgba(190,211,220,.10)";ctx.beginPath();ctx.moveTo(X(x),m.t);ctx.lineTo(X(x),h-m.b);ctx.stroke();ctx.fillStyle=palette.muted;ctx.fillText(fmt(x,0),X(x),h-17)}
  for(let i=0;i<=4;i++){const y=ymin+(ymax-ymin)*i/4;ctx.strokeStyle="rgba(190,211,220,.10)";ctx.beginPath();ctx.moveTo(m.l,Y(y));ctx.lineTo(w-m.r,Y(y));ctx.stroke();ctx.textAlign="right";ctx.fillStyle=palette.muted;ctx.fillText(Math.abs(y)<.01?fmt(y,3):fmt(y,2),m.l-8,Y(y)+3);ctx.textAlign="center"}
  ctx.strokeStyle="rgba(237,243,246,.45)";ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(m.l,Y(0));ctx.lineTo(w-m.r,Y(0));ctx.stroke();ctx.setLineDash([]);
  const grad=ctx.createLinearGradient(0,m.t,0,h-m.b);grad.addColorStop(0,"rgba(228,163,64,.38)");grad.addColorStop(1,"rgba(62,142,126,.03)");
  ctx.beginPath();vals.forEach((x,i)=>i?ctx.lineTo(X(x.S),Y(x.y)):ctx.moveTo(X(x.S),Y(x.y)));ctx.lineTo(X(hi),Y(0));ctx.lineTo(X(lo),Y(0));ctx.closePath();ctx.fillStyle=grad;ctx.fill();
  ctx.beginPath();vals.forEach((x,i)=>i?ctx.lineTo(X(x.S),Y(x.y)):ctx.moveTo(X(x.S),Y(x.y)));ctx.strokeStyle=palette.amber;ctx.lineWidth=3;ctx.stroke();
  [[p.K,"K",palette.jade],[p.S,"S",palette.white]].forEach(([s,label,col])=>{ctx.strokeStyle=col;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(X(s),m.t);ctx.lineTo(X(s),h-m.b);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=col;ctx.fillText(label,X(s),14)});
  greekPlot={X,Y,lo,hi,ymin,ymax,vals,m,w,h};canvas.setAttribute("aria-label",`${greekInfo[state.greek][0]} profile across spot from ${fmt(lo,0)} to ${fmt(hi,0)}`);
  $("greek-insight-label").textContent=greekInfo[state.greek][0];$("greek-insight").textContent=greekInfo[state.greek][1];
}

function seeded(seed){let s=seed>>>0;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296}}
function normal(r){let u=0,v=0;while(!u)u=r();while(!v)v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
function simulateFallback(p,type,seed,id){
  const rgen=seeded(seed),steps=80,paths=4000,drawN=64,dt=p.T/steps,drift=(p.r-p.q-.5*p.v*p.v)*dt,shock=p.v*Math.sqrt(dt),samples=[],ends=[],sum=0;
  for(let j=0;j<paths;j++){
    let S=p.S,path=j<drawN?[S]:null;for(let i=1;i<=steps;i++){S*=Math.exp(drift+shock*normal(rgen));if(path)path.push(S)}
    const payoff=type==="call"?Math.max(S-p.K,0):Math.max(p.K-S,0);sum+=payoff;ends.push(S);if(path)samples.push(path);
  }
  return {id,samples,ends,estimate:Math.exp(-p.r*p.T)*sum/paths,steps,p,type};
}
function drawPaths(sim){
  const canvas=$("paths"),{ctx,w,h}=resize(canvas),p=sim.p,m={l:48,r:25,t:24,b:38},split=w*.73,pathW=split-m.l-18;
  const all=sim.samples.flatMap(path=>Array.from(path)),rawLo=Math.min(p.K,p.S,...all),rawHi=Math.max(p.K,p.S,...all),pad=(rawHi-rawLo)*.08,ylo=Math.max(0,rawLo-pad),yhi=rawHi+pad;
  const X=i=>m.l+i/sim.steps*pathW,Y=s=>m.t+(yhi-s)/(yhi-ylo)*(h-m.t-m.b);
  ctx.clearRect(0,0,w,h);ctx.fillStyle=palette.night;ctx.fillRect(0,0,w,h);ctx.font="10px Segoe UI, sans-serif";
  for(let i=0;i<=4;i++){const s=ylo+(yhi-ylo)*i/4;ctx.strokeStyle="rgba(190,211,220,.1)";ctx.beginPath();ctx.moveTo(m.l,Y(s));ctx.lineTo(split-16,Y(s));ctx.stroke();ctx.fillStyle=palette.muted;ctx.textAlign="right";ctx.fillText(fmt(s,0),m.l-7,Y(s)+3)}
  sim.samples.forEach(path=>{const itm=sim.type==="call"?path.at(-1)>p.K:path.at(-1)<p.K;ctx.beginPath();path.forEach((s,i)=>i?ctx.lineTo(X(i),Y(s)):ctx.moveTo(X(i),Y(s)));ctx.strokeStyle=itm?"rgba(62,142,126,.36)":"rgba(117,148,166,.22)";ctx.lineWidth=1;ctx.stroke()});
  ctx.strokeStyle=palette.amber;ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(m.l,Y(p.K));ctx.lineTo(split-16,Y(p.K));ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=palette.amber;ctx.textAlign="left";ctx.fillText("strike",m.l+5,Y(p.K)-6);
  ctx.fillStyle=palette.muted;ctx.textAlign="center";ctx.fillText("today",m.l,h-15);ctx.fillText("expiry",split-22,h-15);
  const bins=26,eLo=Math.min(...sim.ends),eHi=Math.max(...sim.ends),counts=new Array(bins).fill(0);sim.ends.forEach(s=>counts[Math.min(bins-1,Math.floor((s-eLo)/(eHi-eLo)*bins))]++);const max=Math.max(...counts),hx=split+10,hw=w-hx-12,bh=(h-m.t-m.b)/bins;
  ctx.textAlign="left";ctx.fillStyle=palette.white;ctx.font="700 10px Segoe UI, sans-serif";ctx.fillText("TERMINAL DISTRIBUTION",hx,m.t-7);
  counts.forEach((count,i)=>{const s=eLo+(i+.5)/bins*(eHi-eLo),itm=sim.type==="call"?s>p.K:s<p.K;ctx.fillStyle=itm?palette.jade:palette.steel;ctx.globalAlpha=.75;ctx.fillRect(hx,m.t+(bins-1-i)*bh,Math.max(1,count/max*hw),Math.max(1,bh-1))});ctx.globalAlpha=1;
  const bs=optionMetrics(p.S,p.K,p.T,p.r,p.q,p.v).price,diff=sim.estimate-bs;$("mc-price").textContent=fmt(sim.estimate);$("bs-price").textContent=fmt(bs);$("mc-diff").textContent=(diff>=0?"+":"")+fmt(diff,3);
  canvas.setAttribute("aria-label",`${sim.samples.length} visible simulated paths and terminal distribution; Monte Carlo estimate ${fmt(sim.estimate)} versus closed-form value ${fmt(bs)}`);
}

let fastFrame,surfaceFrame,resizeFrame,mcTimer,mcVersion=0,lastSimulation=null;
const mcWorker=typeof Worker!=="undefined"?new Worker("option-worker.js"):null;
function setMCStatus(message,busy=false){const status=$("mc-status");status.textContent=message;status.classList.toggle("busy",busy)}
function renderFast(){updateReadouts();drawSurface();drawGreeks()}
function scheduleFastRender(){cancelAnimationFrame(fastFrame);fastFrame=requestAnimationFrame(renderFast)}
function finishSimulation(sim){
  if(sim.id!==mcVersion)return;
  lastSimulation=sim;drawPaths(sim);setMCStatus("Current");
}
function startSimulation(id){
  if(id!==mcVersion)return;
  setMCStatus("Calculating…",true);
  const payload={id,p:params(),type:state.type,seed:state.seed,paths:4000,drawN:64,steps:80};
  if(mcWorker)mcWorker.postMessage(payload);
  else setTimeout(()=>finishSimulation(simulateFallback(payload.p,payload.type,payload.seed,id)),0);
}
function scheduleSimulation(delay=180){
  const id=++mcVersion;clearTimeout(mcTimer);setMCStatus(delay?"Waiting for input…":"Calculating…",true);
  mcTimer=setTimeout(()=>startSimulation(id),delay);
}
function scheduleUpdate(delay=180){scheduleFastRender();scheduleSimulation(delay)}
if(mcWorker)mcWorker.onmessage=event=>finishSimulation(event.data);

inputs.forEach(id=>$(id).addEventListener("input",()=>{history.replaceState(null,"",location.pathname+location.hash);scheduleUpdate()}));
document.querySelectorAll("#option-type button").forEach(button=>button.addEventListener("click",()=>{
  state.type=button.dataset.value;document.querySelectorAll("#option-type button").forEach(x=>{const on=x===button;x.classList.toggle("on",on);x.setAttribute("aria-pressed",String(on))});scheduleUpdate(0);
}));
document.querySelectorAll("#greek-picker button").forEach(button=>button.addEventListener("click",()=>{state.greek=button.dataset.greek;document.querySelectorAll("#greek-picker button").forEach(x=>x.classList.toggle("on",x===button));scheduleFastRender()}));

const surface=$("surface");
surface.addEventListener("pointerdown",e=>{state.drag={x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch};surface.setPointerCapture(e.pointerId)});
surface.addEventListener("pointermove",e=>{if(!state.drag)return;state.yaw=state.drag.yaw+(e.clientX-state.drag.x)/220;state.pitch=Math.max(.18,Math.min(1,state.drag.pitch+(e.clientY-state.drag.y)/300));cancelAnimationFrame(surfaceFrame);surfaceFrame=requestAnimationFrame(drawSurface)});
surface.addEventListener("pointerup",()=>state.drag=null);surface.addEventListener("pointercancel",()=>state.drag=null);

$("greeks").addEventListener("pointermove",e=>{
  if(!greekPlot)return;const rect=e.currentTarget.getBoundingClientRect(),x=e.clientX-rect.left,p=greekPlot;if(x<p.m.l||x>p.w-p.m.r){$("greek-readout").style.display="none";return}
  const S=p.lo+(x-p.m.l)/(p.w-p.m.l-p.m.r)*(p.hi-p.lo),pr=params(),value=greekValue(optionMetrics(S,pr.K,pr.T,pr.r,pr.q,pr.v),state.greek),read=$("greek-readout");
  read.textContent=`Spot ${fmt(S,1)} · ${greekInfo[state.greek][0]} ${fmt(value,4)}`;read.style.display="block";read.style.left=Math.min(x+10,p.w-180)+"px";read.style.top="18px";
});
$("greeks").addEventListener("pointerleave",()=>$("greek-readout").style.display="none");
$("resample").addEventListener("click",()=>{state.seed=(state.seed*1664525+1013904223)>>>0;scheduleSimulation(0)});

const defaults={spot:100,strike:100,vol:25,expiry:1,rate:3,dividend:1};
function apply(values,note=""){
  Object.entries(values).forEach(([id,value])=>{$(id).value=value});$("preset-note").textContent=note;scheduleUpdate(0);
}
$("reset").addEventListener("click",()=>{state.type="call";document.querySelector('#option-type button[data-value="call"]').click();apply(defaults);history.replaceState(null,"",location.pathname)});
document.querySelectorAll("[data-preset]").forEach(button=>button.addEventListener("click",()=>{
  const p=button.dataset.preset;
  if(p==="expiry")apply({spot:100,strike:100,expiry:.08,vol:25},"Gamma sharpens and theta accelerates around the strike as the remaining time collapses.");
  if(p==="vol")apply({spot:100,strike:100,expiry:1,vol:50},"The surface lifts even though the expected direction has not changed: optionality benefits from dispersion.");
  if(p==="deep")apply(state.type==="call"?{spot:140,strike:90,expiry:1,vol:25}:{spot:60,strike:110,expiry:1,vol:25},"Deep in the money, value behaves more like the underlying and gamma and time value fade.");
}));

function setupUrl(){const u=new URL(location.href);u.search="";const p=params();u.searchParams.set("type",state.type);u.searchParams.set("s",p.S);u.searchParams.set("k",p.K);u.searchParams.set("v",p.v*100);u.searchParams.set("t",p.T);u.searchParams.set("r",p.r*100);u.searchParams.set("q",p.q*100);u.searchParams.set("g",state.greek);return u.href}
$("share-link").addEventListener("click",async()=>{const button=$("share-link");try{await navigator.clipboard.writeText(setupUrl())}catch(e){const t=document.createElement("textarea");t.value=setupUrl();document.body.appendChild(t);t.select();document.execCommand("copy");t.remove()}button.textContent="Link copied";setTimeout(()=>button.textContent="Copy setup link",1600)});
function restore(){
  const q=new URLSearchParams(location.search),map={s:"spot",k:"strike",v:"vol",t:"expiry",r:"rate",q:"dividend"};Object.entries(map).forEach(([key,id])=>{if(q.has(key)){const n=Number(q.get(key)),el=$(id);if(Number.isFinite(n)&&n>=+el.min&&n<=+el.max)el.value=n}});
  if(["call","put"].includes(q.get("type")))document.querySelector(`#option-type button[data-value="${q.get("type")}"]`).click();if(greekInfo[q.get("g")])document.querySelector(`#greek-picker button[data-greek="${q.get("g")}"]`).click();
}
window.addEventListener("resize",()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{renderFast();if(lastSimulation)drawPaths(lastSimulation)})});
restore();renderFast();scheduleSimulation(0);
