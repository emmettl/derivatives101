import { normCdf } from "../option-lab/math";
import { downBarrierPrice } from "../solver/engine";

/**
 * Worst-of barrier reverse convertible, priced by Monte Carlo.
 *
 * The client is short a knock-in put on the worst of one to three equally
 * volatile, equicorrelated underlyings. The same path algorithm and the same
 * counter-based random numbers run here in double precision and in the WebGPU
 * kernel (kernel.wgsl) in single precision, so the two back ends agree path by
 * path up to rounding.
 */

export type Monitoring = "continuous" | "close";

/**
 * Early-redemption schedule. "flat" calls the note at par on each quarterly
 * observation if every underlying is at or above 100%. "stepdown" uses the
 * gentle Swiss schedule 100 / 99 / 98 / 97, the last one at final fixing.
 */
export type Autocall = "off" | "flat" | "stepdown";

/** Autocall trigger, % of initial, on each of the four quarterly observations. */
export const AUTOCALL_TRIGGERS: Record<Exclude<Autocall, "off">, number[]> = {
  flat: [100, 100, 100, 100],
  stepdown: [100, 99, 98, 97],
};

/** Quarterly observations in a one-year note; the fourth is the final fixing. */
export const OBSERVATIONS = 4;

export interface McParams {
  /** Number of underlyings, 1 to 3. */
  assets: number;
  /** Annual volatility of every underlying, decimal. */
  vol: number;
  /** Pairwise correlation between underlyings, decimal. */
  corr: number;
  /** Knock-in barrier as a percentage of the initial level. */
  barrier: number;
  /** Put strike as a percentage of the initial level. */
  strike: number;
  /** Continuously compounded risk-free rate, decimal. */
  rate: number;
  /** Tenor in years. */
  tenor: number;
  /** Simulation steps (one per trading day). */
  steps: number;
  monitoring: Monitoring;
  /**
   * Par lock-in level, % of initial, or 0 for none. If every underlying closes
   * at or above it on any day, redemption at par is locked in and the knock-in
   * can no longer cost the client anything.
   */
  lockIn: number;
  autocall: Autocall;
  seed: number;
}

export const DEFAULT_PARAMS: McParams = {
  assets: 3,
  vol: 0.25,
  corr: 0.5,
  barrier: 70,
  strike: 100,
  rate: 0.02,
  tenor: 1,
  steps: 252,
  monitoring: "continuous",
  lockIn: 0,
  autocall: "off",
  seed: 1,
};

/** Lock-in level the page offers when the feature is switched on. */
export const DEFAULT_LOCK_IN = 110;

export const hasFeatures = (params: Pick<McParams, "lockIn" | "autocall">): boolean =>
  params.lockIn > 0 || params.autocall !== "off";

/**
 * Accumulated per-path sums. Every path is priced twice in the same loop: once
 * with the lock-in and autocall terms ("payoff", "knockIn") and once as the
 * plain barrier reverse convertible ("base..."), so the two differ only by the
 * features and not by sampling noise.
 */
export interface BatchSums {
  sumPayoff: number;
  sumPayoffSq: number;
  sumKnockIn: number;
  paths: number;
  baseSumPayoff: number;
  baseSumPayoffSq: number;
  baseSumKnockIn: number;
  /** Paths that locked in before any autocall. */
  sumLocked: number;
  /** Paths called early at the first, second and third quarterly observation. */
  sumCalled: [number, number, number];
}

export interface Estimate {
  paths: number;
  /** Discounted knock-in put value, % of notional. */
  put: number;
  /** Standard error of the put value. */
  standardError: number;
  /**
   * Probability that the barrier is breached while the note is still live and
   * not locked in, decimal: the knock-in that can still cost the client.
   */
  knockInProbability: number;
  /** Fair coupon p.a., accrued and paid on redemption, % of notional. */
  coupon: number;
  /** Probability the note locks in, decimal. */
  lockProbability: number;
  /** Probability of an early call at each of the three quarterly observations. */
  callProbabilities: [number, number, number];
  /** Expected life of the note in years. */
  expectedLife: number;
  /** The same paths priced as a plain barrier reverse convertible. */
  base: { put: number; standardError: number; knockInProbability: number; coupon: number };
}

