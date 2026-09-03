import { describe, expect, it } from "vitest";
import {
  autocallBarrierSolve,
  bisect,
  capSolve,
  couponAnnuity,
  priceAutocall,
  priceProtectedNote,
  priceReverseConvertible,
  protectionSolve,
  reverseConvertibleBarrierSolve,
  simulatePathSummaries,
  type MarketContext,
} from "./engine";
import {
  curveFor,
  discountFactor,
  impliedVolatility,
  interpolateByTenor,
  snapshot,
  underlyingById,
} from "./snapshot";

function context(id: string, volModel: "flat" | "skew" = "skew", spread = 0.01): MarketContext {
  const underlying = underlyingById(id);
  return { underlying, curve: curveFor(underlying), fundingSpread: spread, volModel };
}

describe("market snapshot", () => {
  it("documents its status and covers every underlying's currency", () => {
    expect(snapshot.status).toBe("illustrative");
    expect(snapshot.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    snapshot.underlyings.forEach((underlying) => {
      expect(snapshot.currencies[underlying.currency]).toBeDefined();
      expect(underlying.source.length).toBeGreaterThan(0);
    });
  });

  it("interpolates term structures linearly and extrapolates flat", () => {
    const points = { "1": 0.02, "3": 0.04 };
    expect(interpolateByTenor(points, 0.5)).toBeCloseTo(0.02);
    expect(interpolateByTenor(points, 2)).toBeCloseTo(0.03);
    expect(interpolateByTenor(points, 10)).toBeCloseTo(0.04);
  });

  it("applies downside skew that decays with tenor", () => {
    const spx = underlyingById("SPX");
    expect(impliedVolatility(spx, 1, 0.9)).toBeCloseTo(0.175 + 0.032 + 0.0012, 4);
    expect(impliedVolatility(spx, 1, 0.9, "flat")).toBeCloseTo(0.175, 6);
    const oneYearSkew = impliedVolatility(spx, 1, 0.9) - impliedVolatility(spx, 1, 1);
    const fourYearSkew = impliedVolatility(spx, 4, 0.9) - impliedVolatility(spx, 4, 1);
    expect(fourYearSkew).toBeLessThan(oneYearSkew);
    expect(fourYearSkew).toBeGreaterThan(0);
  });

  it("extrapolates the smile flat beyond the quoted wings", () => {
    const spx = underlyingById("SPX");
    expect(impliedVolatility(spx, 1, 0.3)).toBeCloseTo(impliedVolatility(spx, 1, 0.5), 8);
    expect(impliedVolatility(spx, 1, 3)).toBeCloseTo(impliedVolatility(spx, 1, 1.5), 8);
    expect(impliedVolatility(spx, 1, 3)).toBeLessThan(impliedVolatility(spx, 1, 1));
  });

  it("discounts on the zero curve plus a spread", () => {
    const usd = snapshot.currencies.USD;
    expect(discountFactor(usd, 1)).toBeCloseTo(Math.exp(-0.037), 6);
    expect(discountFactor(usd, 1, 0.01)).toBeCloseTo(Math.exp(-0.047), 6);
    expect(couponAnnuity(usd, 0, 1, 4)).toBeGreaterThan(0.95);
    expect(couponAnnuity(usd, 0, 1, 4)).toBeLessThan(1);
  });
});

describe("capital-protected note", () => {
  const terms = { tenor: 5, protection: 100, strike: 100, cap: null, fee: 1 };

  it("funds participation from the residual after the bond floor and fee", () => {
    const valuation = priceProtectedNote(context("SPX"), terms);
    expect(valuation.bondFloor).toBeCloseTo(100 * Math.exp(-0.047 * 5), 4);
    expect(valuation.budget).toBeCloseTo(100 - valuation.bondFloor - 1, 6);
    expect(valuation.participation).toBeGreaterThan(80);
    expect(valuation.participation).toBeLessThan(105);
  });

  it("raises participation when protection falls, the cap tightens or funding widens", () => {
    const base = priceProtectedNote(context("SX5E"), terms).participation;
    expect(
      priceProtectedNote(context("SX5E"), { ...terms, protection: 90 }).participation,
    ).toBeGreaterThan(base);
    expect(
      priceProtectedNote(context("SX5E"), { ...terms, cap: 140 }).participation,
    ).toBeGreaterThan(base);
    expect(priceProtectedNote(context("SX5E", "skew", 0.02), terms).participation).toBeGreaterThan(
      base,
    );
  });
});

describe("barrier reverse convertible", () => {
  const terms = { tenor: 1, strike: 100, barrier: 70, frequency: 4, margin: 1 };

  it("prices a plausible coupon that the margin reduces", () => {
    const valuation = priceReverseConvertible(context("SX5E"), terms);
    expect(valuation.offeredCoupon).toBeGreaterThan(3);
    expect(valuation.offeredCoupon).toBeLessThan(20);
    expect(valuation.fairCoupon).toBeGreaterThan(valuation.offeredCoupon);
    expect(valuation.fairCoupon - valuation.offeredCoupon).toBeCloseTo(1 / valuation.annuity, 6);
  });

  it("pays more for a higher barrier and for skewed volatility", () => {
    const base = priceReverseConvertible(context("SX5E"), terms).offeredCoupon;
    expect(
      priceReverseConvertible(context("SX5E"), { ...terms, barrier: 80 }).offeredCoupon,
    ).toBeGreaterThan(base);
    expect(priceReverseConvertible(context("SX5E", "flat"), terms).offeredCoupon).toBeLessThan(
      base,
    );
  });
});

describe("autocallable reverse convertible", () => {
  const terms = {
    tenor: 3,
    frequency: 4,
    trigger: 100,
    barrier: 60,
    barrierObservation: "maturity" as const,
    margin: 1,
  };

  it("is deterministic and prices a plausible coupon", () => {
    const summaries = simulatePathSummaries(context("SX5E"), 3, 4, 8000);
    const valuation = priceAutocall(summaries, context("SX5E"), terms);
    const again = priceAutocall(
      simulatePathSummaries(context("SX5E"), 3, 4, 8000),
      context("SX5E"),
      terms,
    );
    expect(again.offeredCoupon).toBe(valuation.offeredCoupon);
    expect(valuation.offeredCoupon).toBeGreaterThan(3);
    expect(valuation.offeredCoupon).toBeLessThan(20);
    expect(valuation.callProbability).toBeGreaterThan(0.5);
    expect(valuation.callProbability).toBeLessThan(0.95);
    expect(valuation.expectedLife).toBeLessThan(3);
    expect(valuation.expectedLife).toBeGreaterThan(0.5);
  });

  it("charges more coupon for continuous monitoring, a higher barrier and skew", () => {
    const skewed = simulatePathSummaries(context("SX5E"), 3, 4, 8000);
    const flat = simulatePathSummaries(context("SX5E", "flat"), 3, 4, 8000);
    const base = priceAutocall(skewed, context("SX5E"), terms);
    const continuous = priceAutocall(skewed, context("SX5E"), {
      ...terms,
      barrierObservation: "continuous",
    });
    const higher = priceAutocall(skewed, context("SX5E"), { ...terms, barrier: 70 });
    const flatValuation = priceAutocall(flat, context("SX5E", "flat"), terms);
    expect(continuous.offeredCoupon).toBeGreaterThan(base.offeredCoupon);
    expect(continuous.effectiveBarrier).toBeGreaterThan(60);
    expect(higher.offeredCoupon).toBeGreaterThan(base.offeredCoupon);
    expect(base.offeredCoupon).toBeGreaterThan(flatValuation.offeredCoupon);
  });

  it("rejects summaries that do not match the schedule", () => {
    const summaries = simulatePathSummaries(context("SPX"), 2, 4, 500);
    expect(() => priceAutocall(summaries, context("SPX"), terms)).toThrow();
  });
});

describe("term solver", () => {
  it("recovers the reverse-convertible barrier behind a coupon", () => {
    const terms = { tenor: 1, strike: 100, barrier: 72, frequency: 4, margin: 1 };
    const definition = reverseConvertibleBarrierSolve(context("UKX"), terms);
    const target = definition.evaluate(72);
    const result = bisect(definition.evaluate, definition.range, target, definition);
    expect(result.converged).toBe(true);
    expect(result.candidate).toBeCloseTo(72, 0);
  });

  it("recovers the autocall barrier on the same paths", () => {
    const summaries = simulatePathSummaries(context("NKY"), 3, 4, 8000);
    const terms = {
      tenor: 3,
      frequency: 4,
      trigger: 100,
      barrier: 65,
      barrierObservation: "maturity" as const,
      margin: 1,
    };
    const definition = autocallBarrierSolve(summaries, context("NKY"), terms);
    const target = definition.evaluate(65);
    const result = bisect(definition.evaluate, definition.range, target, definition);
    expect(result.converged).toBe(true);
    expect(Math.abs(result.candidate - 65)).toBeLessThan(1);
  });

  it("recovers protection and cap levels behind a participation rate", () => {
    const terms = { tenor: 4, protection: 90, strike: 100, cap: 150, fee: 1 };
    const protection = protectionSolve(context("SPX"), terms);
    const protectionResult = bisect(
      protection.evaluate,
      protection.range,
      protection.evaluate(90),
      protection,
    );
    expect(protectionResult.converged).toBe(true);
    expect(protectionResult.candidate).toBeCloseTo(90, 0);

    const cap = capSolve(context("SPX"), terms);
    const capResult = bisect(cap.evaluate, cap.range, cap.evaluate(150), cap);
    expect(capResult.converged).toBe(true);
    expect(Math.abs(capResult.candidate - 150)).toBeLessThan(2);
  });

  it("reports targets outside the reachable range", () => {
    const terms = { tenor: 1, strike: 100, barrier: 70, frequency: 4, margin: 1 };
    const definition = reverseConvertibleBarrierSolve(context("SPX"), terms);
    const result = bisect(definition.evaluate, definition.range, 60, definition);
    expect(result.reachable).toBe(false);
    expect(result.steps).toHaveLength(0);
  });
});
