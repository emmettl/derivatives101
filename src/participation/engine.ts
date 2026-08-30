import {
  TRADING_DAYS as DAYS,
  normalRandom as normal,
  seededRandom as seeded,
} from "../shared/simulation";

const SPOT = 100,
  STRIKE = 100;

export type ParticipationProduct = "outperformance" | "bonus" | "bonus_outperformance";
export type BarrierMonitoring = "daily" | "maturity";

export interface ParticipationPayoffParams {
  product: ParticipationProduct;
  participation: number;
  bonus: number;
}

export interface ParticipationParams extends ParticipationPayoffParams {
  barrier: number;
  monitoring: BarrierMonitoring;
  finalLevel: number;
  tenor: number;
  vol: number;
  dividend: number;
  fee: number;
}

type Anchor = readonly [number, number];

function hasBonus(p: ParticipationPayoffParams): boolean {
  return p.product !== "outperformance";
}
function participation(p: ParticipationPayoffParams): number {
  return p.product === "bonus" ? 1 : Number(p.participation);
}
function outperformance(level: number, p: ParticipationPayoffParams): number {
  const factor = participation(p);
  return level <= STRIKE ? level : STRIKE + factor * (level - STRIKE);
}
function redemption(level: number, breached: boolean, p: ParticipationPayoffParams): number {
  const base = outperformance(level, p);
  return hasBonus(p) && !breached ? Math.max(Number(p.bonus), base) : base;
}
function crossover(p: ParticipationPayoffParams): number {
  return hasBonus(p) ? STRIKE + Math.max(0, Number(p.bonus) - STRIKE) / participation(p) : STRIKE;
}
function barrierState(
  path: Float64Array,
  p: ParticipationParams,
): { breached: boolean; day: number | null } {
  if (!hasBonus(p)) return { breached: false, day: null };
  if (p.monitoring === "maturity") {
    const day = path.length - 1;
    return { breached: path[day] <= p.barrier, day: path[day] <= p.barrier ? day : null };
  }
  for (let day = 1; day < path.length; day++)
    if (path[day] <= p.barrier) return { breached: true, day };
  return { breached: false, day: null };
}
function interpolate(anchors: readonly Anchor[], t: number): number {
  for (let i = 1; i < anchors.length; i++)
    if (t <= anchors[i][0]) {
      const [t0, a] = anchors[i - 1],
        [t1, b] = anchors[i],
        weight = (t - t0) / (t1 - t0);
      return a + (b - a) * weight;
    }
  return anchors.at(-1)?.[1] ?? 0;
}
function pairedPaths(p: ParticipationParams): { safe: Float64Array; touch: Float64Array } {
  const end = Math.max(2, Math.round(p.tenor * DAYS)),
    final = Number(p.finalLevel),
    barrier = Number(p.barrier),
    safe = new Float64Array(end + 1),
    touch = new Float64Array(end + 1);
  const safeAnchors: Anchor[] = [
      [0, 100],
      [0.28, Math.max(98, barrier + 12)],
      [0.58, Math.max(barrier + 8, (100 + final) / 2)],
      [0.8, Math.max(barrier + 5, final + 2)],
      [1, final],
    ],
    touchAnchors: Anchor[] = [
      [0, 100],
      [0.3, Math.max(92, barrier + 10)],
      [0.5, barrier - 2],
      [0.7, Math.max(barrier + 5, (barrier + final) / 2)],
      [1, final],
    ];
  for (let day = 0; day <= end; day++) {
    const t = day / end;
    safe[day] = interpolate(safeAnchors, t);
    touch[day] = interpolate(touchAnchors, t);
  }
  return { safe, touch };
}
function pairOutcomes(p: ParticipationParams) {
  const paths = pairedPaths(p),
    safeState = barrierState(paths.safe, p),
    touchState = barrierState(paths.touch, p),
    final = Number(p.finalLevel);
  return {
    paths,
    final,
    safe: { ...safeState, redemption: redemption(final, safeState.breached, p) },
    touch: { ...touchState, redemption: redemption(final, touchState.breached, p) },
  };
}
function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1,
    z = Math.abs(x) / Math.sqrt(2),
    t = 1 / (1 + 0.3275911 * z),
    a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}