export const emptySums = (): BatchSums => ({
  sumPayoff: 0,
  sumPayoffSq: 0,
  sumKnockIn: 0,
  paths: 0,
  baseSumPayoff: 0,
  baseSumPayoffSq: 0,
  baseSumKnockIn: 0,
  sumLocked: 0,
  sumCalled: [0, 0, 0],
});

export function addSums(total: BatchSums, batch: BatchSums): BatchSums {
  return {
    sumPayoff: total.sumPayoff + batch.sumPayoff,
    sumPayoffSq: total.sumPayoffSq + batch.sumPayoffSq,
    sumKnockIn: total.sumKnockIn + batch.sumKnockIn,
    paths: total.paths + batch.paths,
    baseSumPayoff: total.baseSumPayoff + batch.baseSumPayoff,
    baseSumPayoffSq: total.baseSumPayoffSq + batch.baseSumPayoffSq,
    baseSumKnockIn: total.baseSumKnockIn + batch.baseSumKnockIn,
    sumLocked: total.sumLocked + batch.sumLocked,
    sumCalled: [
      total.sumCalled[0] + batch.sumCalled[0],
      total.sumCalled[1] + batch.sumCalled[1],
      total.sumCalled[2] + batch.sumCalled[2],
    ],
  };
}

export function discountFactor(params: Pick<McParams, "rate" | "tenor">): number {
  return Math.exp(-params.rate * params.tenor);
}

/**
 * Coupon, paid at maturity, that makes bond-plus-short-put worth par when the
 * issuer funds at the risk-free rate and keeps no margin:
 * DF * (100 + c) - put = 100.
 */
export function fairCoupon(put: number, params: Pick<McParams, "rate" | "tenor">): number {
  const df = discountFactor(params);
  return (100 - 100 * df + put) / df / params.tenor;
}

/**
 * Coupon p.a. for a note that may end early. The coupon accrues and is paid on
 * redemption, so with redemption time tau the note is worth
 * E[DF(tau) * (100 + c * tau)] - put, and setting that to par gives
 * c = (100 - 100 * E[DF(tau)] + put) / E[tau * DF(tau)].
 * Without early calls tau is the tenor and this is fairCoupon.
 */
export function couponWithCalls(
  put: number,
  callProbabilities: readonly number[],
  params: Pick<McParams, "rate" | "tenor">,
): number {
  let survive = 1;
  let expectedDf = 0;
  let expectedTauDf = 0;
  callProbabilities.forEach((probability, index) => {
    const tau = ((index + 1) / OBSERVATIONS) * params.tenor;
    const df = Math.exp(-params.rate * tau);
    expectedDf += probability * df;
    expectedTauDf += probability * tau * df;
    survive -= probability;
  });
  const df = discountFactor(params);
  expectedDf += survive * df;
  expectedTauDf += survive * params.tenor * df;
  return (100 - 100 * expectedDf + put) / expectedTauDf;
}

export function estimate(sums: BatchSums, params: McParams): Estimate {
  const n = Math.max(1, sums.paths);
  const df = discountFactor(params);
  const priced = (sum: number, sumSq: number) => {
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);
    return { put: df * mean, standardError: (df * Math.sqrt(variance)) / Math.sqrt(n) };
  };
  const featured = priced(sums.sumPayoff, sums.sumPayoffSq);
  const base = priced(sums.baseSumPayoff, sums.baseSumPayoffSq);
  const callProbabilities = sums.sumCalled.map((count) => count / n) as [number, number, number];
  const called = callProbabilities.reduce((total, p) => total + p, 0);
  const expectedLife =
    callProbabilities.reduce(
      (total, p, index) => total + p * ((index + 1) / OBSERVATIONS) * params.tenor,
      0,
    ) +
    (1 - called) * params.tenor;
  return {
    paths: sums.paths,
    ...featured,
    knockInProbability: sums.sumKnockIn / n,
    coupon: couponWithCalls(featured.put, callProbabilities, params),
    lockProbability: sums.sumLocked / n,
    callProbabilities,
    expectedLife,
    base: {
      ...base,
      knockInProbability: sums.baseSumKnockIn / n,
      coupon: fairCoupon(base.put, params),
    },
  };
}

