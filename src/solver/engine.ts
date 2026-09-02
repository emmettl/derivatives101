import { optionMetrics } from "../option-lab/math";
import type { OptionParams, OptionType } from "../option-lab/types";

export type SolveVariable = "strike" | "volatility" | "spot";

export interface SolverInputs extends OptionParams {
  target: number;
  type: OptionType;
  solveFor: SolveVariable;
}

export interface SolverStep {
  iteration: number;
  lower: number;
  upper: number;
  midpoint: number;
  price: number;
  error: number;
  nextLower: number;
  nextUpper: number;
  decision: string;
  converged: boolean;
}

export interface SolverSolution {
  steps: SolverStep[];
  value: number;
  price: number;
  converged: boolean;
}

export function candidateBounds(inputs: SolverInputs): [number, number] {
  if (inputs.solveFor === "volatility") return [0.01, 2];
  if (inputs.solveFor === "spot") return [Math.max(0.01, inputs.K * 0.2), inputs.K * 2.5];
  return [Math.max(0.01, inputs.S * 0.2), inputs.S * 2.5];
}

export function priceAtCandidate(inputs: SolverInputs, candidate: number): number {
  const { target: _target, type, solveFor, ...params } = inputs;
  if (solveFor === "strike") params.K = candidate;
  if (solveFor === "volatility") params.v = candidate;
  if (solveFor === "spot") params.S = candidate;
  return optionMetrics(params, type).price;
}

export function priceIncreasesWithCandidate(inputs: SolverInputs): boolean {
  if (inputs.solveFor === "volatility") return true;
  if (inputs.solveFor === "spot") return inputs.type === "call";
  return inputs.type === "put";
}

export function solveVariable(
  inputs: SolverInputs,
  tolerance = 0.005,
  maxIterations = 40,
): SolverSolution {
  let [lower, upper] = candidateBounds(inputs);
  const lowerPrice = priceAtCandidate(inputs, lower);
  const upperPrice = priceAtCandidate(inputs, upper);
  const minimum = Math.min(lowerPrice, upperPrice);
  const maximum = Math.max(lowerPrice, upperPrice);

  if (inputs.target < minimum || inputs.target > maximum) {
    return { steps: [], value: Number.NaN, price: Number.NaN, converged: false };
  }

  const increasing = priceIncreasesWithCandidate(inputs);
  const steps: SolverStep[] = [];
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const price = priceAtCandidate(inputs, midpoint);
    const error = price - inputs.target;
    const converged = Math.abs(error) <= tolerance;
    let nextLower = lower;
    let nextUpper = upper;

    if (!converged) {
      const candidateTooLow = increasing ? price < inputs.target : price > inputs.target;
      if (candidateTooLow) nextLower = midpoint;
      else nextUpper = midpoint;
    }

    const direction = price > inputs.target ? "above" : "below";
    const kept =
      nextLower === midpoint ? "upper half" : nextUpper === midpoint ? "lower half" : "answer";
    steps.push({
      iteration,
      lower,
      upper,
      midpoint,
      price,
      error,
      nextLower,
      nextUpper,
      decision: converged ? "Within tolerance" : `${direction} target · keep ${kept}`,
      converged,
    });

    if (converged) break;
    lower = nextLower;
    upper = nextUpper;
  }

  const last = steps.at(-1);
  return {
    steps,
    value: last?.midpoint ?? Number.NaN,
    price: last?.price ?? Number.NaN,
    converged: last?.converged ?? false,
  };
}
