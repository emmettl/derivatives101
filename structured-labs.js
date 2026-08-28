"use strict";

const $=id=>document.getElementById(id),mode=document.body.dataset.lab;
const colors={ink:"#0b1e2d",deep:"#123b54",steel:"#2c5670",amber:"#e4a340",amberD:"#a96f19",jade:"#3e8e7e",brick:"#b5443a",muted:"#64798a",line:"#d3dbe2",tint:"#f2f5f7"};
const configs={
  rc:{
    defaults:{variant:"barrier",coupon:8,barrier:65,barrierObservation:"daily",settlement:"physical",callLevel:100,callPolicy:"above",tenor:3,frequency:4,vol:30},
    variants:{
      plain:["Plain reverse convertible","No barrier condition: at maturity the investor receives 100 if the underlying is at or above the strike, otherwise the underlying level, plus fixed coupons."],
      barrier:["Barrier reverse convertible","The short-put downside is conditional. Principal falls with the underlying only if the barrier condition has occurred and the final level is below the strike."],
      issuer:["Issuer-callable barrier reverse convertible","Eligible dates give the issuer a right to redeem at par. The path does not determine that discretionary decision, so the simulation states an issuer policy explicitly."],
      autocall:["Autocallable barrier reverse convertible","At each eligible observation, redemption is automatic when the underlying meets the call trigger. The note ends and future coupons are not earned."]
    },
    scenarios:[["random","Random"],["rally","Rally & call"],["crash","Crash & recover"],["decline","Slow decline"]],
    controls:[
      {key:"variant",type:"select",label:"Lifecycle variant",options:[["plain","Plain · no barrier"],["barrier","Barrier"],["issuer","Issuer callable"],["autocall","Autocallable"]]},
      {key:"coupon",type:"range",label:"Fixed coupon",min:0,max:20,step:.5,format:v=>v.toFixed(1)+"% p.a."},
      {key:"barrier",type:"range",label:"Downside barrier",min:40,max:95,step:1,format:v=>v.toFixed(0)+"%",show:p=>p.variant!=="plain"},
      {key:"barrierObservation",type:"radio",label:"Barrier observation",options:[["maturity","Maturity only"],["daily","Daily close"]],show:p=>p.variant!=="plain"},
      {key:"settlement",type:"radio",label:"Downside settlement",options:[["cash","Cash amount"],["physical","Underlying units"]],help:"Physical delivery applies only when downside redemption is activated; par and early-call redemption remain cash."},
      {key:"callLevel",type:"range",label:"Early-redemption level",min:80,max:130,step:1,format:v=>v.toFixed(0)+"%",show:p=>p.variant==="issuer"||p.variant==="autocall"},
      {key:"callPolicy",type:"select",label:"Issuer exercise assumption",options:[["above","Exercise if level meets threshold"],["first","Exercise at first eligible date"],["never","Never exercise"]],show:p=>p.variant==="issuer",help:"This is a modelling assumption, not a contractual market trigger."},
      {key:"tenor",type:"range",label:"Scheduled tenor",min:1,max:5,step:1,format:v=>v.toFixed(0)+" years"},
      {key:"frequency",type:"select",numeric:true,label:"Observation frequency",options:[[4,"Quarterly"],[12,"Monthly"]]},
      {key:"vol",type:"range",label:"Annualised volatility",min:10,max:70,step:1,format:v=>v.toFixed(0)+"%"}
    ]
  },
  coupon:{
    defaults:{style:"memory",coupon:10,couponLevel:75,autocall:true,callLevel:100,barrier:60,settlement:"physical",tenor:3,frequency:4,vol:32},
    variants:{
      fixed:["Fixed coupon","Every scheduled coupon is paid while the note is alive. The underlying affects early redemption and final principal, but not the coupon test."],
      conditional:["Conditional coupon without memory","A coupon is paid only when the underlying meets the coupon level on that observation date. A failed coupon is permanently lost."],
      memory:["Conditional coupon with memory","A failed coupon increases the memory balance. When a later coupon test passes, the current coupon and the accumulated balance are paid together."]
    },
    scenarios:[["random","Random"],["memory","Miss & recover"],["rally","Early call"],["decline","Coupons missed"]],
    controls:[
      {key:"style",type:"select",label:"Coupon convention",options:[["fixed","Fixed"],["conditional","Conditional · no memory"],["memory","Conditional · memory"]]},
      {key:"coupon",type:"range",label:"Headline coupon",min:0,max:24,step:.5,format:v=>v.toFixed(1)+"% p.a."},
      {key:"couponLevel",type:"range",label:"Coupon trigger",min:40,max:100,step:1,format:v=>v.toFixed(0)+"%",show:p=>p.style!=="fixed"},
      {key:"autocall",type:"radio",label:"Early redemption",boolean:true,options:[[false,"No autocall"],[true,"Autocall"]]},
      {key:"callLevel",type:"range",label:"Autocall trigger",min:80,max:130,step:1,format:v=>v.toFixed(0)+"%",show:p=>p.autocall},
      {key:"barrier",type:"range",label:"European downside barrier",min:40,max:90,step:1,format:v=>v.toFixed(0)+"%"},
      {key:"settlement",type:"radio",label:"Downside settlement",options:[["cash","Cash amount"],["physical","Underlying units"]],help:"Physical delivery applies only below the maturity barrier. Coupons and any early redemption remain cash."},
      {key:"tenor",type:"range",label:"Scheduled tenor",min:1,max:5,step:1,format:v=>v.toFixed(0)+" years"},
      {key:"frequency",type:"select",numeric:true,label:"Coupon observations",options:[[4,"Quarterly"],[12,"Monthly"]]},
      {key:"vol",type:"range",label:"Annualised volatility",min:10,max:70,step:1,format:v=>v.toFixed(0)+"%"}
    ]
  },
  lock:{
    defaults:{style:"par",lockLevel:110,coupon:7,barrier:65,settlement:"physical",initialFloor:80,capture:80,tenor:4,frequency:4,vol:30},
    variants:{
      par:["Par lock-in","A qualifying observation raises the minimum principal redemption to 100. The note remains alive and continues paying its fixed coupon."],
      step:["Step-up minimum repayment","A qualifying observation can raise the maturity floor to a percentage of the observed underlying level. Final payment is the greater of that locked floor and final participation."]
    },
    scenarios:[["random","Random"],["lock","Lock then sell off"],["rally","Repeated lock-ins"],["decline","No lock-in"]],
    controls:[
      {key:"style",type:"select",label:"Lock-in convention",options:[["par","Par lock-in BRC"],["step","Step-up minimum repayment"]]},
      {key:"lockLevel",type:"range",label:"Lock-in trigger",min:95,max:140,step:1,format:v=>v.toFixed(0)+"%"},
      {key:"coupon",type:"range",label:"Fixed coupon",min:0,max:18,step:.5,format:v=>v.toFixed(1)+"% p.a.",show:p=>p.style==="par"},
      {key:"barrier",type:"range",label:"European downside barrier",min:40,max:90,step:1,format:v=>v.toFixed(0)+"%",show:p=>p.style==="par"},
      {key:"settlement",type:"radio",label:"Downside settlement",options:[["cash","Cash amount"],["physical","Underlying units"]],show:p=>p.style==="par",help:"Physical delivery is possible only if no par lock-in protects redemption and downside is activated."},
      {key:"initialFloor",type:"range",label:"Initial minimum payment",min:50,max:95,step:1,format:v=>v.toFixed(0)+"%",show:p=>p.style==="step"},
      {key:"capture",type:"range",label:"Lock-in factor",min:50,max:100,step:5,format:v=>v.toFixed(0)+"% of observed level",show:p=>p.style==="step",help:"A 120 observation with an 80% factor locks a minimum payment of 96."},
      {key:"tenor",type:"range",label:"Scheduled tenor",min:1,max:6,step:1,format:v=>v.toFixed(0)+" years"},
      {key:"frequency",type:"select",numeric:true,label:"Lock-in observations",options:[[1,"Annual"],[4,"Quarterly"],[12,"Monthly"]]},
      {key:"vol",type:"range",label:"Annualised volatility",min:10,max:70,step:1,format:v=>v.toFixed(0)+"%"}
    ]
  }
};
const config=configs[mode],state={params:{...config.defaults},scenario:config.scenarios[0][0],seed:904271,simulationVersion:0};