/** Lower-triangular Cholesky factor of the equicorrelation matrix, 3 x 3, row-major. */
export function cholesky(assets: number, corr: number): number[] {
  const matrix = Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    if (row >= assets || column >= assets) return 0;
    return row === column ? 1 : corr;
  });
  const factor = Array.from({ length: 9 }, () => 0);
  for (let row = 0; row < assets; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = matrix[row * 3 + column];
      for (let k = 0; k < column; k += 1) sum -= factor[row * 3 + k] * factor[column * 3 + k];
      factor[row * 3 + column] =
        row === column ? Math.sqrt(Math.max(sum, 0)) : sum / factor[column * 3 + column];
    }
  }
  return factor;
}

/** Quantities the path loop needs, shared by the CPU loop and the GPU uniform buffer. */
export interface KernelConstants {
  drift: number;
  volSqrtDt: number;
  logBarrier: number;
  /** 2 / (sigma^2 dt): scales the Brownian-bridge crossing probability. */
  bridgeScale: number;
  chol: number[];
  /** ln(lock-in level), or NEVER when there is no lock-in. */
  logLock: number;
  /** ln(autocall trigger) at each quarterly observation; NEVER when off. */
  logTriggers: number[];
  /** Simulation steps between quarterly observations. */
  callEvery: number;
}

/**
 * A log level no path reaches. Finite, because WGSL lets the GPU assume that
 * floating-point values are never infinite.
 */
export const NEVER = 1e9;

export function kernelConstants(params: McParams): KernelConstants {
  const dt = params.tenor / params.steps;
  return {
    drift: (params.rate - 0.5 * params.vol * params.vol) * dt,
    volSqrtDt: params.vol * Math.sqrt(dt),
    logBarrier: Math.log(params.barrier / 100),
    bridgeScale: 2 / (params.vol * params.vol * dt),
    chol: cholesky(params.assets, params.corr),
    logLock: params.lockIn > 0 ? Math.log(params.lockIn / 100) : NEVER,
    logTriggers:
      params.autocall === "off"
        ? [NEVER, NEVER, NEVER, NEVER]
        : AUTOCALL_TRIGGERS[params.autocall].map((level) => Math.log(level / 100)),
    callEvery: Math.round(params.steps / OBSERVATIONS),
  };
}

// ---------------------------------------------------------------------------
// Counter-based random numbers, bit-identical to the WGSL kernel.

const PCG_MULTIPLIER = 747796405;
const PCG_INCREMENT = 2891336453;

/** PCG-RXS-M-XS output permutation applied to a fresh LCG step. */
function pcgOutput(state: number): number {
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
}

export function pcgHash(value: number): number {
  return pcgOutput((Math.imul(value >>> 0, PCG_MULTIPLIER) + PCG_INCREMENT) >>> 0);
}

export class PathRng {
  private state: number;

  constructor(path: number, seed: number) {
    this.state = pcgHash((path ^ pcgHash(seed)) >>> 0);
  }

  uniform(): number {
    this.state = (Math.imul(this.state, PCG_MULTIPLIER) + PCG_INCREMENT) >>> 0;
    return ((pcgOutput(this.state) >>> 8) + 0.5) / 16777216;
  }

  /** Two independent standard normals by Box-Muller. */
  normalPair(): [number, number] {
    const u1 = this.uniform();
    const u2 = this.uniform();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  }
}

// ---------------------------------------------------------------------------
// The path loop.

