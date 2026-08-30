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
  self.postMessage({ id, ...simulate(params, seed, count) });
};
