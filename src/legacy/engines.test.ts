import { describe, expect, it } from "vitest";
import * as credit from "./credit-liquidity/engine";
import * as currency from "./currency/engine";
import * as forward from "./forward/engine";
import * as hedging from "./hedging/engine";
import * as risk from "./risk/engine";
import * as skew from "./skew/engine";
import * as stepDown from "./stepdown/engine";
import * as valuation from "./valuation/engine";

describe("migrated standalone calculation engines", () => {
  it("preserves credit and liquidity valuation states", () => {
    const normal = credit.value(credit.presets.normal);
    const closed = credit.value(credit.presets.closed);

    expect(normal.bid).not.toBeNull();
    expect(closed.bid).toBeNull();
    expect(normal.creditAdjusted).toBeLessThan(normal.defaultFree);
  });

  it("keeps currency effects multiplicative", () => {
    const result = currency.outcomes({
      equityTerminal: 125,
      fxTerminal: 80,
      strike: 100,
      participation: 1,
    });

    expect(result.directHomeValue).toBe(100);
    expect(result.quantoOption).toBe(25);
    expect(result.compoOption).toBe(20);
  });

  it("maintains forward parity", () => {
    const result = forward.metrics(forward.presets.financing);
    expect(result.parityLeft).toBeCloseTo(result.parityRight, 6);
  });

  it("produces deterministic hedging paths", () => {
    const config: hedging.HedgeConfig = {
      pathId: "random",
      seed: 42,
      startSpot: 100,
      endSpot: 110,
      strike: 100,
      tenor: 1,
      rate: 0.02,
      dividend: 0,
      impliedVolatility: 0.22,
      realizedVolatility: 0.28,
      hedgeEvery: 5,
      costBps: 2,
      steps: 252,
    };

    expect(hedging.simulate(config).finalPnl).toBe(hedging.simulate(config).finalPnl);
  });

  it("retains the intended risk signs", () => {
    const products = risk.designProducts();
    const market = {
      spot: 100,
      remaining: 1,
      volatility: 0.2,
      rate: 0.03,
      issuerSpread: 0.015,
      dividend: 0.02,
    };

    expect(risk.sensitivities(products.protected, market).gamma).toBeGreaterThan(0);
    expect(risk.sensitivities(products.reverse, market).gamma).toBeLessThan(0);
  });

  it("applies skew to local volatility and product terms", () => {
    const config: skew.SkewConfig = {
      spot: 100,
      atmVolatility: 0.2,
      skew: -0.22,
      curvature: 0.08,
      tenor: 2,
      rate: 0.03,
      dividend: 0.02,
      putStrike: 70,
      callStrike: 110,
      optionBudget: 10,
    };
    expect(skew.surfaceVol(config, 70)).toBeGreaterThan(config.atmVolatility);
    expect(skew.productTerms(config).surfaceCoupon).toBeGreaterThan(0);
  });

  it("ends a step-down note after its first call", () => {
    const result = stepDown.evaluate({
      path: stepDown.presets.earlyRally.path,
      startCall: 100,
      stepSize: 5,
      callFloor: 70,
      couponBarrier: 70,
      couponPerObservation: 2,
      protectionBarrier: 60,
    });
    expect(result.calledIndex).toBe(0);
    expect(result.events[1].active).toBe(false);
  });

  it("marks a designed note consistently", () => {
    const note = valuation.designNote({
      nominal: 100,
      issuePrice: 100,
      upfrontCost: 2,
      initialSpot: 100,
      strike: 100,
      tenor: 5,
      rate: 0.03,
      issuerSpread: 0.015,
      volatility: 0.18,
      dividend: 0.02,
    });
    const marked = valuation.markNote(note, {
      elapsed: 5,
      spot: 120,
      rate: 0.03,
      issuerSpread: 0.015,
      volatility: 0.18,
      dividend: 0.02,
      exitCost: 1,
    });
    expect(marked.modelValue).toBe(marked.maturityPayoff);
  });
});
