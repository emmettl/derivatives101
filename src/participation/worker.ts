import { simulate } from "./engine";
import type { ParticipationParams } from "./engine";

interface ParticipationSimulationRequest {
  id: number;
  params: ParticipationParams;
  seed: number;
  count: number;
}

self.onmessage = (event: MessageEvent<ParticipationSimulationRequest>) => {
  const { id, params, seed, count } = event.data;
  self.postMessage({ id, ...simulate(params, seed, count) });
};
