"use strict";

export type HedgePath = "random" | "selloff" | "late";

export interface HedgeConfig {
  pathId?: HedgePath;
  seed?: number;
  startSpot: number;
  endSpot: number;
  strike: number;
  tenor: number;
  rate: number;
  dividend: number;
  impliedVolatility: number;
  realizedVolatility: number;
  hedgeEvery: number;
  costBps: number;
  steps?: number;
}

interface PathPoint {
  day: number;
  spot: number;
  logReturn: number;
}

interface HedgeRecord {
  day: number;
  spot: number;
  optionValue: number;
  delta: number;
  hedge: number;
  trade: number;
  transactionCost: number;
  portfolio: number;
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function callValueDelta(
  spot: number,
  strike: number,
  remaining: number,
  rate: number,
  dividend: number,
  volatility: number,
) {
  if (remaining <= 0)
    return {
      value: Math.max(spot - strike, 0),
      delta: spot > strike ? 1 : spot < strike ? 0 : 0.5,
    };
  if (volatility <= 0) {
    const forwardIntrinsic =
      spot * Math.exp(-dividend * remaining) - strike * Math.exp(-rate * remaining);
    return {
      value: Math.max(forwardIntrinsic, 0),
      delta: forwardIntrinsic > 0 ? Math.exp(-dividend * remaining) : 0,
    };
  }
  const rootT = Math.sqrt(remaining);
  const d1 =
    (Math.log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * remaining) /
    (volatility * rootT);
  const d2 = d1 - volatility * rootT;
  return {
    value:
      spot * Math.exp(-dividend * remaining) * normCdf(d1) -
      strike * Math.exp(-rate * remaining) * normCdf(d2),
    delta: Math.exp(-dividend * remaining) * normCdf(d1),
  };
}

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return function () {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normals(count: number, seed: number): number[] {
  const random = rng(seed);
  const output: number[] = [];
  while (output.length < count) {
    const u1 = Math.max(1e-12, random());
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    output.push(radius * Math.cos(2 * Math.PI * u2));
    if (output.length < count) output.push(radius * Math.sin(2 * Math.PI * u2));
  }
  return output;
}

function normalize(values: number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map((value) => value - mean);
  const deviation =
    Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0) / centered.length) || 1;
  return centered.map((value) => value / deviation);
}

function pathShape(kind: HedgePath, steps: number, seed: number): number[] {
  const noise = normals(steps, seed);
  if (kind === "selloff") {
    return normalize(
      noise.map((value, index) => value * 0.8 + (index < 32 ? -1.3 : index < 105 ? 0.45 : 0)),
    );
  }
  if (kind === "late") {
    return normalize(
      noise.map(
        (value, index) =>
          value * (index < 150 ? 0.3 : 1.65) + (index > 188 && index < 214 ? -0.7 : 0),
      ),
    );
  }
  return normalize(noise);
}

function generatePath(config: HedgeConfig): { points: PathPoint[]; realizedVolatility: number } {
  const steps = config.steps || 252;
  const shape = pathShape(config.pathId || "random", steps, config.seed || 1);
  const totalLogReturn = Math.log(config.endSpot / config.startSpot);
  const dailyScale = config.realizedVolatility / Math.sqrt(252);
  const points: PathPoint[] = [{ day: 0, spot: config.startSpot, logReturn: 0 }];
  let logSpot = Math.log(config.startSpot);
  for (let index = 0; index < steps; index += 1) {
    const logReturn = totalLogReturn / steps + dailyScale * shape[index];
    logSpot += logReturn;
    points.push({ day: index + 1, spot: Math.exp(logSpot), logReturn });
  }
  points[steps].spot = config.endSpot;
  const mean = points.slice(1).reduce((sum, point) => sum + point.logReturn, 0) / steps;
  const variance =
    points.slice(1).reduce((sum, point) => sum + Math.pow(point.logReturn - mean, 2), 0) / steps;
  return { points, realizedVolatility: Math.sqrt(variance * 252) };
}

