"use strict";

function seeded(seed){
  let s=seed>>>0;
  return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296};
}

function normal(random){
  let u=0,v=0;
  while(!u)u=random();
  while(!v)v=random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}

self.onmessage=event=>{
  const {id,sample,p,type,seed,paths=4000,drawN=64,steps=80}=event.data;
  const random=seeded(seed),dt=p.T/steps,drift=(p.r-p.q-.5*p.v*p.v)*dt;
  const shock=p.v*Math.sqrt(dt),samples=[],ends=new Float64Array(paths);
  let payoffSum=0;
  for(let pathIndex=0;pathIndex<paths;pathIndex++){
    let spot=p.S,path=pathIndex<drawN?new Float64Array(steps+1):null;
    if(path)path[0]=spot;
    for(let step=1;step<=steps;step++){
      spot*=Math.exp(drift+shock*normal(random));
      if(path)path[step]=spot;
    }
    const payoff=type==="call"?Math.max(spot-p.K,0):Math.max(p.K-spot,0);
    payoffSum+=payoff;ends[pathIndex]=spot;if(path)samples.push(path);
  }
  const estimate=Math.exp(-p.r*p.T)*payoffSum/paths;
  self.postMessage({id,sample,samples,ends,estimate,steps,p,type});
};
