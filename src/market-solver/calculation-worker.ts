import { calculateMarketSolver, type MarketSolverCalculationRequest } from "./calculation";

self.onmessage = (event: MessageEvent<MarketSolverCalculationRequest>) => {
  self.postMessage(calculateMarketSolver(event.data));
};
