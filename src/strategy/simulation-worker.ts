import { simulateStrategy } from "./simulation";
import type { StrategySimulationRequest } from "./types";

self.onmessage = (event: MessageEvent<StrategySimulationRequest>) => {
  self.postMessage(simulateStrategy(event.data));
};
