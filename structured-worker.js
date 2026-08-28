"use strict";

importScripts("structured-engine.js?v=3");

self.onmessage=event=>{
  const {id,mode,params,seed,count}=event.data,result=StructuredEngine.simulate(mode,params,seed,count);
  self.postMessage({id,...result});
};
