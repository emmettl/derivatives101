import {
  autocallBarrierSolve,
  bisect,
  capSolve,
  priceAutocall,
  priceProtectedNote,
  priceReverseConvertible,
  protectionSolve,
  reverseConvertibleBarrierSolve,
  simulatePathSummaries,
  type AutocallTerms,
  type BarrierObservation,
  type MarketContext,
  type PathSummaries,
  type ProtectedNoteTerms,
  type ReverseConvertibleTerms,
  type SolveDefinition,
  type SolveResult,
  type SolveTarget,
} from "./engine";
import {
  atmVolatility,
  curveFor,
  impliedVolatility,
  underlyingById,
  zeroRate,
  type VolatilityModel,
} from "./snapshot";

export type Product = "autocall" | "rc" | "protected";

export interface MarketSolverState {
  underlying: string;
  product: Product;
  volModel: VolatilityModel;
  tenor: number;
  frequency: number;
  trigger: number;
  barrier: number;
  barrierObservation: BarrierObservation;
  strike: number;
  protection: number;
  capEnabled: boolean;
  cap: number;
  fee: number;
  spread: number;
  margin: number;
  solveTarget: SolveTarget;
  target: number;
}

export interface Headline {
  label: string;
  value: string;
  secondaryLabel: string;
  secondary: string;
  alternative: string;
  statALabel: string;
  statA: string;
  statBLabel: string;
  statB: string;
  rows: Array<[string, string]>;
  copy: string;
  result: number;
}

export type MarketSolverDefinition = Omit<SolveDefinition, "evaluate">;

export interface MarketSolverChart {
  samples: Array<{ candidate: number; value: number }>;
  initialBoundValues: { lower: number; upper: number };
  retainedBoundValues: Array<{ lower: number; upper: number }>;
}

export interface MarketSolverCalculationRequest {
  id: number;
  state: MarketSolverState;
  seedTarget: boolean;
}

export interface MarketSolverCalculationResult {
  id: number;
  target: number;
  headline: Headline;
  definition: MarketSolverDefinition;
  solution: SolveResult;
  chart: MarketSolverChart;
}

const PATH_COUNT = 20_000;
const summaryCache = new Map<string, PathSummaries>();

const percent = (value: number, digits = 1) => `${value.toFixed(digits)}%`;
const number2 = (value: number) => value.toFixed(2);

function contextFor(state: MarketSolverState, volModel: VolatilityModel): MarketContext {
  const underlying = underlyingById(state.underlying);
  return { underlying, curve: curveFor(underlying), fundingSpread: state.spread / 100, volModel };
}

function summariesFor(state: MarketSolverState, volModel: VolatilityModel): PathSummaries {
  const key = `${state.underlying}|${volModel}|${state.tenor}|${state.frequency}`;
  let summaries = summaryCache.get(key);
  if (!summaries) {
    summaries = simulatePathSummaries(
      contextFor(state, volModel),
      state.tenor,
      state.frequency,
      PATH_COUNT,
    );
    if (summaryCache.size > 12) summaryCache.delete(summaryCache.keys().next().value as string);
    summaryCache.set(key, summaries);
  }
  return summaries;
}

function autocallTerms(state: MarketSolverState): AutocallTerms {
  return {
    tenor: state.tenor,
    frequency: state.frequency,
    trigger: state.trigger,
    barrier: state.barrier,
    barrierObservation: state.barrierObservation,
    margin: state.margin,
  };
}

function reverseConvertibleTerms(state: MarketSolverState): ReverseConvertibleTerms {
  return {
    tenor: state.tenor,
    strike: state.strike,
    barrier: Math.min(state.barrier, state.strike - 1),
    frequency: state.frequency,
    margin: state.margin,
  };
}

function protectedNoteTerms(state: MarketSolverState): ProtectedNoteTerms {
  return {
    tenor: state.tenor,
    protection: state.protection,
    strike: 100,
    cap: state.capEnabled ? state.cap : null,
    fee: state.fee,
  };
}

