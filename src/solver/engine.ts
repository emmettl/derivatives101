import { normCdf, optionMetrics } from "../option-lab/math";
import type { OptionParams, OptionType } from "../option-lab/types";

export type SolveVariable = "strike" | "volatility" | "spot" | "barrier";
export type BarrierStyle = "knock-in" | "knock-out";

export interface SolverInputs extends OptionParams {
  target: number;
  type: OptionType;
  solveFor: SolveVariable;
  barrierStyle: BarrierStyle;
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
  if (inputs.solveFor === "barrier") return [inputs.S * 0.4, inputs.S * 0.995];
  return [Math.max(0.01, inputs.S * 0.2), inputs.S * 2.5];
}

export function downBarrierPrice(
  { S, K, T, r, q, v }: OptionParams,
  type: OptionType,
  barrier: number,
  style: BarrierStyle,
): number {
  const vanilla = optionMetrics({ S, K, T, r, q, v }, type).price;
  const knockIn = downAndInPrice({ S, K, T, r, q, v }, type, barrier, vanilla);
  return style === "knock-in" ? knockIn : Math.max(0, vanilla - knockIn);
}

/**
 * Reiner-Rubinstein closed form for a continuously monitored down-and-in option
 * with no rebate. The knock-out value follows from in-out parity.
 */
function downAndInPrice(
  { S, K, T, r, q, v }: OptionParams,
  type: OptionType,
  barrier: number,
  vanilla: number,
): number {
  if (barrier >= S) return vanilla;
  if (barrier <= 0 || T <= 0 || v <= 0) return 0;

  const phi = type === "call" ? 1 : -1;
  const volatilityTime = v * Math.sqrt(T);
  const mu = (r - q - 0.5 * v * v) / (v * v);
  const shift = (1 + mu) * volatilityTime;
  const x1 = Math.log(S / K) / volatilityTime + shift;
  const x2 = Math.log(S / barrier) / volatilityTime + shift;
  const y1 = Math.log((barrier * barrier) / (S * K)) / volatilityTime + shift;
  const y2 = Math.log(barrier / S) / volatilityTime + shift;
  const discountedSpot = S * Math.exp(-q * T);
  const discountedStrike = K * Math.exp(-r * T);
  const spotWeight = Math.pow(barrier / S, 2 * (mu + 1));
  const strikeWeight = Math.pow(barrier / S, 2 * mu);

  const A =
    phi * discountedSpot * normCdf(phi * x1) -
    phi * discountedStrike * normCdf(phi * x1 - phi * volatilityTime);
  const B =
    phi * discountedSpot * normCdf(phi * x2) -
    phi * discountedStrike * normCdf(phi * x2 - phi * volatilityTime);
  const C =
    phi * discountedSpot * spotWeight * normCdf(y1) -
    phi * discountedStrike * strikeWeight * normCdf(y1 - volatilityTime);
  const D =
    phi * discountedSpot * spotWeight * normCdf(y2) -
    phi * discountedStrike * strikeWeight * normCdf(y2 - volatilityTime);

  const price = type === "call" ? (K > barrier ? C : A - B + D) : K > barrier ? B - C + D : A;
  return Math.max(0, Math.min(vanilla, price));
}

export function priceAtCandidate(inputs: SolverInputs, candidate: number): number {
  const { target: _target, type, solveFor, barrierStyle, ...params } = inputs;
  if (solveFor === "strike") params.K = candidate;
  if (solveFor === "volatility") params.v = candidate;
  if (solveFor === "spot") params.S = candidate;
  if (solveFor !== "barrier") return optionMetrics(params, type).price;
  return downBarrierPrice(params, type, candidate, barrierStyle);
}

export function priceIncreasesWithCandidate(inputs: SolverInputs): boolean {
  if (inputs.solveFor === "volatility") return true;
  if (inputs.solveFor === "spot") return inputs.type === "call";
  if (inputs.solveFor === "barrier") return inputs.barrierStyle === "knock-in";
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
