"use strict";

import { optionMetrics as calculateOptionMetrics } from "./math";

const palette={deep:"#123b54",steel:"#2c5670",amber:"#e4a340",jade:"#3e8e7e",muted:"#8ba0ad",white:"#edf3f6"};
let canvas,ctx,latestJob=null,renderQueued=false;

function optionMetrics(S,K,T,r,q,v,type){
  return calculateOptionMetrics({S,K,T,r,q,v},type);
}
function mix(a,b,t){
  const pa=a.match(/\w\w/g).map(x=>parseInt(x,16)),pb=b.match(/\w\w/g).map(x=>parseInt(x,16));
  return "#"+pa.map((x,i)=>Math.round(x+(pb[i]-x)*t).toString(16).padStart(2,"0")).join("");
}
const surfaceColors=Array.from({length:64},(_,i)=>{
  const t=i/63;return t<.55?mix(palette.deep,palette.jade,t/.55):mix(palette.jade,palette.amber,(t-.55)/.45);
});

function drawSurface(job){
  const {p,type,yaw,pitch,width:w,height:h,dpr}=job,pixelWidth=Math.round(w*dpr),pixelHeight=Math.round(h*dpr);
  if(canvas.width!==pixelWidth||canvas.height!==pixelHeight){canvas.width=pixelWidth;canvas.height=pixelHeight}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const nx=34,nt=20,sLo=p.K*.4,sHi=p.K*1.6,scale=Math.min(w*.43,h*.48),cx=w*.51,cy=h*.74;
  const maxZ=Math.max(p.K*.72,1),cosYaw=Math.cos(yaw),sinYaw=Math.sin(yaw),depth=.2+pitch*.52;
  const project=(x,y,z)=>{const rx=x*cosYaw-y*sinYaw,ry=x*sinYaw+y*cosYaw;return [cx+rx*scale,cy+ry*scale*depth-z*scale*1.35]};
  const points=[];
  for(let j=0;j<=nt;j++){
    const row=[];for(let i=0;i<=nx;i++){
      const S=sLo+(sHi-sLo)*i/nx,T=p.T*j/nt,m=optionMetrics(S,p.K,T,p.r,p.q,p.v,type);
      row.push({tv:Math.max(0,m.price-m.intrinsic),pt:project((i/nx-.5)*1.9,(j/nt-.5)*1.45,m.price/maxZ)});
    }points.push(row);
  }
  ctx.fillStyle="#071620";ctx.fillRect(0,0,w,h);
  const cells=[];
  for(let j=0;j<nt;j++)for(let i=0;i<nx;i++)cells.push({i,j,depth:points[j][i].pt[1]+points[j+1][i+1].pt[1]});
  cells.sort((a,b)=>a.depth-b.depth);
  cells.forEach(({i,j})=>{
    const q=[points[j][i],points[j][i+1],points[j+1][i+1],points[j+1][i]],tv=(q[0].tv+q[1].tv+q[2].tv+q[3].tv)/4,t=Math.min(1,tv/(p.K*.14));
    ctx.beginPath();q.forEach((x,k)=>k?ctx.lineTo(...x.pt):ctx.moveTo(...x.pt));ctx.closePath();ctx.fillStyle=surfaceColors[Math.round(t*63)];ctx.globalAlpha=.82;ctx.fill();
    ctx.globalAlpha=.42;ctx.strokeStyle="#6f919e";ctx.lineWidth=.45;ctx.stroke();ctx.globalAlpha=1;
  });
  [0,nt].forEach(j=>{ctx.beginPath();points[j].forEach((x,i)=>i?ctx.lineTo(...x.pt):ctx.moveTo(...x.pt));ctx.strokeStyle=j?palette.amber:palette.white;ctx.lineWidth=j?2:2.5;ctx.stroke()});
  for(let j=0;j<=nt;j+=5){ctx.beginPath();points[j].forEach((x,i)=>i?ctx.lineTo(...x.pt):ctx.moveTo(...x.pt));ctx.strokeStyle="rgba(220,235,241,.28)";ctx.lineWidth=.7;ctx.stroke()}
  const current=optionMetrics(p.S,p.K,p.T,p.r,p.q,p.v,type),ix=(p.S-sLo)/(sHi-sLo),marker=project((ix-.5)*1.9,.725,current.price/maxZ),base=project((ix-.5)*1.9,.725,0);
  ctx.setLineDash([4,4]);ctx.strokeStyle=palette.white;ctx.beginPath();ctx.moveTo(...base);ctx.lineTo(...marker);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=palette.amber;ctx.beginPath();ctx.arc(marker[0],marker[1],5,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#071620";ctx.lineWidth=2;ctx.stroke();
  ctx.font="700 11px Segoe UI, sans-serif";ctx.fillStyle=palette.muted;
  const expiryLeft=points[0][0].pt,expiryRight=points[0][nx].pt,todayLeft=points[nt][0].pt;
  ctx.fillText("lower spot",expiryLeft[0]-14,expiryLeft[1]+24);ctx.fillText("higher spot",expiryRight[0]-35,expiryRight[1]+24);
  ctx.fillStyle=palette.white;ctx.fillText("EXPIRY PAYOFF",expiryLeft[0],expiryLeft[1]-13);ctx.fillStyle=palette.amber;ctx.fillText("TODAY",todayLeft[0],todayLeft[1]-13);
}

function queueRender(){
  if(renderQueued)return;renderQueued=true;
  setTimeout(()=>{const job=latestJob;latestJob=null;if(job){drawSurface(job);self.postMessage({action:"rendered",frame:job.frame})}renderQueued=false;if(latestJob)queueRender()},0);
}

self.onmessage=event=>{
  if(event.data.action==="init"){canvas=event.data.canvas;ctx=canvas.getContext("2d");return}
  if(event.data.action==="draw"){latestJob=event.data;queueRender()}
};
