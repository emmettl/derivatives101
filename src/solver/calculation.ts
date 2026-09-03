import { candidateBounds, priceAtCandidate, solveVariable } from "./engine";
import type { SolverInputs, SolverSolution } from "./engine";

export interface SolverChartSample {
  candidate: number;
  price: number;
}

export interface SolverBoundPrices {
  lower: number;
  upper: number;
}

export interface SolverCalculationRequest {
  id: number;
  inputs: SolverInputs;
  tolerance: number;
}

export interface SolverCalculationResult {
  id: number;
  solution: SolverSolution;
  minCandidate: number;
  maxCandidate: number;
  maxPrice: number;
  samples: SolverChartSample[];
  initialBoundPrices: SolverBoundPrices;
  retainedBoundPrices: SolverBoundPrices[];
}

export function calculateSolver(request: SolverCalculationRequest): SolverCalculationResult {
  const { id, inputs, tolerance } = request;
  const [minCandidate, maxCandidate] = candidateBounds(inputs);
  const solution = solveVariable(inputs, tolerance);
  const samples = Array.from({ length: 101 }, (_, index) => {
    const candidate = minCandidate + ((maxCandidate - minCandidate) * index) / 100;
    return { candidate, price: priceAtCandidate(inputs, candidate) };
  });
  const boundPrices = (lower: number, upper: number): SolverBoundPrices => ({
    lower: priceAtCandidate(inputs, lower),
    upper: priceAtCandidate(inputs, upper),
  });

  return {
    id,
    solution,
    minCandidate,
    maxCandidate,
    maxPrice: Math.max(inputs.target * 1.2, ...samples.map((point) => point.price)) * 1.04,
    samples,
    initialBoundPrices: boundPrices(minCandidate, maxCandidate),
    retainedBoundPrices: solution.steps.map((step) => boundPrices(step.nextLower, step.nextUpper)),
  };
}
