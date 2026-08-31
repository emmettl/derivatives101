import type {
  BarrierType,
  LegOutcome,
  Market,
  OptionLeg,
  OptionType,
  PricingResult,
  RiskMeasures,
  ScenarioRow,
  StrategyMetrics,
  StrategyOutcome,
} from "./types";

export function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const value = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * value);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-value * value);
  return 0.5 * (1 + sign * erf);
}

export function vanillaPrice(
  market: Market,
  optionType: OptionType,
  strike: number,
  spotOverride?: number,
): number {
  const spot = spotOverride ?? market.spot;
  const tenor = Math.max(0.000001, market.tenor);
  const volatility = Math.max(0.000001, market.volatility);
  const rootT = Math.sqrt(tenor);
  const d1 =
    (Math.log(spot / strike) +
      (market.rate - market.dividend + 0.5 * volatility * volatility) * tenor) /
    (volatility * rootT);
  const d2 = d1 - volatility * rootT;
  if (optionType === "call")
    return (
      spot * Math.exp(-market.dividend * tenor) * normCdf(d1) -
      strike * Math.exp(-market.rate * tenor) * normCdf(d2)
    );
  return (
    strike * Math.exp(-market.rate * tenor) * normCdf(-d2) -
    spot * Math.exp(-market.dividend * tenor) * normCdf(-d1)
  );
}

export function hitProbability(market: Market, barrierType: BarrierType, barrier: number): number {
  if (barrierType === "none") return 0;
  const direction = barrierType.startsWith("down") ? "down" : "up";
  if (!Number.isFinite(barrier)) return 0;
  if (direction === "down" && barrier <= 0) return 0;
  if (
    (direction === "down" && barrier >= market.spot) ||
    (direction === "up" && barrier <= market.spot)
  )
    return 1;
  const sigma = Math.max(0.000001, market.volatility);
  const tenor = Math.max(0.000001, market.tenor);
  const drift = market.rate - market.dividend - 0.5 * sigma * sigma;
  const root = sigma * Math.sqrt(tenor);
  const h = Math.log(barrier / market.spot);
  let probability: number;
  if (direction === "up") {
    probability =
      normCdf((drift * tenor - h) / root) +
      Math.exp((2 * drift * h) / (sigma * sigma)) * normCdf((-drift * tenor - h) / root);
  } else {
    probability =
      normCdf((-drift * tenor + h) / root) +
      Math.exp((2 * drift * h) / (sigma * sigma)) * normCdf((drift * tenor + h) / root);
  }
  return Math.max(0, Math.min(1, probability));
}

export function premium(market: Market, optionLeg: OptionLeg): PricingResult {
  const vanilla = vanillaPrice(market, optionLeg.type, optionLeg.strike);
  if (optionLeg.barrierType === "none")
    return { premium: vanilla, vanilla, weight: 1, hitProbability: 0 };
  const probability = hitProbability(market, optionLeg.barrierType, optionLeg.barrier);
  const weight = optionLeg.barrierType.endsWith("-in") ? probability : 1 - probability;
  return { premium: vanilla * weight, vanilla, weight, hitProbability: probability };
}

export function barrierHit(
  optionLeg: OptionLeg,
  terminalSpot: number,
  observedLow: number,
  observedHigh: number,
  initialSpot: number,
): boolean {
  if (optionLeg.barrierType === "none") return false;
  const low = Math.min(observedLow, terminalSpot, initialSpot);
  const high = Math.max(observedHigh, terminalSpot, initialSpot);
  return optionLeg.barrierType.startsWith("down")
    ? low <= optionLeg.barrier
    : high >= optionLeg.barrier;
}

export function isActive(optionLeg: OptionLeg, hit: boolean): boolean {
  if (optionLeg.barrierType === "none") return true;
  return optionLeg.barrierType.endsWith("-in") ? hit : !hit;
}

export function intrinsic(optionType: OptionType, strike: number, terminalSpot: number): number {
  return optionType === "call"
    ? Math.max(terminalSpot - strike, 0)
    : Math.max(strike - terminalSpot, 0);
}

export function legOutcome(
  market: Market,
  optionLeg: OptionLeg,
  terminalSpot: number,
  observedLow: number,
  observedHigh: number,
): LegOutcome {
  if (!optionLeg.enabled)
    return {
      payoff: 0,
      pnl: 0,
      signedQuantity: 0,
      premium: 0,
      hit: false,
      active: false,
      pricing: null,
    };
  const pricing = premium(market, optionLeg);
  const hit = barrierHit(optionLeg, terminalSpot, observedLow, observedHigh, market.spot);
  const active = isActive(optionLeg, hit);
  const payoff = active ? intrinsic(optionLeg.type, optionLeg.strike, terminalSpot) : 0;
  const signedQuantity = (optionLeg.side === "long" ? 1 : -1) * optionLeg.quantity;
  return {
    payoff,
    pnl: signedQuantity * (payoff - pricing.premium),
    signedQuantity,
    premium: pricing.premium,
    hit,
    active,
    pricing,
  };
}

