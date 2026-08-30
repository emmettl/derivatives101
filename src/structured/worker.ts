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
  self.postMessage({ id, ...simulate(mode, params, seed, count) });
};
