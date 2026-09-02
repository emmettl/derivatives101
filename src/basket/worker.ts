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
  const result = simulate(params, seed, count);
  const comparisonStats =
    params.volModel === "downside-skew"
      ? simulate({ ...params, volModel: "flat" }, seed, count).stats
      : null;
  self.postMessage({ id, ...result, comparisonStats });
};
