import raw from "../../data/market-snapshot.json";

export interface CurveSnapshot {
  name: string;
  /** Continuously compounded zero rates keyed by tenor in years. */
  zeroRates: Record<string, number>;
  source: string;
}

export interface UnderlyingSnapshot {
  id: string;
  name: string;
  currency: string;
  spot: number;
  /** Continuous dividend yield as a decimal. */
  dividendYield: number;
  /** At-the-money implied volatility (decimal) keyed by tenor in years. */
  atmVolatility: Record<string, number>;
  /** Change in one-year implied volatility per unit of moneyness (decimal). */
  skewSlope: number;
  /** Quadratic moneyness term for the one-year smile (decimal). */
  skewCurvature: number;
  source: string;
}

export interface MarketSnapshot {
  asOf: string;
  status: string;
  note: string;
  currencies: Record<string, CurveSnapshot>;
  underlyings: UnderlyingSnapshot[];
}

export type VolatilityModel = "flat" | "skew";

export const snapshot: MarketSnapshot = raw;

export function interpolateByTenor(points: Record<string, number>, tenor: number): number {
  const entries = Object.entries(points)
    .map(([key, value]) => [Number(key), value] as const)
    .filter(([key]) => Number.isFinite(key))
    .sort((a, b) => a[0] - b[0]);
  if (!entries.length) throw new Error("Empty term structure");
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (tenor <= first[0]) return first[1];
  if (tenor >= last[0]) return last[1];
  for (let index = 1; index < entries.length; index += 1) {
    const [upperTenor, upperValue] = entries[index];
    if (tenor <= upperTenor) {
      const [lowerTenor, lowerValue] = entries[index - 1];
      const weight = (tenor - lowerTenor) / (upperTenor - lowerTenor);
      return lowerValue + (upperValue - lowerValue) * weight;
    }
  }
  return last[1];
}

export function zeroRate(curve: CurveSnapshot, tenor: number): number {
  return interpolateByTenor(curve.zeroRates, tenor);
}

export function discountFactor(curve: CurveSnapshot, tenor: number, spread = 0): number {
  return Math.exp(-(zeroRate(curve, tenor) + spread) * tenor);
}

export function atmVolatility(underlying: UnderlyingSnapshot, tenor: number): number {
  return interpolateByTenor(underlying.atmVolatility, tenor);
}

/** The quoted smile covers 50% to 150% moneyness; the wings extrapolate flat. */
const SMILE_WING = 0.5;

function clampMoneynessOffset(moneyness: number): number {
  return Math.max(-SMILE_WING, Math.min(SMILE_WING, moneyness - 1));
}

/**
 * Strike-specific implied volatility. The one-year skew slope is scaled by
 * 1/sqrt(tenor), the usual first-order decay of index skew with maturity.
 */
export function impliedVolatility(
  underlying: UnderlyingSnapshot,
  tenor: number,
  moneyness: number,
  model: VolatilityModel = "skew",
): number {
  const atm = atmVolatility(underlying, tenor);
  if (model === "flat") return atm;
  const scale = 1 / Math.sqrt(Math.max(0.25, tenor));
  const offset = clampMoneynessOffset(moneyness);
  const volatility =
    atm + underlying.skewSlope * scale * offset + underlying.skewCurvature * offset * offset;
  return Math.max(0.05, Math.min(1.5, volatility));
}

/** Precomputed smile for one tenor, for use inside simulation loops. */
export function smileFunction(
  underlying: UnderlyingSnapshot,
  tenor: number,
  model: VolatilityModel,
): (moneyness: number) => number {
  const atm = atmVolatility(underlying, tenor);
  if (model === "flat") return () => atm;
  const slope = underlying.skewSlope / Math.sqrt(Math.max(0.25, tenor));
  const curvature = underlying.skewCurvature;
  return (moneyness) => {
    const offset = clampMoneynessOffset(moneyness);
    return Math.max(0.05, Math.min(1.5, atm + slope * offset + curvature * offset * offset));
  };
}

export function underlyingById(id: string): UnderlyingSnapshot {
  const match = snapshot.underlyings.find((underlying) => underlying.id === id);
  if (!match) throw new Error(`Unknown underlying ${id}`);
  return match;
}

export function curveFor(underlying: UnderlyingSnapshot): CurveSnapshot {
  const curve = snapshot.currencies[underlying.currency];
  if (!curve) throw new Error(`No curve for ${underlying.currency}`);
  return curve;
}
