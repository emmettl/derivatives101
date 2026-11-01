/**
 * Barrier reverse convertible Greeks across spot and time to maturity.
 *
 * The note is a zero-coupon bond plus a fixed coupon, less a down-and-in put
 * the investor has sold to the issuer. Every number here is closed form, in
 * double precision, so the surface can be checked without a browser:
 *
 * - continuous monitoring: Reiner-Rubinstein down-and-in put while the barrier
 *   is intact, the vanilla put once spot is at or below it;
 * - daily-close monitoring: the same formula with the Broadie-Glasserman-Kou
 *   shifted barrier;
 * - at-maturity (European) barrier: the put pays only if the final fixing is
 *   below the barrier, which is a vanilla put struck at the barrier plus a
 *   cash-or-nothing digital paying the gap between strike and barrier.
 *
 * Greeks are central finite differences of those prices on the same branch, so
 * a bump never straddles the knock-in seam.
 */

export type Observation = "continuous" | "close" | "maturity";
export type Metric = "value" | "delta" | "gamma" | "vega";
export type View = "note" | "desk";

export interface SurfaceParams {
  /** Annual volatility, decimal. */
  vol: number;
  /** Knock-in barrier, % of the initial level. */
  barrier: number;
  /** Put strike, % of the initial level. */
  strike: number;
  /** Continuously compounded risk-free rate, decimal. */
  rate: number;
  /** Original tenor of the note in years. */
  tenor: number;
  observation: Observation;
}

export const DEFAULT_PARAMS: SurfaceParams = {
  vol: 0.25,
  barrier: 70,
  strike: 100,
  rate: 0.02,
  tenor: 1,
  observation: "continuous",
};

export const TRADING_DAYS = 252;
/** The surface stops one trading day before maturity, where gamma is still finite. */
export const MIN_TIME = 1 / TRADING_DAYS;
export const SPOT_MIN = 40;
export const SPOT_MAX = 140;
/** Broadie-Glasserman-Kou constant: zeta(1/2) / sqrt(2 pi). */
export const BGK_SHIFT = 0.5826;

// ---------------------------------------------------------------------------
// Normal distribution, accurate to about 1e-14 so second differences stay clean.

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Hart's double-precision algorithm, as set out by Graeme West (2005). */
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let tail: number;
  if (z > 37) tail = 0;
  else {
    const e = Math.exp(-0.5 * z * z);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      tail = (e * n) / d;
    } else {
      let d = z + 0.65;
      d = z + 4 / d;
      d = z + 3 / d;
      d = z + 2 / d;
      d = z + 1 / d;
      tail = e / d / 2.506628274631;
    }
  }
  return x > 0 ? 1 - tail : tail;
}

// ---------------------------------------------------------------------------
// Prices of the put the investor has sold, per 100 of notional, spot in % of initial.

interface Market {
  spot: number;
  strike: number;
  time: number;
  rate: number;
  vol: number;
}

/** Black-Scholes put, no dividends. */
export function vanillaPut({ spot, strike, time, rate, vol }: Market): number {
  if (time <= 0 || vol <= 0) return Math.max(strike - spot, 0);
  const root = vol * Math.sqrt(time);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * time) / root;
  const d2 = d1 - root;
  return strike * Math.exp(-rate * time) * normCdf(-d2) - spot * normCdf(-d1);
}

/**
 * Reiner-Rubinstein down-and-in put, strike above the barrier, while the
 * barrier has not been touched. Defined for spot above the barrier.
 */
