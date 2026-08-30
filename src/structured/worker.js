"use strict";

import { simulate } from "./engine.js";

self.onmessage = (event) => {
  const { id, mode, params, seed, count } = event.data;
  self.postMessage({ id, ...simulate(mode, params, seed, count) });
};
