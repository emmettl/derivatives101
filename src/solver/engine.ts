import { optionMetrics } from "../option-lab/math";
import type { OptionParams, OptionType } from "../option-lab/types";

export interface StrikeSolveInputs extends Omit<OptionParams, "K"> {
  target: number;
  type: OptionType;
}

export interface StrikeSolveStep {
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

export interface StrikeSolution {
  steps: StrikeSolveStep[];
  strike: number;
  price: number;
  converged: boolean;
}

export function priceAtStrike(inputs: StrikeSolveInputs, strike: number): number {
  const { target: _target, type, ...params } = inputs;
  return optionMetrics({ ...params, K: strike }, type).price;
}

export function solveStrike(
  inputs: StrikeSolveInputs,
  tolerance = 0.005,
  maxIterations = 32,
): StrikeSolution {
  let lower = Math.max(0.01, inputs.S * 0.2);
  let upper = inputs.S * 2.5;
  const lowerPrice = priceAtStrike(inputs, lower);
  const upperPrice = priceAtStrike(inputs, upper);
  const minimum = Math.min(lowerPrice, upperPrice);
  const maximum = Math.max(lowerPrice, upperPrice);

  if (inputs.target < minimum || inputs.target > maximum) {
    return { steps: [], strike: Number.NaN, price: Number.NaN, converged: false };
  }

  const steps: StrikeSolveStep[] = [];
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const price = priceAtStrike(inputs, midpoint);
    const error = price - inputs.target;
    const converged = Math.abs(error) <= tolerance;
    let nextLower = lower;
    let nextUpper = upper;

    if (!converged) {
      if (inputs.type === "call") {
        if (price > inputs.target) nextLower = midpoint;
        else nextUpper = midpoint;
      } else if (price < inputs.target) {
        nextLower = midpoint;
      } else {
        nextUpper = midpoint;
      }
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
    strike: last?.midpoint ?? Number.NaN,
    price: last?.price ?? Number.NaN,
    converged: last?.converged ?? false,
  };
}