export function strategyOutcome(
  market: Market,
  legs: OptionLeg[],
  terminalSpot: number,
  observedLow: number,
  observedHigh: number,
): StrategyOutcome {
  const outcomes = legs.map((optionLeg) =>
    legOutcome(market, optionLeg, terminalSpot, observedLow, observedHigh),
  );
  return {
    terminalSpot,
    legs: outcomes,
    pnl: outcomes.reduce((sum, result) => sum + result.pnl, 0),
    payoff: outcomes.reduce((sum, result) => sum + result.signedQuantity * result.payoff, 0),
    netPremium: outcomes.reduce((sum, result) => sum + result.signedQuantity * result.premium, 0),
  };
}

export function strategyCurve(
  market: Market,
  legs: OptionLeg[],
  observedLow: number,
  observedHigh: number,
  minimum: number,
  maximum: number,
  count = 241,
): StrategyOutcome[] {
  const points: StrategyOutcome[] = [];
  const total = Math.max(3, count);
  for (let index = 0; index < total; index += 1) {
    const terminalSpot = minimum + ((maximum - minimum) * index) / (total - 1);
    points.push(strategyOutcome(market, legs, terminalSpot, observedLow, observedHigh));
  }
  return points;
}

export function strategyValue(market: Market, legs: OptionLeg[]): number {
  return legs.reduce((sum, optionLeg) => {
    if (!optionLeg.enabled) return sum;
    const sign = optionLeg.side === "long" ? 1 : -1;
    return sum + sign * optionLeg.quantity * premium(market, optionLeg).premium;
  }, 0);
}

export function riskMeasures(market: Market, legs: OptionLeg[]): RiskMeasures {
  const spotBump = Math.max(0.1, market.spot * 0.005);
  const volatilityBump = 0.01;
  const value = strategyValue(market, legs);
  const spotUp = strategyValue({ ...market, spot: market.spot + spotBump }, legs);
  const spotDown = strategyValue({ ...market, spot: Math.max(0.01, market.spot - spotBump) }, legs);
  const volatilityUp = strategyValue(
    { ...market, volatility: market.volatility + volatilityBump },
    legs,
  );
  const volatilityDown = strategyValue(
    { ...market, volatility: Math.max(0.0001, market.volatility - volatilityBump) },
    legs,
  );
  const valueInThirtyDays = strategyValue(
    { ...market, tenor: Math.max(0.000001, market.tenor - 30 / 365) },
    legs,
  );
  return {
    value,
    delta: (spotUp - spotDown) / (2 * spotBump),
    gamma: (spotUp - 2 * value + spotDown) / (spotBump * spotBump),
    vega: (volatilityUp - volatilityDown) / 2,
    theta30: valueInThirtyDays - value,
  };
}

export function scenarioMatrix(
  market: Market,
  legs: OptionLeg[],
  spotMoves: number[],
  volatilityMoves: number[],
): ScenarioRow[] {
  const entryValue = strategyValue(market, legs);
  return spotMoves.map((spotMove) => ({
    spotMove,
    spot: market.spot * (1 + spotMove),
    cells: volatilityMoves.map((volatilityMove) => {
      const shockedMarket = {
        ...market,
        spot: market.spot * (1 + spotMove),
        volatility: Math.max(0.0001, market.volatility + volatilityMove),
      };
      const value = strategyValue(shockedMarket, legs);
      return {
        volatilityMove,
        volatility: shockedMarket.volatility,
        value,
        pnl: value - entryValue,
      };
    }),
  }));
}

export function breakEvens(points: StrategyOutcome[]): number[] {
  const values: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    if (left.pnl === 0) values.push(left.terminalSpot);
    const stateChanged = left.legs.some(
      (legResult, legIndex) => legResult.active !== right.legs[legIndex].active,
    );
    if (left.pnl * right.pnl < 0 && !stateChanged) {
      const weight = -left.pnl / (right.pnl - left.pnl);
      values.push(left.terminalSpot + weight * (right.terminalSpot - left.terminalSpot));
    }
  }
  return values.filter((value, index) => index === 0 || Math.abs(value - values[index - 1]) > 0.25);
}

export function metrics(
  market: Market,
  legs: OptionLeg[],
  observedLow: number,
  observedHigh: number,
  selectedTerminal: number,
): StrategyMetrics {
  const minimum = Math.max(1, market.spot * 0.4);
  const maximum = market.spot * 1.6;
  const curve = strategyCurve(market, legs, observedLow, observedHigh, minimum, maximum, 321);
  const pnl = curve.map((point) => point.pnl);
  const selected = strategyOutcome(market, legs, selectedTerminal, observedLow, observedHigh);
  return {
    curve,
    selected,
    breakEvens: breakEvens(curve),
    minimumPnl: Math.min(...pnl),
    maximumPnl: Math.max(...pnl),
    netPremium: selected.netPremium,
  };
}