function valuation(state: MarketSolverState): Headline {
  const context = contextFor(state, state.volModel);
  const other: VolatilityModel = state.volModel === "skew" ? "flat" : "skew";
  const otherContext = contextFor(state, other);
  const otherLabel = other === "flat" ? "Under flat volatility" : "With market skew";
  const { underlying } = context;

  if (state.product === "autocall") {
    const terms = autocallTerms(state);
    const result = priceAutocall(summariesFor(state, state.volModel), context, terms);
    const alternative = priceAutocall(summariesFor(state, other), otherContext, terms);
    return {
      label: "Offered coupon (p.a.)",
      value: percent(result.offeredCoupon, 2),
      secondaryLabel: "Fair coupon before margin",
      secondary: percent(result.fairCoupon, 2),
      alternative: `${percent(alternative.offeredCoupon, 2)} · ${otherLabel.toLowerCase()}`,
      statALabel: "Autocalled",
      statA: percent(result.callProbability * 100, 0),
      statBLabel: "Loses principal",
      statB: percent(result.lossProbability * 100, 1),
      rows: [
        ["Paths", `${PATH_COUNT.toLocaleString()} · weekly steps · same draws for every candidate`],
        [
          "Drift",
          `${percent(zeroRate(context.curve, state.tenor) * 100, 2)} rate − ${percent(underlying.dividendYield * 100, 2)} dividend yield`,
        ],
        [
          "Volatility",
          state.volModel === "flat"
            ? `${percent(atmVolatility(underlying, state.tenor) * 100, 1)} flat`
            : `${percent(atmVolatility(underlying, state.tenor) * 100, 1)} at the money · ${percent(impliedVolatility(underlying, state.tenor, state.barrier / 100) * 100, 1)} at the barrier`,
        ],
        ["PV of expected coupons per 1% p.a.", number2(result.annuity)],
        ["PV of expected redemption", number2(result.redemptionPv)],
        ["Issuer margin", number2(state.margin)],
        ["Expected life", `${result.expectedLife.toFixed(2)} years`],
        ...(state.barrierObservation === "continuous"
          ? [
              [
                "Effective barrier (continuity correction)",
                percent(result.effectiveBarrier, 1),
              ] as [string, string],
            ]
          : []),
      ],
      copy: "Coupon = (100 − margin − redemption PV) ÷ coupon annuity. The paths are fixed, so the coupon is linear in nothing but the barrier's effect on redemption, and the solver can bisect it.",
      result: result.offeredCoupon,
    };
  }

  if (state.product === "rc") {
    const terms = reverseConvertibleTerms(state);
    const result = priceReverseConvertible(context, terms);
    const alternative = priceReverseConvertible(otherContext, terms);
    return {
      label: "Offered coupon (p.a.)",
      value: percent(result.offeredCoupon, 2),
      secondaryLabel: "Fair coupon before margin",
      secondary: percent(result.fairCoupon, 2),
      alternative: `${percent(alternative.offeredCoupon, 2)} · ${otherLabel.toLowerCase()}`,
      statALabel: "Knock-in put value",
      statA: number2(result.putValue),
      statBLabel: "Volatility at the barrier",
      statB: percent(result.putVolatility * 100, 1),
      rows: [
        ["Issuer bond PV (funding curve)", number2(result.bondPv)],
        ["Down-and-in put, closed form", number2(result.putValue)],
        ["Coupon annuity per 1% p.a.", number2(result.annuity)],
        ["Issuer margin", number2(state.margin)],
      ],
      copy: "Coupon = (100 − margin − bond PV + put value) ÷ annuity. The put is priced with the volatility quoted at the barrier, the sticky-strike shortcut desks use for a first look.",
      result: result.offeredCoupon,
    };
  }

  const terms = protectedNoteTerms(state);
  const result = priceProtectedNote(context, terms);
  const alternative = priceProtectedNote(otherContext, terms);
  return {
    label: "Participation",
    value: percent(result.participation, 1),
    secondaryLabel: "Option budget",
    secondary: number2(result.budget),
    alternative: `${percent(alternative.participation, 1)} · ${otherLabel.toLowerCase()}`,
    statALabel: "Bond floor",
    statA: number2(result.bondFloor),
    statBLabel: terms.cap === null ? "Call cost" : "Call-spread cost",
    statB: number2(result.optionCost),
    rows: [
      ["Funding rate", percent(result.fundingRate * 100, 2)],
      ["Bond floor for the protected amount", number2(result.bondFloor)],
      ["Upfront fee", number2(state.fee)],
      ["Option budget", number2(result.budget)],
      [
        terms.cap === null ? "At-the-money call" : `Call spread ${terms.strike}–${terms.cap}`,
        `${number2(result.optionCost)} at ${percent(result.strikeVolatility * 100, 1)}${result.capVolatility === null ? "" : ` / ${percent(result.capVolatility * 100, 1)}`}`,
      ],
    ],
    copy: "Participation = budget ÷ option cost. Higher rates, lower protection, a longer tenor or a cap all leave more budget per unit of upside.",
    result: result.participation,
  };
}

