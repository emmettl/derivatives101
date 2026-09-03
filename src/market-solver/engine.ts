import { optionMetrics } from "../option-lab/math";
import { normalRandom, seededRandom } from "../shared/simulation";
import { downBarrierPrice } from "../solver/engine";
import {
  atmVolatility,
  discountFactor,
  impliedVolatility,
  smileFunction,
  zeroRate,
  type CurveSnapshot,
  type UnderlyingSnapshot,
  type VolatilityModel,
} from "./snapshot";

export interface MarketContext {
  underlying: UnderlyingSnapshot;
  curve: CurveSnapshot;
  /** Issuer funding spread over the zero curve, decimal per annum. */
  fundingSpread: number;
  volModel: VolatilityModel;
}

/** Present value, on the issuer funding curve, of 1% per annum paid in arrears. */
export function couponAnnuity(
  curve: CurveSnapshot,
  spread: number,
  tenor: number,
  frequency: number,
): number {
  const periods = Math.max(1, Math.round(tenor * frequency));
  let annuity = 0;
  for (let index = 1; index <= periods; index += 1)
    annuity += discountFactor(curve, index / frequency, spread) / frequency;
  return annuity;
}

// ---------------------------------------------------------------------------
// Capital-protected note: zero-coupon floor plus a call or call spread.

export interface ProtectedNoteTerms {
  tenor: number;
  /** Protected redemption as a percentage of notional. */
  protection: number;
  /** Call strike as a percentage of the initial level. */
  strike: number;
  /** Cap as a percentage of the initial level, or null for uncapped upside. */
  cap: number | null;
  /** Upfront fee as a percentage of notional. */
  fee: number;
}

export interface ProtectedNoteValuation {
  bondFloor: number;
  budget: number;
  optionCost: number;
  strikeVolatility: number;
  capVolatility: number | null;
  /** Participation rate as a percentage. */
  participation: number;
  fundingRate: number;
}

export function priceProtectedNote(
  context: MarketContext,
  terms: ProtectedNoteTerms,
): ProtectedNoteValuation {
  const { underlying, curve } = context;
  const T = terms.tenor;
  const r = zeroRate(curve, T);
  const q = underlying.dividendYield;
  const call = (strike: number, volatility: number) =>
    optionMetrics({ S: 100, K: strike, T, r, q, v: volatility }, "call").price;

  const strikeVolatility = impliedVolatility(underlying, T, terms.strike / 100, context.volModel);
  let optionCost = call(terms.strike, strikeVolatility);
  let capVolatility: number | null = null;
  if (terms.cap !== null && terms.cap > terms.strike) {
    capVolatility = impliedVolatility(underlying, T, terms.cap / 100, context.volModel);
    optionCost -= call(terms.cap, capVolatility);
  }

  const bondFloor = terms.protection * discountFactor(curve, T, context.fundingSpread);
  const budget = 100 - bondFloor - terms.fee;
  const participation = optionCost > 1e-9 ? (Math.max(0, budget) / optionCost) * 100 : 0;
  return {
    bondFloor,
    budget,
    optionCost,
    strikeVolatility,
    capVolatility,
    participation,
    fundingRate: r + context.fundingSpread,
  };
}

// ---------------------------------------------------------------------------
// Barrier reverse convertible: issuer bond minus a down-and-in put.

export interface ReverseConvertibleTerms {
  tenor: number;
  strike: number;
  barrier: number;
  frequency: number;
  /** Issuer margin as a percentage of notional, kept by the issuer. */
  margin: number;
}

export interface ReverseConvertibleValuation {
  bondPv: number;
  annuity: number;
  putValue: number;
  putVolatility: number;
  /** Annual coupon (%) that makes the package worth par before margin. */
  fairCoupon: number;
  /** Annual coupon (%) after the issuer keeps its margin. */
  offeredCoupon: number;
}

export function priceReverseConvertible(
  context: MarketContext,
  terms: ReverseConvertibleTerms,
): ReverseConvertibleValuation {
  const { underlying, curve } = context;
  const T = terms.tenor;
  const r = zeroRate(curve, T);
  const q = underlying.dividendYield;
  // Sticky-strike approximation: the knock-in put is priced with the volatility
  // quoted at the barrier level, where its value is concentrated.
  const putVolatility = impliedVolatility(underlying, T, terms.barrier / 100, context.volModel);
  const putValue = downBarrierPrice(
    { S: 100, K: terms.strike, T, r, q, v: putVolatility },
    "put",
    terms.barrier,
    "knock-in",
  );
  const bondPv = 100 * discountFactor(curve, T, context.fundingSpread);
  const annuity = couponAnnuity(curve, context.fundingSpread, T, terms.frequency);
  return {
    bondPv,
    annuity,
    putValue,
    putVolatility,
    fairCoupon: (100 - bondPv + putValue) / annuity,
    offeredCoupon: (100 - terms.margin - bondPv + putValue) / annuity,
  };
}

