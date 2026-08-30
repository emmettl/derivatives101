import { $, C, el, fmt, pct, rng, normals, bsCall, frame, ticks, statCards, histogram } from "../core";

(function(){
  let mode="plain", seed=24680;
  ["dc-c","dc-p","dc-b","dc-t","dc-v"].forEach(i=>$(i).oninput=run);
  document.querySelectorAll("#dc-type button").forEach(b=>b.onclick=()=>{
    document.querySelectorAll("#dc-type button").forEach(x=>x.classList.remove("on"));
    b.classList.add("on"); mode=b.dataset.v;
    $("dc-b-row").style.display = mode==="barrier" ? "" : "none";
    if(mode==="barrier")$("dc-p").value=88; else $("dc-p").value=84;
    run();});
  $("dc-run").onclick=()=>{seed=(seed*1103515245+12345)>>>0;run();};
  $("dc-b-row").style.display="none";

  function run(){
    const cap=+$("dc-c").value, px=+$("dc-p").value, bar=+$("dc-b").value,
          months=+$("dc-t").value, vol=+$("dc-v").value/100;
    $("dc-c-v").textContent=cap+"%"; $("dc-p-v").textContent=px+"%";
    $("dc-b-v").textContent=bar+"%"; $("dc-t-v").textContent=months;
    $("dc-v-v").textContent=(vol*100).toFixed(0)+"%";
    const isBar = mode==="barrier";

    /* redemption function, given whether the barrier survived */
    const redeem=(S,survived)=> isBar ? (survived ? cap : Math.min(S,cap)) : Math.min(S,cap);

    const lo=20, hi=Math.max(140,cap+30);
    const f=frame($("dc-pay"),{H:320,xr:[lo,hi],yr:[0,hi],
      xticks:ticks(lo,hi,6),xfmt:v=>v.toFixed(0),yticks:ticks(0,hi,5),yfmt:v=>v.toFixed(0),
      xlab:"Underlying at maturity, % of spot at issue"});
    f.line([[lo,lo],[hi,hi]],C.line,1.8,"5 4");                      // direct holding
    f.rect(lo,px,C.brick,0.07);
    f.vline(px,C.brick); f.vline(cap,C.steel);
    if(isBar){
      f.rect(lo,bar,C.brick,0.05); f.vline(bar,C.amberD);
      f.line([[bar,cap],[hi,cap]],C.jade,3.2);                       // barrier intact
      f.line([[lo,lo],[cap,cap]],C.deep,2.2,"3 3");                  // barrier broken
      f.line([[cap,cap],[hi,cap]],C.deep,2.2,"3 3");
      f.dot(bar,cap,C.jade);
      f.text(Math.min(hi-14,cap+22),cap+hi*0.07,"barrier intact: full cap",C.jade,10.5);
      f.text(lo+26,lo+hi*0.10,"barrier broken",C.deep,10.5);
    }else{
      f.line([[lo,lo],[cap,cap]],C.deep,3.2);
      f.line([[cap,cap],[hi,cap]],C.jade,3.2);
      f.dot(cap,cap,C.jade);
    }
    f.text(px,hi*0.96,"breakeven "+px,C.brick,10.5);
    f.text(cap,hi*0.05,"cap "+cap,C.steel,10.5);

    /* Monte Carlo */
    const paths=2000,r=rng(seed),steps=Math.max(1,Math.round(21*months)),
          dt=1/252,sd=vol*Math.sqrt(dt);
    const rets=[],direct=[]; let maxed=0,lost=0,beat=0,broke=0,sum=0;
    for(let i=0;i<paths;i++){
      let S=100,mn=100,z=[],zi=2;
      for(let d=1;d<=steps;d++){
        if(zi>1){z=normals(r);zi=0;}
        S*=Math.exp(-0.5*sd*sd+sd*z[zi++]);
        if(S<mn)mn=S;
      }
      const survived = !isBar || mn>=bar;
      if(isBar&&!survived)broke++;
      const red=redeem(S,survived);
      const ret=(red/px-1)*100, dir=S-100;
      rets.push(ret); direct.push(dir); sum+=ret;
      if(Math.abs(red-cap)<1e-9)maxed++;
      if(ret<0)lost++;
      if(ret>dir)beat++;
    }
    rets.sort((a,b)=>a-b);
    const q=t=>rets[Math.min(rets.length-1,Math.floor(t*rets.length))];
    const cards=[
      {v:pct(maxed/paths,0),l:"achieved the maximum return",c:C.jade},
      {v:pct(lost/paths,0),l:"lost money",c:C.brick},
      {v:pct(beat/paths,0),l:"beat a direct holding",c:C.deep},
      {v:fmt(sum/paths,1)+"%",l:"average return",c:C.ink}];
    if(isBar)cards.splice(2,0,{v:pct(broke/paths,0),l:"barrier breached",c:C.amberD});
    statCards($("dc-stats"),cards);

    const maxRet=(cap/px-1)*100;
    $("dc-terms").innerHTML=
      "<tr><td>Discount to spot</td><td>"+fmt(100-px,1)+" points</td></tr>"+
      "<tr><td>Maximum return</td><td>"+fmt(maxRet,1)+"%</td></tr>"+
      "<tr><td>Annualised maximum</td><td>"+fmt(maxRet*12/months,1)+"%</td></tr>"+
      "<tr><td>Distance to cap</td><td>"+fmt(cap-100,1)+" points</td></tr>";
    $("dc-read").innerHTML =
      "The most this can ever pay is <b>"+fmt(maxRet,1)+"%</b>, reached whenever the underlying finishes at or above "+
      (isBar?"the cap — or anywhere above the barrier, if the barrier survives":"the cap")+". "+
      (cap<100
        ? "Note that the cap is <b>below</b> today's spot, so there is no upside participation at all — this is bought for the buffer, not for the equity exposure. "
        : "")+
      "In these markets it beat a direct holding <b>"+pct(beat/paths,0)+"</b> of the time, and the worst 5% still returned <b>"+
      fmt(q(0.05),0)+"%</b>. The cushion is only "+fmt(100-px,0)+" points — small, but certain"+
      (isBar?", on top of a conditional barrier that is worth much more when it survives and nothing when it does not.":".");
  }
  run();
})();
