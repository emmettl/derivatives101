import { describe, expect, it } from "vitest";
import { evaluate as evaluateBasket } from "./basket/engine";
import { outperformance, redemption as participationRedemption } from "./participation/engine";
import { evaluate as evaluateKoda } from "./koda-kodd/engine";

describe("basket engine", () => {
  it("delivers the worst name when downside physical settlement is active", () => {
    const paths = [
      new Float64Array(253).fill(100),
      new Float64Array(253).fill(100),
      new Float64Array(253).fill(100),
    ];
    paths[2][252] = 50;
    const result = evaluateBasket(paths, {
      basis: "worst",
      coupon: 0,
      couponLevel: 70,
      autocall: false,
      callLevel: 100,
      barrier: 60,
      settlement: "physical",
      tenor: 1,
      frequency: 4,
      vol: 30,
      correlation: 45,
    });

    expect(result.worstName).toBe("Asset C");
    expect(result.physicalDelivery).toBe(true);
    expect(result.deliveryValue).toBe(50);
  });
});

describe("participation engine", () => {
  const params = {
    product: "bonus_outperformance",
    participation: 1.1,
    bonus: 110,
  } as const;

  it("keeps the bonus floor only while the barrier state is intact", () => {
    expect(participationRedemption(95, false, params)).toBe(110);
    expect(participationRedemption(95, true, params)).toBe(95);
  });

  it("applies leveraged participation above the strike", () => {
    expect(outperformance(120, params)).toBeCloseTo(122);
  });
});

describe("KODA/KODD engine", () => {
  it("accumulates base trades and values their stop-date P&L", () => {
    const path = new Float64Array(253).fill(100);
    const result = evaluateKoda(path, {
      kind: "koda",
      strike: 90,
      knockOut: 105,
      baseUnits: 10,
      gearing: 2,
      tenor: 1,
      frequency: 4,
      guaranteed: 0,
      vol: 30,
    });

    expect(result.knockedOut).toBe(false);
    expect(result.totalUnits).toBe(40);
    expect(result.pnl).toBe(400);
  });
});