export function aliveKnockInPut(market: Market, barrier: number): number {
  const { spot, strike, time, rate, vol } = market;
  if (barrier >= strike) return vanillaPut(market);
  const root = vol * Math.sqrt(time);
  const mu = (rate - 0.5 * vol * vol) / (vol * vol);
  const shift = (1 + mu) * root;
  const df = Math.exp(-rate * time);
  const x2 = Math.log(spot / barrier) / root + shift;
  const y1 = Math.log((barrier * barrier) / (spot * strike)) / root + shift;
  const y2 = Math.log(barrier / spot) / root + shift;
  const spotWeight = Math.pow(barrier / spot, 2 * (mu + 1));
  const strikeWeight = Math.pow(barrier / spot, 2 * mu);
  const b = -spot * normCdf(-x2) + strike * df * normCdf(-x2 + root);
  const c = -spot * spotWeight * normCdf(y1) + strike * df * strikeWeight * normCdf(y1 - root);
  const d = -spot * spotWeight * normCdf(y2) + strike * df * strikeWeight * normCdf(y2 - root);
  return b - c + d;
}

/**
 * Put that pays (strike - final) only when the final fixing is below the
 * barrier: a put struck at the barrier plus a digital paying strike - barrier.
 */
export function europeanBarrierPut(market: Market, barrier: number): number {
  const { spot, strike, time, rate, vol } = market;
  if (barrier >= strike) return vanillaPut(market);
  if (time <= 0) return spot < barrier ? strike - spot : 0;
  const root = vol * Math.sqrt(time);
  const d2 = (Math.log(spot / barrier) + (rate - 0.5 * vol * vol) * time) / root;
  const digital = Math.exp(-rate * time) * normCdf(-d2);
  return vanillaPut({ ...market, strike: barrier }) + (strike - barrier) * digital;
}

/** Barrier level that makes the continuous formula approximate daily-close monitoring. */
export function effectiveBarrier(params: SurfaceParams): number {
  if (params.observation !== "close") return params.barrier;
  return params.barrier * Math.exp(-BGK_SHIFT * params.vol * Math.sqrt(1 / TRADING_DAYS));
}

/** True when spot alone tells us the put has already knocked in. */
export function knockedIn(params: SurfaceParams, spot: number): boolean {
  return params.observation !== "maturity" && spot <= params.barrier;
}

type Branch = "alive" | "in" | "european";

function branchFor(params: SurfaceParams, spot: number): Branch {
  if (params.observation === "maturity") return "european";
  return knockedIn(params, spot) ? "in" : "alive";
}

function branchPrice(
  params: SurfaceParams,
  branch: Branch,
  spot: number,
  time: number,
  vol: number,
): number {
  const market: Market = { spot, strike: params.strike, time, rate: params.rate, vol };
  if (branch === "in") return vanillaPut(market);
  if (branch === "european") return europeanBarrierPut(market, params.barrier);
  return aliveKnockInPut(market, effectiveBarrier({ ...params, vol }));
}

/** Value of the knock-in put, % of notional. */
export function putValue(params: SurfaceParams, spot: number, time: number): number {
  return branchPrice(params, branchFor(params, spot), spot, time, params.vol);
}

// ---------------------------------------------------------------------------
// The note.

/**
 * Coupon, paid at maturity, that makes the note worth par at issue when the
 * issuer funds at the risk-free rate and keeps no margin.
 */
export function fairCoupon(params: SurfaceParams): number {
  const df = Math.exp(-params.rate * params.tenor);
  const put = putValue(params, 100, params.tenor);
  return (100 - 100 * df + put) / df / params.tenor;
}

export interface Greeks {
  /** Value, % of notional. */
  value: number;
  /** Change in value for a 1% move in the underlying (spot in % of initial). */
  delta: number;
  /** Change in delta for a 1% move in the underlying. */
  gamma: number;
  /** Change in value for one volatility point. */
  vega: number;
}

const SPOT_BUMP = 0.1;
const VOL_BUMP = 0.005;