// ---------------------------------------------------------------------------
// Autocallable reverse convertible priced by Monte Carlo with common random
// numbers: the paths are simulated once and every candidate term is evaluated
// on the same draws, so the coupon is a smooth function of the term.

export interface PathSummaries {
  count: number;
  periods: number;
  frequency: number;
  tenor: number;
  /** Time step of the simulation in years. */
  timeStep: number;
  /** Levels at each observation date, path-major, as a percentage of initial. */
  levels: Float32Array;
  /** Running minimum over the simulated steps for each path. */
  minimum: Float32Array;
}

export function simulatePathSummaries(
  context: MarketContext,
  tenor: number,
  frequency: number,
  count = 20_000,
  seed = 20_260_630,
  stepsPerYear = 52,
): PathSummaries {
  const { underlying, curve } = context;
  const periods = Math.max(1, Math.round(tenor * frequency));
  const stepsPerPeriod = Math.max(1, Math.round(stepsPerYear / frequency));
  const timeStep = tenor / (periods * stepsPerPeriod);
  const r = zeroRate(curve, tenor);
  const q = underlying.dividendYield;
  const smile = smileFunction(underlying, tenor, context.volModel);
  const sqrtStep = Math.sqrt(timeStep);
  const random = seededRandom(seed);
  const levels = new Float32Array(count * periods);
  const minimum = new Float32Array(count);

  for (let path = 0; path < count; path += 1) {
    let level = 100;
    let low = 100;
    for (let period = 0; period < periods; period += 1) {
      for (let step = 0; step < stepsPerPeriod; step += 1) {
        const volatility = smile(level / 100);
        level *= Math.exp(
          (r - q - 0.5 * volatility * volatility) * timeStep +
            volatility * sqrtStep * normalRandom(random),
        );
        if (level < low) low = level;
      }
      levels[path * periods + period] = level;
    }
    minimum[path] = low;
  }
  return { count, periods, frequency, tenor, timeStep, levels, minimum };
}

export type BarrierObservation = "maturity" | "continuous";

export interface AutocallTerms {
  tenor: number;
  frequency: number;
  /** Autocall trigger as a percentage of the initial level. */
  trigger: number;
  /** Knock-in barrier as a percentage of the initial level. */
  barrier: number;
  barrierObservation: BarrierObservation;
  margin: number;
}

export interface AutocallValuation {
  annuity: number;
  redemptionPv: number;
  callProbability: number;
  lossProbability: number;
  expectedLife: number;
  fairCoupon: number;
  offeredCoupon: number;
  effectiveBarrier: number;
}

/** Broadie-Glasserman-Kou shift that lets discretely sampled paths stand in for continuous monitoring. */
export function continuousBarrierAdjustment(
  barrier: number,
  volatility: number,
  timeStep: number,
): number {
  return barrier * Math.exp(0.5826 * volatility * Math.sqrt(timeStep));
}

export function priceAutocall(
  summaries: PathSummaries,
  context: MarketContext,
  terms: AutocallTerms,
): AutocallValuation {
  const { periods, frequency, count, levels, minimum } = summaries;
  if (Math.round(terms.tenor * terms.frequency) !== periods || terms.frequency !== frequency)
    throw new Error("Path summaries do not match the autocall schedule");
  const discount = new Float64Array(periods + 1);
  for (let index = 1; index <= periods; index += 1)
    discount[index] = discountFactor(context.curve, index / frequency, context.fundingSpread);
  const effectiveBarrier =
    terms.barrierObservation === "continuous"
      ? continuousBarrierAdjustment(
          terms.barrier,
          atmVolatility(context.underlying, terms.tenor),
          summaries.timeStep,
        )
      : terms.barrier;

  let annuity = 0;
  let redemptionPv = 0;
  let calls = 0;
  let losses = 0;
  let life = 0;
  for (let path = 0; path < count; path += 1) {
    const base = path * periods;
    let called = false;
    for (let index = 1; index <= periods; index += 1) {
      annuity += discount[index] / frequency;
      if (levels[base + index - 1] >= terms.trigger) {
        redemptionPv += discount[index] * 100;
        life += index / frequency;
        calls += 1;
        called = true;
        break;
      }
    }
    if (called) continue;
    const final = levels[base + periods - 1];
    const breached =
      terms.barrierObservation === "maturity"
        ? final < terms.barrier
        : minimum[path] <= effectiveBarrier && final < 100;
    if (breached) losses += 1;
    redemptionPv += discount[periods] * (breached ? final : 100);
    life += terms.tenor;
  }
  annuity /= count;
  redemptionPv /= count;
  return {
    annuity,
    redemptionPv,
    callProbability: calls / count,
    lossProbability: losses / count,
    expectedLife: life / count,
    fairCoupon: (100 - redemptionPv) / annuity,
    offeredCoupon: (100 - terms.margin - redemptionPv) / annuity,
    effectiveBarrier,
  };
}

