import { describe, expect, it } from "vitest";
import { MAX_LEGS, clonePreset, presets } from "./config";
import {
  hitProbability,
  legOutcome,
  metrics,
  premium,
  riskMeasures,
  scenarioMatrix,
} from "./engine";
import { simulateStrategy } from "./simulation";
import type { Market, OptionLeg } from "./types";

const market: Market = { spot: 100, volatility: 0.25, tenor: 1, rate: 0.03, dividend: 0.01 };

describe("strategy presets", () => {
  it.each(Object.values(presets).map((preset) => [preset.name, preset] as const))(
    "produces finite results for %s",
    (_name, preset) => {
      const strategy = clonePreset(preset, market.spot);
      const result = metrics(market, strategy.legs, 88, 114, 100);
      const risk = riskMeasures(market, strategy.legs);
      expect(strategy.legs).toHaveLength(MAX_LEGS);
      expect(Number.isFinite(result.selected.pnl)).toBe(true);
      expect(Object.values(risk).every(Number.isFinite)).toBe(true);
    },
  );

  it("models the default iron condor as a bounded credit strategy", () => {
    const condor = clonePreset(presets.ironCondor, market.spot).legs;
    const result = metrics(market, condor, 88, 114, 100);
    expect(result.netPremium).toBeLessThan(0);
    expect(result.minimumPnl).toBeLessThan(0);
    expect(result.maximumPnl).toBeGreaterThan(0);
    expect(result.breakEvens).toHaveLength(2);
  });

  it("does not mutate a preset when scaling its strikes", () => {
    const scaled = clonePreset(presets.butterfly, 125);
    expect(scaled.legs[0].strike).toBe(112.5);
    expect(presets.butterfly.legs[0].strike).toBe(90);
  });
});

describe("risk and path mechanics", () => {
  it("keeps a zero legacy barrier from producing NaN", () => {
    const downIn = clonePreset(presets.longCall, market.spot).legs[0];
    downIn.barrierType = "down-in";
    downIn.barrier = 0;
    expect(hitProbability(market, downIn.barrierType, downIn.barrier)).toBe(0);
    expect(Number.isFinite(premium(market, downIn).premium)).toBe(true);
  });

  it("uses the opening value as the unshocked scenario baseline", () => {
    const condor = clonePreset(presets.ironCondor, market.spot).legs;
    const scenarios = scenarioMatrix(market, condor, [-0.1, 0, 0.1], [-0.05, 0, 0.05]);
    expect(scenarios[1].cells[1].pnl).toBe(0);
  });

  it("counts both path history and terminal spot for knock-in activation", () => {
    const downIn: OptionLeg = {
      id: 1,
      enabled: true,
      side: "long",
      quantity: 1,
      type: "put",
      strike: 90,
      barrierType: "down-in",
      barrier: 75,
    };
    expect(legOutcome(market, downIn, 70, 70, 110).active).toBe(true);
    expect(legOutcome(market, downIn, 70, 80, 110).active).toBe(true);
    expect(legOutcome(market, downIn, 85, 80, 110).active).toBe(false);
  });
});

describe("strategy Monte Carlo", () => {
  it("uses one shared path to value the complete package", () => {
    const strategy = clonePreset(presets.butterfly, market.spot).legs;
    const result = simulateStrategy({
      id: 1,
      sample: 1,
      market,
      legs: strategy,
      observedLow: 88,
      observedHigh: 114,
      seed: 481516,
      paths: 2000,
      drawN: 12,
      steps: 40,
    });
    expect(result.paths).toHaveLength(12);
    expect(result.terminalPnls).toHaveLength(2000);
    expect(result.probabilityOfProfit).toBeGreaterThan(0);
    expect(result.probabilityOfProfit).toBeLessThan(1);
    expect(Number.isFinite(result.estimate)).toBe(true);
    expect(result.percentile05).toBeLessThanOrEqual(result.medianPnl);
    expect(result.medianPnl).toBeLessThanOrEqual(result.percentile95);
  });

  it("carries an already-observed barrier touch into every future path", () => {
    const downIn = clonePreset(presets.barrierWings, market.spot).legs;
    const touched = simulateStrategy({
      id: 1,
      sample: 1,
      market,
      legs: downIn,
      observedLow: 70,
      observedHigh: 114,
      seed: 12,
      paths: 200,
      drawN: 0,
      steps: 10,
    });
    expect(touched.terminalPnls.every(Number.isFinite)).toBe(true);
  });
});
