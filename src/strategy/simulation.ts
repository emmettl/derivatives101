import { average, normalRandom, seededRandom } from "../shared/simulation";
import { strategyOutcome, strategyValue } from "./engine";
import type { StrategySimulationRequest, StrategySimulationResult } from "./types";

function percentile(sorted: Float64Array, proportion: number): number {
  if (!sorted.length) return 0;
  const position = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * proportion));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function simulateStrategy(request: StrategySimulationRequest): StrategySimulationResult {
  const {
    id,
    sample,
    market,
    legs,
    observedLow,
    observedHigh,
    seed,
    paths: pathCount = 8000,
    drawN = 48,
    steps = 126,
  } = request;
  const random = seededRandom(seed);
  const timeStep = market.tenor / steps;
  const drift =
    (market.rate - market.dividend - 0.5 * market.volatility * market.volatility) * timeStep;
  const shock = market.volatility * Math.sqrt(timeStep);
  const samplePaths: Float64Array[] = [];
  const pathPnls = new Float64Array(Math.min(drawN, pathCount));
  const terminalPnls = new Float64Array(pathCount);
  let discountedPayoffSum = 0;
  let profitable = 0;

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    let spot = market.spot;
    let low = Math.min(observedLow, spot);
    let high = Math.max(observedHigh, spot);
    const path = pathIndex < drawN ? new Float64Array(steps + 1) : null;
    if (path) path[0] = spot;
    for (let step = 1; step <= steps; step += 1) {
      spot *= Math.exp(drift + shock * normalRandom(random));
      low = Math.min(low, spot);
      high = Math.max(high, spot);
      if (path) path[step] = spot;
    }
    const outcome = strategyOutcome(market, legs, spot, low, high);
    terminalPnls[pathIndex] = outcome.pnl;
    discountedPayoffSum += Math.exp(-market.rate * market.tenor) * outcome.payoff;
    if (outcome.pnl > 0) profitable += 1;
    if (path) {
      samplePaths.push(path);
      pathPnls[pathIndex] = outcome.pnl;
    }
  }

  const sorted = Float64Array.from(terminalPnls).sort();
  return {
    id,
    sample,
    market,
    paths: samplePaths,
    pathPnls,
    terminalPnls,
    estimate: discountedPayoffSum / pathCount,
    currentValue: strategyValue(market, legs),
    probabilityOfProfit: profitable / pathCount,
    medianPnl: percentile(sorted, 0.5),
    percentile05: percentile(sorted, 0.05),
    percentile95: percentile(sorted, 0.95),
    steps,
  };
}

export function meanTerminalPnl(result: StrategySimulationResult): number {
  return average(Array.from(result.terminalPnls));
}