/** Greeks of the knock-in put, by central differences on one pricing branch. */
export function putGreeks(params: SurfaceParams, spot: number, time: number): Greeks {
  const branch = branchFor(params, spot);
  const price = (s: number, v = params.vol) => branchPrice(params, branch, s, time, v);
  // Near the seam, step away from the barrier so both bumps stay on this branch.
  let centre = spot;
  if (branch === "alive") centre = Math.max(spot, params.barrier + SPOT_BUMP);
  if (branch === "in") centre = Math.min(spot, params.barrier - SPOT_BUMP);
  const value = price(spot);
  const up = price(centre + SPOT_BUMP);
  const mid = price(centre);
  const down = price(centre - SPOT_BUMP);
  const vega = (price(spot, params.vol + VOL_BUMP) - price(spot, params.vol - VOL_BUMP)) / 2;
  return {
    value,
    delta: (up - down) / (2 * SPOT_BUMP),
    gamma: (up - 2 * mid + down) / (SPOT_BUMP * SPOT_BUMP),
    vega: (vega / VOL_BUMP) * 0.01,
  };
}

/**
 * Greeks in the chosen book. The investor holds bond + coupon - put; the desk
 * view is the issuer's side of the option, long the put the investor sold.
 */
export function bookGreeks(
  params: SurfaceParams,
  spot: number,
  time: number,
  view: View,
  coupon = fairCoupon(params),
): Greeks {
  const put = putGreeks(params, spot, time);
  if (view === "desk") return put;
  const bond = (100 + coupon * params.tenor) * Math.exp(-params.rate * time);
  return { value: bond - put.value, delta: -put.delta, gamma: -put.gamma, vega: -put.vega };
}

// ---------------------------------------------------------------------------
// The grid that the 3D surface draws.

export interface SurfaceGrid {
  spots: Float64Array;
  /** Years to maturity, from the full tenor down to one trading day. */
  times: Float64Array;
  /** Row-major [time][spot]. */
  value: Float64Array;
  delta: Float64Array;
  gamma: Float64Array;
  vega: Float64Array;
  coupon: number;
}

export interface GridSize {
  spots: number;
  times: number;
}

export const DEFAULT_GRID: GridSize = { spots: 321, times: 97 };

/**
 * Time rows bunch towards maturity, where the barrier Greeks change fastest:
 * row j sits at tenor * (j / (n - 1))^2 years to go, floored at one day.
 */
export function timeAxis(tenor: number, count: number): Float64Array {
  const times = new Float64Array(count);
  for (let j = 0; j < count; j += 1) {
    const u = 1 - j / (count - 1);
    times[j] = MIN_TIME + (tenor - MIN_TIME) * u * u;
  }
  return times;
}

export function spotAxis(count: number): Float64Array {
  const spots = new Float64Array(count);
  for (let i = 0; i < count; i += 1)
    spots[i] = SPOT_MIN + ((SPOT_MAX - SPOT_MIN) * i) / (count - 1);
  return spots;
}

export function buildGrid(
  params: SurfaceParams,
  view: View,
  size: GridSize = DEFAULT_GRID,
): SurfaceGrid {
  const spots = spotAxis(size.spots);
  const times = timeAxis(params.tenor, size.times);
  const cells = size.spots * size.times;
  const grid: SurfaceGrid = {
    spots,
    times,
    value: new Float64Array(cells),
    delta: new Float64Array(cells),
    gamma: new Float64Array(cells),
    vega: new Float64Array(cells),
    coupon: fairCoupon(params),
  };
  for (let j = 0; j < size.times; j += 1) {
    for (let i = 0; i < size.spots; i += 1) {
      const greeks = bookGreeks(params, spots[i], times[j], view, grid.coupon);
      const cell = j * size.spots + i;
      grid.value[cell] = greeks.value;
      grid.delta[cell] = greeks.delta;
      grid.gamma[cell] = greeks.gamma;
      grid.vega[cell] = greeks.vega;
    }
  }
  return grid;
}

/** Signed log compression used for the surface height: keeps spikes visible without flattening the rest. */
export function compress(value: number, scale: number): number {
  return Math.asinh(value / scale) * scale;
}
