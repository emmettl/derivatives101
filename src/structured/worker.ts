import { simulate } from "./engine";
import type { StructuredMode, StructuredParams } from "./engine";

interface StructuredSimulationRequest {
  id: number;
  mode: StructuredMode;
  params: StructuredParams;
  seed: number;
  count: number;
}

self.onmessage = (event: MessageEvent<StructuredSimulationRequest>) => {
  const { id, mode, params, seed, count } = event.data;
  const result = simulate(mode, params, seed, count);
  const comparisonStats =
    params.volModel === "downside-skew"
      ? simulate(mode, { ...params, volModel: "flat" }, seed, count).stats
      : null;
  self.postMessage({ id, ...result, comparisonStats });
};