export interface PathOutcome {
  /** Undiscounted knock-in put payoff with lock-in and autocall, % of notional. */
  payoff: number;
  /** Chance the barrier was breached and still bites: not locked, not called. */
  knockIn: number;
  /** Plain barrier reverse convertible payoff on the same path. */
  basePayoff: number;
  /** Probability the path breached the barrier, given its daily closes. */
  baseKnockIn: number;
  /** Worst-of performance at maturity, % of initial. */
  worst: number;
  /** Step at which every underlying first closed at or above the lock-in, or 0. */
  lockStep: number;
  /** Quarterly observation (1 to 3) at which the note was called early, or 0. */
  calledAt: number;
  /** True if the final observation redeemed the note at par through the trigger. */
  finalTrigger: boolean;
}

/**
 * Simulates one path. With continuous monitoring a Brownian bridge supplies the
 * chance that each underlying dipped through the barrier between two closes;
 * the payoff is weighted by that probability instead of sampling it, which is
 * exact for one underlying and lowers variance. For a basket the per-name
 * bridges are combined as if independent, a close approximation below very
 * high correlation.
 *
 * The path always runs to maturity so the plain note can be priced alongside.
 * Lock-in is tested on every daily close of the worst performer. An autocall
 * is tested on the quarterly closes, and once the note is called nothing that
 * happens later on the path matters to it.
 */
export function simulatePath(
  params: McParams,
  constants: KernelConstants,
  path: number,
  trace?: (step: number, worst: number) => void,
): PathOutcome {
  const rng = new PathRng(path, params.seed);
  const { drift, volSqrtDt, logBarrier, bridgeScale, chol, logLock, logTriggers, callEvery } =
    constants;
  const x = [0, 0, 0];
  const next = [0, 0, 0];
  const z = [0, 0, 0];
  let survive = 1;
  let lockStep = 0;
  let calledAt = 0;
  for (let step = 0; step < params.steps; step += 1) {
    const [a, b] = rng.normalPair();
    z[0] = a;
    z[1] = b;
    z[2] = params.assets === 3 ? rng.normalPair()[0] : 0;
    let worst = Infinity;
    for (let asset = 0; asset < params.assets; asset += 1) {
      const shock =
        chol[asset * 3] * z[0] + chol[asset * 3 + 1] * z[1] + chol[asset * 3 + 2] * z[2];
      next[asset] = x[asset] + drift + volSqrtDt * shock;
      const before = x[asset] - logBarrier;
      const after = next[asset] - logBarrier;
      if (after <= 0) survive = 0;
      else if (params.monitoring === "continuous")
        survive *= 1 - Math.exp(-bridgeScale * before * after);
      x[asset] = next[asset];
      worst = Math.min(worst, x[asset]);
    }
    const day = step + 1;
    if (!calledAt) {
      if (!lockStep && worst >= logLock) lockStep = day;
      const observation = day / callEvery;
      if (
        day % callEvery === 0 &&
        observation < OBSERVATIONS &&
        worst >= logTriggers[observation - 1]
      )
        calledAt = observation;
    }
    trace?.(day, 100 * Math.exp(worst));
  }
  let worstLog = x[0];
  for (let asset = 1; asset < params.assets; asset += 1) worstLog = Math.min(worstLog, x[asset]);
  const worst = 100 * Math.exp(worstLog);
  const baseKnockIn = 1 - survive;
  const basePayoff = Math.max(params.strike - worst, 0) * baseKnockIn;
  const live = calledAt === 0 && lockStep === 0;
  const finalTrigger = calledAt === 0 && worstLog >= logTriggers[OBSERVATIONS - 1];
  return {
    payoff: live && !finalTrigger ? basePayoff : 0,
    knockIn: live ? baseKnockIn : 0,
    basePayoff,
    baseKnockIn,
    worst,
    lockStep,
    calledAt,
    finalTrigger,
  };
}

