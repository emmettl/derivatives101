"use strict";

(function(root){
  const DAYS=252,SPOT=100,STRIKE=100;
  function seeded(seed){let state=seed>>>0||1;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296}}
  function normal(random){let u=0,v=0;while(!u)u=random();while(!v)v=random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
  function hasBonus(p){return p.product!=="outperformance"}
  function participation(p){return p.product==="bonus"?1:Number(p.participation)}
  function outperformance(level,p){const factor=participation(p);return level<=STRIKE?level:STRIKE+factor*(level-STRIKE)}
  function redemption(level,breached,p){const base=outperformance(level,p);return hasBonus(p)&&!breached?Math.max(Number(p.bonus),base):base}
  function crossover(p){return hasBonus(p)?STRIKE+Math.max(0,Number(p.bonus)-STRIKE)/participation(p):STRIKE}
  function barrierState(path,p){if(!hasBonus(p))return {breached:false,day:null};if(p.monitoring==="maturity"){const day=path.length-1;return {breached:path[day]<=p.barrier,day:path[day]<=p.barrier?day:null}}for(let day=1;day<path.length;day++)if(path[day]<=p.barrier)return {breached:true,day};return {breached:false,day:null}}
  function interpolate(anchors,t){for(let i=1;i<anchors.length;i++)if(t<=anchors[i][0]){const [t0,a]=anchors[i-1],[t1,b]=anchors[i],weight=(t-t0)/(t1-t0);return a+(b-a)*weight}return anchors.at(-1)[1]}
  function pairedPaths(p){
    const end=Math.max(2,Math.round(p.tenor*DAYS)),final=Number(p.finalLevel),barrier=Number(p.barrier),safe=new Float64Array(end+1),touch=new Float64Array(end+1);
    const safeAnchors=[[0,100],[.28,Math.max(98,barrier+12)],[.58,Math.max(barrier+8,(100+final)/2)],[.8,Math.max(barrier+5,final+2)],[1,final]],touchAnchors=[[0,100],[.3,Math.max(92,barrier+10)],[.5,barrier-2],[.7,Math.max(barrier+5,(barrier+final)/2)],[1,final]];
    for(let day=0;day<=end;day++){const t=day/end;safe[day]=interpolate(safeAnchors,t);touch[day]=interpolate(touchAnchors,t)}
    return {safe,touch};
  }
  function pairOutcomes(p){const paths=pairedPaths(p),safeState=barrierState(paths.safe,p),touchState=barrierState(paths.touch,p),final=Number(p.finalLevel);return {paths,final,safe:{...safeState,redemption:redemption(final,safeState.breached,p)},touch:{...touchState,redemption:redemption(final,touchState.breached,p)}}}
  function normCdf(x){const sign=x<0?-1:1,z=Math.abs(x)/Math.sqrt(2),t=1/(1+.3275911*z),a1=.254829592,a2=-.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,erf=1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-z*z);return .5*(1+sign*erf)}
  function callPrice(spot,strike,tenor,rate,dividend,vol){if(tenor<=0||vol<=0)return Math.max(0,spot*Math.exp(-dividend*tenor)-strike*Math.exp(-rate*tenor));const rootT=Math.sqrt(tenor),d1=(Math.log(spot/strike)+(rate-dividend+.5*vol*vol)*tenor)/(vol*rootT),d2=d1-vol*rootT;return spot*Math.exp(-dividend*tenor)*normCdf(d1)-strike*Math.exp(-rate*tenor)*normCdf(d2)}
  function budget(p){
    const tenor=Number(p.tenor),vol=Number(p.vol)/100,dividend=Number(p.dividend)/100,fee=Number(p.fee),factor=participation(p),zeroCall=SPOT*Math.exp(-dividend*tenor),upsideCost=(factor-1)*callPrice(SPOT,STRIKE,tenor,0,dividend,vol),available=Math.max(0,SPOT-zeroCall-fee);
    if(!hasBonus(p)){const total=upsideCost;return {zeroCall,available,upsideCost,protectionCost:0,totalFeatureCost:total,productValue:zeroCall+total,budgetUse:available?total/available:Infinity,steps:0}}
    const steps=Math.max(126,Math.round(DAYS*tenor)),dt=tenor/steps,u=Math.exp(vol*Math.sqrt(dt)),d=1/u,growth=Math.exp(-dividend*dt),prob=Math.max(0,Math.min(1,(growth-d)/(u-d))),discount=1,breached=new Float64Array(steps+1),alive=new Float64Array(steps+1),bonus=Number(p.bonus),barrier=Number(p.barrier);
    for(let j=0;j<=steps;j++){const level=SPOT*Math.pow(u,j)*Math.pow(d,steps-j),base=outperformance(level,p);breached[j]=base;alive[j]=level<=barrier?base:Math.max(bonus,base)}
    for(let i=steps-1;i>=0;i--)for(let j=0;j<=i;j++){const breachedValue=discount*(prob*breached[j+1]+(1-prob)*breached[j]),aliveValue=discount*(prob*alive[j+1]+(1-prob)*alive[j]);breached[j]=breachedValue;if(p.monitoring==="daily"){const level=SPOT*Math.pow(u,j)*Math.pow(d,i-j);alive[j]=level<=barrier?breachedValue:aliveValue}else alive[j]=aliveValue}
    const outperformanceValue=zeroCall+upsideCost,productValue=alive[0],protectionCost=Math.max(0,productValue-outperformanceValue),totalFeatureCost=upsideCost+protectionCost;
    return {zeroCall,available,upsideCost,protectionCost,totalFeatureCost,productValue,budgetUse:available?totalFeatureCost/available:Infinity,steps};
  }
  function simulate(p,seed=1,count=2000){
    const random=seeded(seed),steps=Math.max(2,Math.round(p.tenor*DAYS)),dt=1/DAYS,sigma=p.vol/100,drift=-.5*sigma*sigma*dt,shock=sigma*Math.sqrt(dt),returns=[];let breachedCount=0,floorCount=0,leveragedCount=0,total=0;
    for(let pathIndex=0;pathIndex<count;pathIndex++){
      let level=SPOT,breached=false;
      for(let day=1;day<=steps;day++){level=Math.max(.01,level*Math.exp(drift+shock*normal(random)));if(hasBonus(p)&&p.monitoring==="daily"&&level<=p.barrier)breached=true}
      if(hasBonus(p)&&p.monitoring==="maturity"&&level<=p.barrier)breached=true;const base=outperformance(level,p),payoff=redemption(level,breached,p),value=payoff-SPOT;returns.push(value);total+=value;breachedCount+=breached?1:0;floorCount+=hasBonus(p)&&!breached&&payoff>base+1e-8?1:0;leveragedCount+=level>STRIKE&&Math.abs(payoff-base)<1e-8?1:0;
    }
    returns.sort((a,b)=>a-b);return {count,returns,stats:{breached:breachedCount/count,floor:floorCount/count,leveraged:leveragedCount/count,averageReturn:total/count}};
  }
  const api={DAYS,SPOT,STRIKE,seeded,hasBonus,participation,outperformance,redemption,crossover,barrierState,pairedPaths,pairOutcomes,callPrice,budget,simulate};root.ParticipationEngine=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof self!=="undefined"?self:globalThis);