// ---------------------------------------------------------------------------
// Bisection with a visible trail.

export interface SolveStep {
  iteration: number;
  lower: number;
  upper: number;
  candidate: number;
  value: number;
  error: number;
  nextLower: number;
  nextUpper: number;
  decision: string;
  converged: boolean;
}

export interface SolveResult {
  steps: SolveStep[];
  candidate: number;
  value: number;
  converged: boolean;
  reachable: boolean;
  range: [number, number];
  minimum: number;
  maximum: number;
}

export function bisect(
  evaluate: (candidate: number) => number,
  range: [number, number],
  target: number,
  options: { tolerance: number; increasing: boolean; maxIterations?: number },
): SolveResult {
  const [start, end] = range;
  const startValue = evaluate(start);
  const endValue = evaluate(end);
  const minimum = Math.min(startValue, endValue);
  const maximum = Math.max(startValue, endValue);
  const unreachable = {
    steps: [],
    candidate: Number.NaN,
    value: Number.NaN,
    converged: false,
    reachable: false,
    range,
    minimum,
    maximum,
  };
  if (!Number.isFinite(target) || target < minimum || target > maximum) return unreachable;

  const steps: SolveStep[] = [];
  let lower = start;
  let upper = end;
  const maxIterations = options.maxIterations ?? 40;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const candidate = (lower + upper) / 2;
    const value = evaluate(candidate);
    const error = value - target;
    const converged = Math.abs(error) <= options.tolerance;
    let nextLower = lower;
    let nextUpper = upper;
    if (!converged) {
      const candidateTooLow = options.increasing ? value < target : value > target;
      if (candidateTooLow) nextLower = candidate;
      else nextUpper = candidate;
    }
    const kept =
      nextLower === candidate ? "upper half" : nextUpper === candidate ? "lower half" : "answer";
    steps.push({
      iteration,
      lower,
      upper,
      candidate,
      value,
      error,
      nextLower,
      nextUpper,
      decision: converged
        ? "Within tolerance"
        : `${value > target ? "above" : "below"} target · keep ${kept}`,
      converged,
    });
    if (converged) break;
    lower = nextLower;
    upper = nextUpper;
  }
  const last = steps[steps.length - 1];
  return {
    steps,
    candidate: last?.candidate ?? Number.NaN,
    value: last?.value ?? Number.NaN,
    converged: last?.converged ?? false,
    reachable: true,
    range,
    minimum,
    maximum,
  };
}

// ---------------------------------------------------------------------------
// The inverse problems the lab offers.

export type SolveTarget = "autocall-barrier" | "rc-barrier" | "protection" | "cap";

export interface SolveDefinition {
  target: SolveTarget;
  label: string;
  unit: string;
  resultLabel: string;
  range: [number, number];
  increasing: boolean;
  tolerance: number;
  evaluate: (candidate: number) => number;
}

export function autocallBarrierSolve(
  summaries: PathSummaries,
  context: MarketContext,
  terms: AutocallTerms,
): SolveDefinition {
  return {
    target: "autocall-barrier",
    label: "knock-in barrier",
    unit: "% of initial",
    resultLabel: "offered coupon",
    range: [30, 95],
    increasing: true,
    tolerance: 0.01,
    evaluate: (barrier) => priceAutocall(summaries, context, { ...terms, barrier }).offeredCoupon,
  };
}

export function reverseConvertibleBarrierSolve(
  context: MarketContext,
  terms: ReverseConvertibleTerms,
): SolveDefinition {
  return {
    target: "rc-barrier",
    label: "knock-in barrier",
    unit: "% of initial",
    resultLabel: "offered coupon",
    range: [30, Math.min(95, terms.strike - 1)],
    increasing: true,
    tolerance: 0.01,
    evaluate: (barrier) => priceReverseConvertible(context, { ...terms, barrier }).offeredCoupon,
  };
}

export function protectionSolve(
  context: MarketContext,
  terms: ProtectedNoteTerms,
): SolveDefinition {
  return {
    target: "protection",
    label: "protection level",
    unit: "% of notional",
    resultLabel: "participation",
    range: [50, 100],
    increasing: false,
    tolerance: 0.1,
    evaluate: (protection) => priceProtectedNote(context, { ...terms, protection }).participation,
  };
}

export function capSolve(context: MarketContext, terms: ProtectedNoteTerms): SolveDefinition {
  return {
    target: "cap",
    label: "upside cap",
    unit: "% of initial",
    resultLabel: "participation",
    range: [terms.strike + 5, 200],
    increasing: false,
    tolerance: 0.1,
    evaluate: (cap) => priceProtectedNote(context, { ...terms, cap }).participation,
  };
}