export function simulateBatch(params: McParams, offset: number, count: number): BatchSums {
  const constants = kernelConstants(params);
  const sums = emptySums();
  for (let index = 0; index < count; index += 1) {
    const outcome = simulatePath(params, constants, offset + index);
    sums.sumPayoff += outcome.payoff;
    sums.sumPayoffSq += outcome.payoff * outcome.payoff;
    sums.sumKnockIn += outcome.knockIn;
    sums.baseSumPayoff += outcome.basePayoff;
    sums.baseSumPayoffSq += outcome.basePayoff * outcome.basePayoff;
    sums.baseSumKnockIn += outcome.baseKnockIn;
    if (outcome.calledAt) sums.sumCalled[outcome.calledAt - 1] += 1;
    else if (outcome.lockStep) sums.sumLocked += 1;
  }
  sums.paths = count;
  return sums;
}

/** How a sample path ends for the note with its features. */
export type PathFate = "called" | "locked" | "knocked" | "plain";

export interface SamplePath {
  /** Worst-of level, % of initial, at each step including the start. */
  levels: number[];
  /** True if a daily close of the worst-of reached the barrier. */
  touched: boolean;
  worst: number;
  /** Step of the lock-in, or 0. */
  lockStep: number;
  /** Step of the early call, or 0. */
  callStep: number;
  fate: PathFate;
}

export function samplePaths(params: McParams, count: number): SamplePath[] {
  const constants = kernelConstants(params);
  return Array.from({ length: count }, (_, path) => {
    const levels = [100];
    let touchedStep = 0;
    const outcome = simulatePath(params, constants, path, (step, worst) => {
      levels.push(worst);
      if (!touchedStep && worst <= params.barrier) touchedStep = step;
    });
    const callStep = outcome.calledAt * constants.callEvery;
    const fate: PathFate = outcome.calledAt
      ? "called"
      : outcome.lockStep
        ? "locked"
        : touchedStep
          ? "knocked"
          : "plain";
    return {
      levels,
      touched: touchedStep > 0 && (!callStep || touchedStep <= callStep),
      worst: outcome.worst,
      lockStep: outcome.lockStep,
      callStep,
      fate,
    };
  });
}

// ---------------------------------------------------------------------------
// Closed-form references, available only for a single underlying.

/** Broadie-Glasserman-Kou constant: zeta(1/2) / sqrt(2 pi). */
export const BGK_SHIFT = 0.5826;

/** Barrier level that makes a continuous formula approximate daily-close monitoring. */
export function effectiveBarrier(params: McParams): number {
  if (params.monitoring === "continuous") return params.barrier;
  return (
    params.barrier * Math.exp(-BGK_SHIFT * params.vol * Math.sqrt(params.tenor / params.steps))
  );
}

/** First-passage probability of a lognormal path below a barrier, continuous monitoring. */
export function knockInProbabilityClosedForm(
  params: Pick<McParams, "vol" | "rate" | "tenor">,
  barrier: number,
): number {
  if (barrier >= 100) return 1;
  const { vol, rate, tenor } = params;
  const b = Math.log(barrier / 100);
  const mu = rate - 0.5 * vol * vol;
  const scale = vol * Math.sqrt(tenor);
  return (
    normCdf((b - mu * tenor) / scale) +
    Math.exp((2 * mu * b) / (vol * vol)) * normCdf((b + mu * tenor) / scale)
  );
}

export interface ClosedFormReference {
  put: number;
  knockInProbability: number;
  coupon: number;
  /** True when the reference is the continuity-corrected approximation. */
  corrected: boolean;
}

/**
 * Closed form for the plain one-stock note. With lock-in or autocall switched on
 * it still describes the plain note, which the page shows alongside.
 */
export function closedFormReference(params: McParams): ClosedFormReference | null {
  if (params.assets !== 1) return null;
  const barrier = effectiveBarrier(params);
  const put = downBarrierPrice(
    { S: 100, K: params.strike, T: params.tenor, r: params.rate, q: 0, v: params.vol },
    "put",
    barrier,
    "knock-in",
  );
  return {
    put,
    knockInProbability: knockInProbabilityClosedForm(params, barrier),
    coupon: fairCoupon(put, params),
    corrected: params.monitoring === "close",
  };
}
