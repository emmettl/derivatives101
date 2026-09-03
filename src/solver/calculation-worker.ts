import { calculateSolver } from "./calculation";
import type { SolverCalculationRequest } from "./calculation";

self.onmessage = (event: MessageEvent<SolverCalculationRequest>) => {
  self.postMessage(calculateSolver(event.data));
};
