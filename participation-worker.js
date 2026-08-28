"use strict";
importScripts("participation-engine.js?v=1");
self.onmessage=event=>{const {id,params,seed,count}=event.data;self.postMessage({id,...ParticipationEngine.simulate(params,seed,count)})};
