"use strict";
importScripts("koda-kodd-engine.js?v=1");
self.onmessage=event=>{const {id,params,seed,count}=event.data;self.postMessage({id,...KodaKoddEngine.simulate(params,seed,count)})};
