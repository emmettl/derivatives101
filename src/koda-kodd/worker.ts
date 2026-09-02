import { simulate } from "./engine";
import type { KodaParams } from "./engine";

interface KodaSimulationRequest {
  id: number;
  params: KodaParams;
  seed: number;
  count: number;
}

self.onmessage = (event: MessageEvent<KodaSimulationRequest>) => {
  const { id, params, seed, count } = event.data;
  const result = simulate(params, seed, count);
  const comparisonStats =
    params.volModel === "downside-skew"
      ? simulate({ ...params, volModel: "flat" }, seed, count).stats
      : null;
  self.postMessage({ id, ...result, comparisonStats });
};
