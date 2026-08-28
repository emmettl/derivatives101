"use strict";
importScripts("basket-engine.js?v=1");
self.onmessage=event=>{const {id,params,seed,count}=event.data;self.postMessage({id,...BasketEngine.simulate(params,seed,count)})};
