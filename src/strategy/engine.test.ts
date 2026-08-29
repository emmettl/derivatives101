import { describe, expect, it } from "vitest";
import { MAX_LEGS, clonePreset, presets } from "./config";
import { legOutcome, metrics, riskMeasures, scenarioMatrix } from "./engine";
import type { Market, OptionLeg } from "./types";

const market: Market = { spot: 100, volatility: 0.25, tenor: 1, rate: 0.03, dividend: 0.01 };

describe("strategy presets", () => {
  it.each(Object.values(presets).map(preset => [preset.name, preset] as const))("produces finite results for %s", (_name, preset) => {
    const strategy = clonePreset(preset, market.spot);
    const result = metrics(market, strategy.legs, 88, 114, 100);
    const risk = riskMeasures(market, strategy.legs);
    expect(strategy.legs).toHaveLength(MAX_LEGS);
    expect(Number.isFinite(result.selected.pnl)).toBe(true);
    expect(Object.values(risk).every(Number.isFinite)).toBe(true);
  });

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
  it("uses the opening value as the unshocked scenario baseline", () => {
    const condor = clonePreset(presets.ironCondor, market.spot).legs;
    const scenarios = scenarioMatrix(market, condor, [-0.1, 0, 0.1], [-0.05, 0, 0.05]);
    expect(scenarios[1].cells[1].pnl).toBe(0);
  });

  it("counts both path history and terminal spot for knock-in activation", () => {
    const downIn: OptionLeg = { id: 1, enabled: true, side: "long", quantity: 1, type: "put", strike: 90, barrierType: "down-in", barrier: 75 };
    expect(legOutcome(market, downIn, 70, 70, 110).active).toBe(true);
    expect(legOutcome(market, downIn, 70, 80, 110).active).toBe(true);
    expect(legOutcome(market, downIn, 85, 80, 110).active).toBe(false);
  });
});