function svgEl(name,attrs={},text=""){const node=document.createElementNS("http://www.w3.org/2000/svg",name);Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,value));if(text)node.textContent=text;return node}
function money(value){return (value>=0?"":"−")+Math.abs(value).toFixed(1)}
function pct(value,d=0){return (value*100).toFixed(d)+"%"}
function year(day){const value=day/StructuredEngine.DAYS;return value<1?`Month ${Math.round(value*12)}`:`Year ${value.toFixed(value%1?2:0)}`}

function renderControls(){
  const host=$("controls");host.innerHTML="";
  config.controls.forEach(control=>{
    const block=document.createElement("div");block.className="control-block";block.dataset.control=control.key;
    if(control.type==="range"){
      const label=document.createElement("label");label.className="range-control";label.htmlFor=`control-${control.key}`;
      const head=document.createElement("span"),name=document.createElement("b"),output=document.createElement("output");name.textContent=control.label;output.id=`output-${control.key}`;head.append(name,output);
      const input=document.createElement("input");input.type="range";input.id=`control-${control.key}`;input.min=control.min;input.max=control.max;input.step=control.step;input.value=state.params[control.key];
      input.addEventListener("input",()=>{state.params[control.key]=Number(input.value);updateControlVisibility();renderAll()});label.append(head,input);block.append(label);
    }else if(control.type==="select"){
      const label=document.createElement("label");label.htmlFor=`control-${control.key}`;label.textContent=control.label;const select=document.createElement("select");select.id=`control-${control.key}`;
      control.options.forEach(([value,name])=>{const option=document.createElement("option");option.value=value;option.textContent=name;select.append(option)});select.value=String(state.params[control.key]);
      select.addEventListener("change",()=>{state.params[control.key]=control.numeric?Number(select.value):select.value;updateControlVisibility();renderAll()});block.append(label,select);
    }else{
      const title=document.createElement("span");title.className="control-title";title.textContent=control.label;const set=document.createElement("div");set.className="radio-set";
      control.options.forEach(([rawValue,name])=>{const button=document.createElement("button");button.type="button";const value=control.boolean?rawValue==="true"||rawValue===true:rawValue;button.textContent=name;button.classList.toggle("on",state.params[control.key]===value);button.setAttribute("aria-pressed",String(state.params[control.key]===value));button.addEventListener("click",()=>{state.params[control.key]=value;set.querySelectorAll("button").forEach(x=>{const on=x===button;x.classList.toggle("on",on);x.setAttribute("aria-pressed",String(on))});updateControlVisibility();renderAll()});set.append(button)});block.append(title,set);
    }
    if(control.help){const help=document.createElement("p");help.className="control-help";help.textContent=control.help;block.append(help)}host.append(block);
  });updateControlVisibility();updateOutputs();
}
function updateControlVisibility(){config.controls.forEach(control=>{const block=document.querySelector(`[data-control="${control.key}"]`);if(block)block.hidden=control.show?!control.show(state.params):false});updateOutputs()}
function updateOutputs(){config.controls.filter(x=>x.type==="range").forEach(control=>{const output=$(`output-${control.key}`);if(output)output.textContent=control.format(state.params[control.key])})}
function renderScenarios(){const host=$("scenarios");host.innerHTML="";config.scenarios.forEach(([value,label])=>{const button=document.createElement("button");button.type="button";button.textContent=label;const on=value===state.scenario;button.classList.toggle("on",on);button.setAttribute("aria-pressed",String(on));button.addEventListener("click",()=>{state.scenario=value;renderScenarios();renderPath()});host.append(button)})}
function variantKey(){return mode==="rc"?state.params.variant:state.params.style}
function updateVariant(){const [name,description]=config.variants[variantKey()];$("variant-name").textContent=name;$("variant-description").textContent=description}

