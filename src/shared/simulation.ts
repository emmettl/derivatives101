export const TRADING_DAYS = 252;

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