function definition(state: MarketSolverState): SolveDefinition {
  if (state.product === "autocall")
    return autocallBarrierSolve(
      summariesFor(state, state.volModel),
      contextFor(state, state.volModel),
      autocallTerms(state),
    );
  if (state.product === "rc")
    return reverseConvertibleBarrierSolve(
      contextFor(state, state.volModel),
      reverseConvertibleTerms(state),
    );
  return state.solveTarget === "cap"
    ? capSolve(contextFor(state, state.volModel), {
        ...protectedNoteTerms(state),
        cap: state.cap,
      })
    : protectionSolve(contextFor(state, state.volModel), protectedNoteTerms(state));
}

export function definitionForState(state: MarketSolverState): MarketSolverDefinition {
  if (state.product === "autocall")
    return {
      target: "autocall-barrier",
      label: "knock-in barrier",
      unit: "% of initial",
      resultLabel: "offered coupon",
      range: [30, 95],
      increasing: true,
      tolerance: 0.01,
    };
  if (state.product === "rc")
    return {
      target: "rc-barrier",
      label: "knock-in barrier",
      unit: "% of initial",
      resultLabel: "offered coupon",
      range: [30, Math.min(95, state.strike - 1)],
      increasing: true,
      tolerance: 0.01,
    };
  return state.solveTarget === "cap"
    ? {
        target: "cap",
        label: "upside cap",
        unit: "% of initial",
        resultLabel: "participation",
        range: [105, 200],
        increasing: false,
        tolerance: 0.1,
      }
    : {
        target: "protection",
        label: "protection level",
        unit: "% of notional",
        resultLabel: "participation",
        range: [50, 100],
        increasing: false,
        tolerance: 0.1,
      };
}

function selectedCandidate(state: MarketSolverState): number {
  if (state.product !== "protected") return state.barrier;
  return state.solveTarget === "cap" ? state.cap : state.protection;
}

export function calculateMarketSolver(
  request: MarketSolverCalculationRequest,
): MarketSolverCalculationResult {
  const state = { ...request.state };
  const fullDefinition = definition(state);
  if (request.seedTarget) {
    const result = fullDefinition.evaluate(selectedCandidate(state));
    state.target =
      fullDefinition.resultLabel === "participation"
        ? Math.round(result)
        : Math.round(result * 4) / 4;
  }
  const solution = bisect(
    fullDefinition.evaluate,
    fullDefinition.range,
    state.target,
    fullDefinition,
  );
  const [minCandidate, maxCandidate] = fullDefinition.range;
  const samples = Array.from({ length: 61 }, (_, index) => {
    const candidate = minCandidate + ((maxCandidate - minCandidate) * index) / 60;
    return { candidate, value: fullDefinition.evaluate(candidate) };
  });
  const boundValues = (lower: number, upper: number) => ({
    lower: fullDefinition.evaluate(lower),
    upper: fullDefinition.evaluate(upper),
  });
  const { evaluate: _evaluate, ...definitionResult } = fullDefinition;

  return {
    id: request.id,
    target: state.target,
    headline: valuation(state),
    definition: definitionResult,
    solution,
    chart: {
      samples,
      initialBoundValues: boundValues(minCandidate, maxCandidate),
      retainedBoundValues: solution.steps.map((step) =>
        boundValues(step.nextLower, step.nextUpper),
      ),
    },
  };
}
