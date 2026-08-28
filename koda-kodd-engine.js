"use strict";

(function(root){
  const DAYS=252;

  function seeded(seed){let state=seed>>>0||1;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/4294967296}}
  function normal(random){let u=0,v=0;while(!u)u=random();while(!v)v=random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
  function observationDays(tenor,frequency){const end=Math.round(tenor*DAYS),count=Math.max(1,Math.round(tenor*frequency));return Array.from({length:count},(_,index)=>Math.min(end,Math.round((index+1)*end/count)))}
  function interpolate(anchors,t){for(let i=1;i<anchors.length;i++)if(t<=anchors[i][0]){const [t0,a]=anchors[i-1],[t1,b]=anchors[i],weight=(t-t0)/(t1-t0);return a+(b-a)*weight}return anchors.at(-1)[1]}

  function scenarioAnchors(p,scenario){
    const koda=p.kind==="koda",adverse=koda?-1:1,favourable=-adverse,strike=Number(p.strike),knockOut=Number(p.knockOut);
    if(scenario==="knockout")return [[0,100],[.2,knockOut+favourable*3],[1,knockOut+favourable*12]];
    if(scenario==="recover")return [[0,100],[.3,strike+adverse*8],[.66,strike-adverse*5],[1,100]];
    if(scenario==="geared")return [[0,100],[.2,strike+adverse*5],[1,koda?Math.max(10,strike-38):strike+48]];
    return [[0,100],[.22,(100+strike)/2],[.48,strike+adverse*2],[.72,100],[1,(100+strike)/2]];
  }

  function generatePath({seed=1,scenario="random",...p}){
    const random=seeded(seed),end=Math.round(p.tenor*DAYS),path=new Float64Array(end+1);path[0]=100;
    if(scenario!=="random"){
      const anchors=scenarioAnchors(p,scenario);let noise=0;
      for(let day=1;day<=end;day++){noise=.92*noise+normal(random)*(p.vol/100)*.18;path[day]=Math.max(.1,interpolate(anchors,day/end)*Math.exp(noise/100))}
      return path;
    }
    const sigma=p.vol/100,dt=1/DAYS,drift=-.5*sigma*sigma*dt,shock=sigma*Math.sqrt(dt);
    for(let day=1;day<=end;day++)path[day]=Math.max(.1,path[day-1]*Math.exp(drift+shock*normal(random)));
    return path;
  }

  function isKnockOut(spot,p){return p.kind==="koda"?spot>=p.knockOut:spot<=p.knockOut}
  function isAdverse(spot,p){return p.kind==="koda"?spot<p.strike:spot>p.strike}

  function evaluate(path,p){
    const observations=observationDays(p.tenor,p.frequency),guaranteed=Math.min(observations.length,Math.max(0,Math.round(p.guaranteed||0))),events=[];
    let knockedOut=false,knockOutDay=null,knockOutIndex=null,totalUnits=0,totalCash=0,gearedFixings=0;
    for(let index=0;index<observations.length;index++){
      if(knockedOut&&index>=guaranteed)break;
      const day=observations[index],spot=path[day],hit=isKnockOut(spot,p),firstHit=hit&&!knockedOut;
      if(firstHit){knockedOut=true;knockOutDay=day;knockOutIndex=index}
      const protectedObservation=index<guaranteed,execute=!knockedOut||protectedObservation,geared=execute&&!knockedOut&&isAdverse(spot,p),quantity=execute*p.baseUnits*(geared?p.gearing:1),cash=quantity*p.strike;
      if(geared)gearedFixings++;totalUnits+=quantity;totalCash+=cash;
      let status="Base trade";
      if(firstHit&&protectedObservation)status="KO; guarantee continues";else if(firstHit)status="Knocked out";else if(knockedOut&&protectedObservation)status="Guaranteed continuation";else if(geared)status="Geared trade";
      events.push({index,day,spot,knockOutTest:hit?"Hit":"No hit",sizeTest:execute?(geared?`${p.gearing.toFixed(1)}× geared`:"1× base"):"No trade",quantity,cash,cumulativeUnits:totalUnits,status,geared,executed:execute,guaranteed:protectedObservation});
    }
    const terminationDay=knockedOut?events.at(-1).day:observations.at(-1),valuationSpot=path[terminationDay],marketValue=totalUnits*valuationSpot;
    const pnl=p.kind==="koda"?marketValue-totalCash:totalCash-marketValue,baseNotional=p.baseUnits*observations.length*p.strike,pnlPercent=baseNotional?pnl/baseNotional*100:0;
    return {path,observations,events,knockedOut,knockOutDay,knockOutIndex,terminationDay,valuationSpot,totalUnits,totalCash,marketValue,pnl,pnlPercent,baseNotional,maxUnits:p.baseUnits*observations.length*p.gearing,gearedFixings,executedFixings:events.filter(event=>event.executed).length,life:terminationDay/DAYS};
  }

  function average(values){return values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length)}
  function simulate(p,seed=1,count=2000){
    const returns=[];let knockedOut=0,geared=0,units=0,life=0;
    for(let index=0;index<count;index++){
      const path=generatePath({...p,scenario:"random",seed:(seed+index*2654435761)>>>0}),result=evaluate(path,p);returns.push(result.pnlPercent);knockedOut+=result.knockedOut?1:0;geared+=result.gearedFixings>0?1:0;units+=result.totalUnits;life+=result.life;
    }
    returns.sort((a,b)=>a-b);
    return {count,returns,stats:{knockOutRate:knockedOut/count,gearedRate:geared/count,averageUnits:units/count,averageLife:life/count,averagePnl:average(returns)}};
  }

  const api={DAYS,seeded,observationDays,generatePath,isKnockOut,isAdverse,evaluate,simulate};
  root.KodaKoddEngine=api;if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof self!=="undefined"?self:globalThis);