function callPrice(
  spot: number,
  strike: number,
  tenor: number,
  rate: number,
  dividend: number,
  vol: number,
): number {
  if (tenor <= 0 || vol <= 0)
    return Math.max(0, spot * Math.exp(-dividend * tenor) - strike * Math.exp(-rate * tenor));
  const rootT = Math.sqrt(tenor),
    d1 = (Math.log(spot / strike) + (rate - dividend + 0.5 * vol * vol) * tenor) / (vol * rootT),
    d2 = d1 - vol * rootT;
  return (
    spot * Math.exp(-dividend * tenor) * normCdf(d1) -
    strike * Math.exp(-rate * tenor) * normCdf(d2)
  );
}
function budget(p: ParticipationParams) {
  const tenor = Number(p.tenor),
    vol = Number(p.vol) / 100,
    dividend = Number(p.dividend) / 100,
    fee = Number(p.fee),
    factor = participation(p),
    zeroCall = SPOT * Math.exp(-dividend * tenor),
    upsideCost = (factor - 1) * callPrice(SPOT, STRIKE, tenor, 0, dividend, vol),
    available = Math.max(0, SPOT - zeroCall - fee);
  if (!hasBonus(p)) {
    const total = upsideCost;
    return {
      zeroCall,
      available,
      upsideCost,
      protectionCost: 0,
      totalFeatureCost: total,
      productValue: zeroCall + total,
      budgetUse: available ? total / available : Infinity,
      steps: 0,
    };
  }
  const steps = Math.max(126, Math.round(DAYS * tenor)),
    dt = tenor / steps,
    u = Math.exp(vol * Math.sqrt(dt)),
    d = 1 / u,
    growth = Math.exp(-dividend * dt),
    prob = Math.max(0, Math.min(1, (growth - d) / (u - d))),
    discount = 1,
    breached = new Float64Array(steps + 1),
    alive = new Float64Array(steps + 1),
    bonus = Number(p.bonus),
    barrier = Number(p.barrier);
  for (let j = 0; j <= steps; j++) {
    const level = SPOT * Math.pow(u, j) * Math.pow(d, steps - j),
      base = outperformance(level, p);
    breached[j] = base;
    alive[j] = level <= barrier ? base : Math.max(bonus, base);
  }
  for (let i = steps - 1; i >= 0; i--)
    for (let j = 0; j <= i; j++) {
      const breachedValue = discount * (prob * breached[j + 1] + (1 - prob) * breached[j]),
        aliveValue = discount * (prob * alive[j + 1] + (1 - prob) * alive[j]);
      breached[j] = breachedValue;
      if (p.monitoring === "daily") {
        const level = SPOT * Math.pow(u, j) * Math.pow(d, i - j);
        alive[j] = level <= barrier ? breachedValue : aliveValue;
      } else alive[j] = aliveValue;
    }
  const outperformanceValue = zeroCall + upsideCost,
    productValue = alive[0],
    protectionCost = Math.max(0, productValue - outperformanceValue),
    totalFeatureCost = upsideCost + protectionCost;
  return {
    zeroCall,
    available,
    upsideCost,
    protectionCost,
    totalFeatureCost,
    productValue,
    budgetUse: available ? totalFeatureCost / available : Infinity,
    steps,
  };
}
function simulate(p: ParticipationParams, seed = 1, count = 2000) {
  const random = seeded(seed),
    steps = Math.max(2, Math.round(p.tenor * DAYS)),
    dt = 1 / DAYS,
    sigma = p.vol / 100,
    drift = -0.5 * sigma * sigma * dt,
    shock = sigma * Math.sqrt(dt),
    returns = [];
  let breachedCount = 0,
    floorCount = 0,
    leveragedCount = 0,
    total = 0;
  for (let pathIndex = 0; pathIndex < count; pathIndex++) {
    let level = SPOT,
      breached = false;
    for (let day = 1; day <= steps; day++) {
      level = Math.max(0.01, level * Math.exp(drift + shock * normal(random)));
      if (hasBonus(p) && p.monitoring === "daily" && level <= p.barrier) breached = true;
    }
    if (hasBonus(p) && p.monitoring === "maturity" && level <= p.barrier) breached = true;
    const base = outperformance(level, p),
      payoff = redemption(level, breached, p),
      value = payoff - SPOT;
    returns.push(value);
    total += value;
    breachedCount += breached ? 1 : 0;
    floorCount += hasBonus(p) && !breached && payoff > base + 1e-8 ? 1 : 0;
    leveragedCount += level > STRIKE && Math.abs(payoff - base) < 1e-8 ? 1 : 0;
  }
  returns.sort((a, b) => a - b);
  return {
    count,
    returns,
    stats: {
      breached: breachedCount / count,
      floor: floorCount / count,
      leveraged: leveragedCount / count,
      averageReturn: total / count,
    },
  };
}

export {
  DAYS,
  SPOT,
  STRIKE,
  seeded,
  hasBonus,
  participation,
  outperformance,
  redemption,
  crossover,
  barrierState,
  pairedPaths,
  pairOutcomes,
  callPrice,
  budget,
  simulate,
};
