import { simulate } from "./engine";
import type { BasketParams } from "./engine";

interface BasketSimulationRequest {
  id: number;
  params: BasketParams;
  seed: number;
  count: number;
}

self.onmessage = (event: MessageEvent<BasketSimulationRequest>) => {
  const { id, params, seed, count } = event.data;
  self.postMessage({ id, ...simulate(params, seed, count) });
};
