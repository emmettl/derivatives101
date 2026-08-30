"use strict";

import { simulate } from "./engine.js";

self.onmessage = event => {
  const { id, params, seed, count } = event.data;
  self.postMessage({ id, ...simulate(params, seed, count) });
};