function referenceLevels(p){
  const refs=[{level:100,label:"initial / strike",color:colors.muted,dash:"4 4"}];
  if(mode==="rc"){
    if(p.variant!=="plain")refs.push({level:p.barrier,label:"barrier",color:colors.brick,dash:"5 4"});
    if(p.variant==="issuer"||p.variant==="autocall")refs.push({level:p.callLevel,label:p.variant==="issuer"?"issuer threshold":"autocall",color:colors.jade,dash:"6 4"});
  }
  if(mode==="coupon"){
    refs.push({level:p.barrier,label:"downside barrier",color:colors.brick,dash:"5 4"});
    if(p.style!=="fixed")refs.push({level:p.couponLevel,label:"coupon trigger",color:colors.amberD,dash:"6 4"});
    if(p.autocall)refs.push({level:p.callLevel,label:"autocall",color:colors.jade,dash:"6 4"});
  }
  if(mode==="lock"){
    refs.push({level:p.lockLevel,label:"lock-in trigger",color:colors.jade,dash:"6 4"});
    if(p.style==="par")refs.push({level:p.barrier,label:"downside barrier",color:colors.brick,dash:"5 4"});
  }
  const grouped=[];refs.sort((a,b)=>a.level-b.level).forEach(ref=>{const match=grouped.find(x=>Math.abs(x.level-ref.level)<.5);if(match)match.label+=` / ${ref.label}`;else grouped.push({...ref})});return grouped;
}
function pathData(){const path=StructuredEngine.generatePath({seed:state.seed,tenor:state.params.tenor,vol:state.params.vol,scenario:state.scenario});return StructuredEngine.evaluate(mode,path,state.params)}
function pathD(path,start,end,X,Y){const span=Math.max(1,end-start),step=Math.max(1,Math.floor(span/420));let d="";for(let day=start;day<=end;day+=step)d+=(d?"L":"M")+X(day).toFixed(1)+","+Y(path[day]).toFixed(1);if((end-start)%step)d+="L"+X(end).toFixed(1)+","+Y(path[end]).toFixed(1);return d}
function importantEvent(event,result,index){
  if(event.state!=="Alive")return {label:event.state==="Redeemed early"?(result.callKind||"Redeemed"):"Maturity",color:event.state==="Redeemed early"?colors.jade:colors.ink};
  if(mode==="rc"&&event.barrierNew)return {label:"Barrier breached",color:colors.brick};
  if(mode==="coupon"&&event.memoryRecovered>0)return {label:"Memory paid",color:colors.jade};
  if(mode==="coupon"&&event.couponTest==="Miss"&&index<5)return {label:"Coupon missed",color:colors.brick};
  if(mode==="lock"&&event.lockChanged)return {label:"New floor",color:colors.jade};return null;
}
function drawPath(result){
  const svg=$("path-chart");svg.innerHTML="";const path=result.path,end=path.length-1,refs=referenceLevels(state.params),values=Array.from(path),min=Math.max(0,Math.min(...values,...refs.map(x=>x.level))-10),max=Math.max(...values,...refs.map(x=>x.level))+10;
  const m={l:54,r:112,t:24,b:38},w=900,h=360,X=day=>m.l+day/end*(w-m.l-m.r),Y=value=>m.t+(max-value)/(max-min)*(h-m.t-m.b);
  for(let i=0;i<=4;i++){const value=min+(max-min)*i/4,y=Y(value);svg.append(svgEl("line",{x1:m.l,x2:w-m.r,y1:y,y2:y,class:"grid"}),svgEl("text",{x:m.l-8,y:y+3,"text-anchor":"end",class:"axis"},value.toFixed(0)+"%"))}
  for(let yearIndex=0;yearIndex<=state.params.tenor;yearIndex++){const day=Math.round(yearIndex*StructuredEngine.DAYS),x=X(day);svg.append(svgEl("line",{x1:x,x2:x,y1:m.t,y2:h-m.b,class:"grid"}),svgEl("text",{x,y:h-15,"text-anchor":"middle",class:"axis"},yearIndex?`Y${yearIndex}`:"Start"))}
  refs.forEach(ref=>{const y=Y(ref.level);svg.append(svgEl("line",{x1:m.l,x2:w-m.r,y1:y,y2:y,stroke:ref.color,"stroke-width":1.2,"stroke-dasharray":ref.dash}),svgEl("text",{x:w-m.r+7,y:y+3,fill:ref.color,class:"level-label"},`${ref.label} ${ref.level.toFixed(0)}`))});
  result.events.forEach(event=>svg.append(svgEl("line",{x1:X(event.day),x2:X(event.day),y1:m.t,y2:h-m.b,stroke:colors.line,"stroke-width":.8,"stroke-opacity":.42})));
  svg.append(svgEl("path",{d:pathD(path,0,result.terminationDay,X,Y),class:"path-main"}));if(result.terminationDay<end)svg.append(svgEl("path",{d:pathD(path,result.terminationDay,end,X,Y),class:"path-after"}));
  let labelIndex=0;result.events.forEach((event,index)=>{const x=X(event.day),y=Y(event.level),important=importantEvent(event,result,index);svg.append(svgEl("circle",{cx:x,cy:y,r:important?5:3,class:important?"event-dot":"observation",fill:important?important.color:"#fff"}));if(important&&labelIndex<8){const dy=labelIndex++%2?-13:18,anchor=x>w-210?"end":"start",tx=x>w-210?x-7:x+7;svg.append(svgEl("text",{x:tx,y:y+dy,"text-anchor":anchor,class:"event-label"},important.label))}});
  svg.append(svgEl("text",{x:(m.l+w-m.r)/2,y:h-2,"text-anchor":"middle",class:"axis"},"Time from issue"));svg.setAttribute("aria-label",`Underlying path from 100 to ${result.finalLevel.toFixed(1)}; ${result.called?result.callKind+" after "+result.life.toFixed(1)+" years":"held to maturity"}`);
}
function outcomeText(result){
  if(mode==="rc"){
    if(result.called)return `${result.callKind} occurred after ${result.life.toFixed(2)} years. The investor receives cash principal 100 and ${result.coupons.toFixed(1)} of cash coupons: total return ${money(result.totalReturn)} per 100 invested.`;
    if(state.params.variant==="plain"&&result.finalLevel<100)return `There is no barrier test. The final level ${result.finalLevel.toFixed(1)} determines redemption directly. The investor receives ${result.physicalDelivery?`1.000 underlying unit worth ${result.deliveryValue.toFixed(1)}`:`cash principal ${result.cashPrincipal.toFixed(1)}`}, plus ${result.coupons.toFixed(1)} of cash coupons.`;
    if(result.barrierBreached&&result.finalLevel<100)return `The barrier condition occurred and the final level is below the strike. The investor receives ${result.physicalDelivery?`1.000 underlying unit worth ${result.deliveryValue.toFixed(1)}`:`cash principal ${result.cashPrincipal.toFixed(1)}`}, plus ${result.coupons.toFixed(1)} of cash coupons.`;
    return `The note reaches maturity with cash principal 100 and ${result.coupons.toFixed(1)} of cash coupons. ${result.barrierBreached?"The barrier was breached, but the final level recovered above the strike.":"The downside condition never activated."}`;
  }
  if(mode==="coupon"){
    const couponState=state.params.style==="fixed"?"Every scheduled coupon while the note was alive was paid.":state.params.style==="conditional"?`${result.missed} failed coupon${result.missed===1?" was":"s were"} permanently lost.`:result.memoryUnpaid?`${result.memoryUnpaid} coupon period${result.memoryUnpaid===1?" remains":"s remain"} unpaid in memory.`:"No memory balance remains.";
    const redemption=result.physicalDelivery?`1.000 underlying unit worth ${result.deliveryValue.toFixed(1)}`:`cash principal ${result.cashPrincipal.toFixed(1)}`;
    return `${result.called?`The note autocalled after ${result.life.toFixed(2)} years.`:"The note reached maturity."} Cash coupons actually paid total ${result.coupons.toFixed(1)}. ${couponState} The investor receives ${redemption}.`;
  }
  const redemption=result.physicalDelivery?`1.000 underlying unit worth ${result.deliveryValue.toFixed(1)}`:`cash principal ${result.cashPrincipal.toFixed(1)}`;
  return `${result.lockCount?`${result.lockCount} lock-in event${result.lockCount===1?"":"s"} raised the floor to ${result.lockedFloor.toFixed(1)}.`:state.params.style==="par"?"No observation established a lock-in floor.":"No observation improved the initial floor."} Final underlying level is ${result.finalLevel.toFixed(1)}. The investor receives ${redemption}${state.params.style==="par"?`, plus ${result.coupons.toFixed(1)} of cash coupons`:""}.`;
}
function renderSettlement(result){
  const host=$("settlement-breakdown"),cashReceived=result.cashPrincipal+result.coupons,packageValue=cashReceived+result.deliveryValue;
  const items=[
    ["Cash received",cashReceived.toFixed(1),`Coupons ${result.coupons.toFixed(2)} + cash principal ${result.cashPrincipal.toFixed(1)}`],
    ["Assets delivered",result.physicalDelivery?`${result.deliveredUnits.toFixed(3)} unit`:"None",result.physicalDelivery?`Underlying value ${result.deliveryValue.toFixed(1)} · 100 nominal ÷ strike 100`:result.settlement==="physical"?"Physical downside delivery was not triggered":"Cash settlement applies"],
    ["Package value",packageValue.toFixed(1),"Cash plus delivered assets per 100 nominal"]
  ];
  host.innerHTML="";items.forEach(([label,value,detail])=>{const item=document.createElement("div"),small=document.createElement("span"),strong=document.createElement("strong"),p=document.createElement("p");small.textContent=label;strong.textContent=value;p.textContent=detail;item.append(small,strong,p);host.append(item)});
  host.setAttribute("aria-label",`Settlement: cash ${cashReceived.toFixed(1)}, ${result.physicalDelivery?result.deliveredUnits.toFixed(3)+" underlying unit delivered":"no assets delivered"}, package value ${packageValue.toFixed(1)} per 100 nominal`);
}
function renderLedger(result){
  const body=$("ledger-body"),total=$("ledger-total");body.innerHTML="";total.innerHTML="";result.events.forEach(event=>{const row=document.createElement("tr"),cells=[];
    if(mode==="rc")cells.push(year(event.day),event.level.toFixed(1),state.params.variant==="plain"?"Not applicable":event.barrierState?"Breached":"Clear",event.coupon.toFixed(2),event.decision,event.state);
    if(mode==="coupon")cells.push(year(event.day),event.level.toFixed(1),event.couponTest,event.coupon.toFixed(2),String(event.memoryBank),event.decision);
    if(mode==="lock")cells.push(year(event.day),event.level.toFixed(1),event.lockChanged?"Passed":"No new lock",event.lockedFloor.toFixed(1),event.coupon.toFixed(2),event.state);
    cells.forEach((value,index)=>{const cell=document.createElement("td");cell.textContent=value;if(/Breached|Miss|Redeemed|No new/.test(value))cell.className="event-negative";if(/Clear|Pass|New floor|Autocall|exercises/.test(value))cell.className="event-positive";if(index===0)cell.className="event-neutral";row.append(cell)});body.append(row)
  });
  const first=document.createElement("th");first.scope="row";first.textContent="Totals";total.append(first);
  const endingLevel=result.events.at(-1)?.level??result.finalLevel;let cells;
  if(mode==="rc")cells=[`${result.events.length} observations · end ${endingLevel.toFixed(1)}`,state.params.variant==="plain"?"Not applicable":result.barrierBreached?"Breached":"Clear",result.coupons.toFixed(2),result.called?result.callKind:"No early redemption",result.physicalDelivery?`1.000 unit · value ${result.deliveryValue.toFixed(1)}`:`Cash principal ${result.cashPrincipal.toFixed(1)}`];
  if(mode==="coupon"){
    const passed=result.events.filter(event=>event.couponTest==="Pass").length;
    const tests=state.params.style==="fixed"?`${result.events.length} unconditional`:`${passed} passed · ${result.missed} missed`;
    const memory=state.params.style==="memory"?`${result.memoryUnpaid} unpaid`:"Not applicable";
    cells=[`${result.events.length} observations · end ${endingLevel.toFixed(1)}`,tests,result.coupons.toFixed(2),memory,result.called?"Autocalled":"Reached maturity"];
  }
  if(mode==="lock")cells=[`${result.events.length} observations · end ${endingLevel.toFixed(1)}`,`${result.lockCount} new floor${result.lockCount===1?"":"s"}`,state.params.style==="par"&&!result.lockCount?"Not established":result.lockedFloor.toFixed(1),result.coupons.toFixed(2),result.physicalDelivery?`1.000 unit · value ${result.deliveryValue.toFixed(1)}`:`Cash principal ${result.cashPrincipal.toFixed(1)}`];
  cells.forEach(value=>{const cell=document.createElement("td");cell.textContent=value;total.append(cell)});
}
function renderRules(){const steps=mode==="rc"?["Observe level","Update barrier state","Pay fixed coupon",state.params.variant==="issuer"?"Issuer decides":state.params.variant==="autocall"?"Test autocall":"Continue","Determine redemption","Settle cash / units"]:mode==="coupon"?["Observe level","Test current coupon","Update / pay memory","Test autocall","Determine redemption","Settle cash / units"]:["Observe level","Test lock-in","Raise floor if eligible","Continue note","Compare maturity payoffs","Settle cash / units"];
  const host=$("rule-strip");host.innerHTML="<b>Illustrative order</b>";steps.forEach(step=>{const arrow=document.createElement("i");arrow.textContent="→";const span=document.createElement("span");span.textContent=step;host.append(arrow,span)});
}
function renderPath(){updateVariant();updateOutputs();const result=pathData();drawPath(result);$("path-outcome").textContent=outcomeText(result);renderSettlement(result);renderLedger(result);renderRules();scheduleSimulation()}

