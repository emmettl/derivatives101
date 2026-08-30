import { $, C, el, fmt, pct, rng, normals, bsCall, frame, ticks, statCards, histogram } from "../core";

(function(){
  let seed=555111;
  const ids=["fc-n","fc-r","fc-c","fc-k","fc-b","fc-a","fc-t","fc-v"];
  ids.forEach(i=>$(i).oninput=run);
  $("fc-run").onclick=()=>{seed=(seed*1103515245+12345)>>>0;run();};

  function simulate(nNames,rho,vol,months,strike,bar,ac,cpn,seedv){
    const paths=2000,r=rng(seedv),steps=Math.round(21*months),dt=1/252,sd=vol*Math.sqrt(dt);
    const a=Math.sqrt(rho), b2=Math.sqrt(1-rho);
    const rets=[]; let called=0,ki=0,lost=0,sum=0,lifeSum=0,deliv=0;
    for(let p=0;p<paths;p++){
      const S=new Array(nNames).fill(100), mn=new Array(nNames).fill(100);
      let z=[],zi=2,done=false,ret=0,life=months;
      for(let d=1;d<=steps;d++){
        if(zi>1){z=normals(r);zi=0;}
        const zc=z[zi++];
        for(let j=0;j<nNames;j++){
          if(zi>1){z=normals(r);zi=0;}
          const zj=a*zc+b2*z[zi++];
          S[j]*=Math.exp(-0.5*sd*sd+sd*zj);
          if(S[j]<mn[j])mn[j]=S[j];
        }
        if(d%21===0 && d>=21 && d<steps){
          let all=true; for(let j=0;j<nNames;j++)if(S[j]<ac)all=false;
          if(all){ret=cpn*(d/252)*100; life=d/21; called++; done=true; break;}
        }
      }
      if(!done){
        let worst=1e9,worstMin=1e9;
        for(let j=0;j<nNames;j++){if(S[j]<worst)worst=S[j]; if(mn[j]<worstMin)worstMin=mn[j];}
        const breached = worstMin<bar;
        const c=cpn*(months/12)*100;
        if(breached)ki++;
        if(breached && worst<strike){ret=(worst/strike)*100-100+c; deliv++;}
        else ret=c;
        life=months;
      }
      if(ret<0)lost++;
      rets.push(ret); sum+=ret; lifeSum+=life;
    }
    rets.sort((x,y)=>x-y);
    return {rets,called,ki,lost,deliv,mean:sum/paths,life:lifeSum/paths,paths};
  }

  function run(){
    const n=+$("fc-n").value, rho=+$("fc-r").value/100, cpn=+$("fc-c").value/100,
          k=+$("fc-k").value, b=+$("fc-b").value, ac=+$("fc-a").value,
          months=+$("fc-t").value, vol=+$("fc-v").value/100;
    $("fc-n-v").textContent=n; $("fc-r-v").textContent=fmt(rho,2);
    $("fc-c-v").textContent=fmt(cpn*100,1)+"%"; $("fc-k-v").textContent=k+"%";
    $("fc-b-v").textContent=b+"%"; $("fc-a-v").textContent=ac+"%";
    $("fc-t-v").textContent=months; $("fc-v-v").textContent=(vol*100).toFixed(0)+"%";

    const R=simulate(n,rho,vol,months,k,b,ac,cpn,seed);
    const q=p=>R.rets[Math.min(R.rets.length-1,Math.floor(p*R.rets.length))];
    statCards($("fc-stats"),[
      {v:pct(R.called/R.paths,0),l:"autocalled early",c:C.jade},
      {v:pct(R.ki/R.paths,0),l:"knocked in",c:C.amberD},
      {v:pct(R.deliv/R.paths,0),l:"settled in shares",c:C.brick},
      {v:pct(R.lost/R.paths,0),l:"lost money",c:C.brick},
      {v:fmt(R.mean,1),l:"average return per 100",c:C.ink}
    ]);
    const lo=Math.max(-100,q(0.002)-3), hi=Math.min(60,q(0.999)+3);
    histogram($("fc-hist"),R.rets,{lo:lo,hi:hi,split:0,bins:38,
      xfmt:v=>v.toFixed(0),xlab:"Total return per 100 invested over "+months+" months",
      title:"Distribution of outcomes across 2,000 simulated markets"});

    /* basket-size sweep at the current settings */
    const sweep=[];
    for(let m=1;m<=5;m++){
      const s=simulate(m,rho,vol,months,k,b,ac,cpn,seed);
      sweep.push([m,100*s.lost/s.paths,s.mean]);
    }
    const maxL=Math.max(20,Math.ceil(Math.max.apply(null,sweep.map(s=>s[1]))/10)*10+10);
    const f=frame($("fc-corr"),{H:260,xr:[0.4,5.6],yr:[0,maxL],
      xticks:[1,2,3,4,5],xfmt:v=>v+(v===1?" name":" names"),
      yticks:ticks(0,maxL,4),yfmt:v=>v.toFixed(0)+"%",
      xlab:"Names in the worst-of basket, holding every other term constant"});
    $("fc-corr").appendChild(el("text",{x:62,y:14,"font-size":12,"font-weight":700,fill:C.ink},
      "Probability of losing money, by basket size"));
    sweep.forEach(s=>{
      f.bar(s[0]-0.32,s[0]+0.32,0,s[1],s[0]===n?C.brick:C.steel,s[0]===n?0.95:0.45);
      f.text(s[0],s[1]+maxL*0.05,fmt(s[1],0)+"%",s[0]===n?C.brick:C.muted,11);
    });
    $("fc-read").innerHTML =
      "At "+fmt(cpn*100,1)+"% a year the coupon is <b>unconditional</b> — it is paid in every one of these markets. "+
      "The risk is entirely in the redemption: the note settled into shares <b>"+pct(R.deliv/R.paths,0)+
      "</b> of the time, and the worst 5% of markets returned <b>"+fmt(q(0.05),0)+" per 100</b>. "+
      "Adding names raises the loss probability from <b>"+fmt(sweep[0][1],0)+"%</b> with one name to <b>"+
      fmt(sweep[4][1],0)+"%</b> with five, at an unchanged coupon — which is exactly why the market typically pays more for a "+
      "bigger basket. Drop the correlation slider and watch it get worse still.";
  }
  run();
})();
