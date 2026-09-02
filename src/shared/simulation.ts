export const TRADING_DAYS = 252;

export type PathVolatilityModel = "flat" | "downside-skew";

const EQUITY_SKEW = -0.22;
const EQUITY_CURVATURE = 0.08;

export function pathVolatility(
  level: number,
  initialLevel: number,
  atmVolatilityPercent: number,
  model: PathVolatilityModel = "flat",
): number {
  const atmVolatility = atmVolatilityPercent / 100;
  if (model === "flat") return atmVolatility;
  const moneyness = level / initialLevel - 1;
  return Math.max(
    0.03,
    Math.min(
      1.5,
      atmVolatility + EQUITY_SKEW * moneyness + EQUITY_CURVATURE * moneyness * moneyness,
    ),
  );
}

export function nextZeroDriftLevel(
  level: number,
  initialLevel: number,
  atmVolatilityPercent: number,
  timeStep: number,
  normalShock: number,
  model: PathVolatilityModel = "flat",
): number {
  const volatility = pathVolatility(level, initialLevel, atmVolatilityPercent, model);
  return Math.max(
    0.01,
    level *
      Math.exp(
        -0.5 * volatility * volatility * timeStep + volatility * Math.sqrt(timeStep) * normalShock,
      ),
  );
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function normalRandom(random: () => number): number {
  let u = 0;
  let v = 0;
  while (!u) u = random();
  while (!v) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function observationDays(tenor: number, frequency: number): number[] {
  const end = Math.round(tenor * TRADING_DAYS);
  const count = Math.max(1, Math.round(tenor * frequency));
  const days = Array.from({ length: count }, (_, index) =>
    Math.min(end, Math.round(((index + 1) * end) / count)),
  );
  return [...new Set(days)];
}

export function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