function runHedge(config: HedgeConfig, costBps: number) {
  const generated = generatePath(config);
  const points = generated.points;
  const steps = points.length - 1;
  const dt = config.tenor / steps;
  const initialOption = callValueDelta(
    config.startSpot,
    config.strike,
    config.tenor,
    config.rate,
    config.dividend,
    config.impliedVolatility,
  );
  const hedgeEvery = Number(config.hedgeEvery) || 0;
  const costRate = (costBps || 0) / 10000;
  let hedge = hedgeEvery ? -initialOption.delta : 0;
  let transactionCost = Math.abs(hedge) * config.startSpot * costRate;
  let totalCosts = transactionCost;
  let turnover = Math.abs(hedge) * config.startSpot;
  let trades = hedgeEvery ? 1 : 0;
  let cash = -initialOption.value - hedge * config.startSpot - transactionCost;
  const records: HedgeRecord[] = [
    {
      day: 0,
      spot: config.startSpot,
      optionValue: initialOption.value,
      delta: initialOption.delta,
      hedge,
      trade: hedge,
      transactionCost,
      portfolio: initialOption.value + hedge * config.startSpot + cash,
    },
  ];

  for (let day = 1; day <= steps; day += 1) {
    cash *= Math.exp(config.rate * dt);
    const remaining = Math.max(0, config.tenor - day * dt);
    const option = callValueDelta(
      points[day].spot,
      config.strike,
      remaining,
      config.rate,
      config.dividend,
      config.impliedVolatility,
    );
    let trade = 0;
    transactionCost = 0;
    if (hedgeEvery && day < steps && day % hedgeEvery === 0) {
      const newHedge = -option.delta;
      trade = newHedge - hedge;
      transactionCost = Math.abs(trade) * points[day].spot * costRate;
      cash -= trade * points[day].spot + transactionCost;
      hedge = newHedge;
      totalCosts += transactionCost;
      turnover += Math.abs(trade) * points[day].spot;
      trades += 1;
    }
    records.push({
      day,
      spot: points[day].spot,
      optionValue: option.value,
      delta: option.delta,
      hedge,
      trade,
      transactionCost,
      portfolio: option.value + hedge * points[day].spot + cash,
    });
  }

  const finalSpot = points[steps].spot;
  const payoff = Math.max(finalSpot - config.strike, 0);
  let closeCost = 0;
  if (hedgeEvery && Math.abs(hedge) > 1e-12) {
    const closingTrade = -hedge;
    closeCost = Math.abs(closingTrade) * finalSpot * costRate;
    cash -= closingTrade * finalSpot + closeCost;
    totalCosts += closeCost;
    turnover += Math.abs(closingTrade) * finalSpot;
    trades += 1;
    const last = records[records.length - 1];
    last.trade += closingTrade;
    last.transactionCost += closeCost;
    last.hedge = 0;
    last.portfolio = payoff + cash;
  }
  return {
    records,
    initialPremium: initialOption.value,
    payoff,
    finalPnl: payoff + cash,
    totalCosts,
    turnover,
    trades,
    realizedVolatility: generated.realizedVolatility,
  };
}

function simulate(config: HedgeConfig) {
  const withCosts = runHedge(config, config.costBps);
  const withoutCosts = config.costBps ? runHedge(config, 0) : withCosts;
  return Object.assign({}, withCosts, {
    frictionlessPnl: withoutCosts.finalPnl,
    costDrag: withCosts.finalPnl - withoutCosts.finalPnl,
  });
}

function compare(config: HedgeConfig) {
  return (["random", "selloff", "late"] as const).map((pathId) => {
    const result = simulate(Object.assign({}, config, { pathId }));
    return { pathId, result };
  });
}

export { normCdf, callValueDelta, generatePath, simulate, compare };