function statDefinitions(stats){
  if(mode==="rc")return [{label:state.params.variant==="issuer"?"Called under policy":"Redeemed early",value:pct(stats.called)},{label:"Barrier condition",value:state.params.variant==="plain"?"None":pct(stats.barrier)},{label:"Lost money",value:pct(stats.loss)},{label:"Average life",value:stats.averageLife.toFixed(2)+" yr"}];
  if(mode==="coupon")return [{label:"Average coupons paid",value:stats.averageCoupons.toFixed(1)},{label:"Missed observations",value:stats.averageMissed.toFixed(1)},{label:"Memory recovered",value:stats.averageRecovered.toFixed(1)},{label:"Autocalled",value:state.params.autocall?pct(stats.called):"Off"}];
  return [{label:"Any lock-in",value:pct(stats.locked)},{label:"Floor when locked",value:stats.locked?stats.averageLockFloorWhenLocked.toFixed(1):"—"},{label:"Lost money",value:pct(stats.loss)},{label:"Average return",value:money(stats.averageReturn)}];
}
function drawHistogram(returns){
  const svg=$("histogram");svg.innerHTML="";const n=36,lo=returns[0],hi=returns.at(-1),span=Math.max(1,hi-lo),counts=new Array(n).fill(0);returns.forEach(value=>counts[Math.min(n-1,Math.floor((value-lo)/span*n))]++);const max=Math.max(...counts),m={l:50,r:20,t:18,b:38},w=900,h=210,X=value=>m.l+(value-lo)/span*(w-m.l-m.r),Y=count=>m.t+(max-count)/max*(h-m.t-m.b),barW=(w-m.l-m.r)/n;
  [0,.5,1].forEach(t=>{const count=max*t,y=Y(count);svg.append(svgEl("line",{x1:m.l,x2:w-m.r,y1:y,y2:y,class:"grid"}))});
  counts.forEach((count,index)=>{const midpoint=lo+(index+.5)/n*span;svg.append(svgEl("rect",{x:m.l+index*barW+.7,y:Y(count),width:Math.max(1,barW-1.4),height:h-m.b-Y(count),fill:midpoint<0?colors.brick:colors.jade,opacity:.7}))});
  if(lo<0&&hi>0)svg.append(svgEl("line",{x1:X(0),x2:X(0),y1:m.t,y2:h-m.b,stroke:colors.ink,"stroke-width":1.3}));
  for(let i=0;i<=4;i++){const value=lo+span*i/4,x=X(value);svg.append(svgEl("text",{x,y:h-16,"text-anchor":"middle",class:"axis"},money(value)))}svg.append(svgEl("text",{x:(m.l+w-m.r)/2,y:h-2,"text-anchor":"middle",class:"axis"},"Total return per 100 invested"));
}
let simulationTimer,simulationVersion=0;const simulationWorker=typeof Worker!=="undefined"?new Worker("structured-worker.js?v=3"):null;
function finishSimulation(message){if(message.id!==simulationVersion)return;const statsHost=$("stats");statsHost.innerHTML="";statDefinitions(message.stats).forEach(item=>{const card=document.createElement("div");card.className="stat";const label=document.createElement("span"),value=document.createElement("strong");label.textContent=item.label;value.textContent=item.value;card.append(label,value);statsHost.append(card)});drawHistogram(Array.from(message.returns));$("simulation-status").textContent=`Current · ${message.count.toLocaleString()} paths · zero-drift lognormal illustration`}
function scheduleSimulation(){const id=++simulationVersion;clearTimeout(simulationTimer);$("simulation-status").textContent="Updating simulated outcomes…";simulationTimer=setTimeout(()=>{const payload={id,mode,params:{...state.params},seed:state.seed,count:2000};if(simulationWorker)simulationWorker.postMessage(payload);else setTimeout(()=>finishSimulation({id,...StructuredEngine.simulate(mode,payload.params,payload.seed,payload.count)}),0)},140)}
if(simulationWorker)simulationWorker.onmessage=event=>finishSimulation(event.data);
function renderAll(){renderPath()}

$("resample").addEventListener("click",()=>{const buffer=new Uint32Array(1);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(buffer);state.seed=buffer[0]||((state.seed*1664525+1013904223)>>>0)||1;state.scenario="random";renderScenarios();renderPath()});
$("reset").addEventListener("click",()=>{state.params={...config.defaults};state.scenario=config.scenarios[0][0];state.seed=904271;renderControls();renderScenarios();renderAll()});
renderControls();renderScenarios();renderAll();
