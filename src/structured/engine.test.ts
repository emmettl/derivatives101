import { describe, expect, it } from "vitest";
import { evaluate, observations, simulate } from "./engine";
import type { LockParams } from "./engine";

describe("structured product lifecycle engine", () => {
  it("creates unique observation dates ending at maturity", () => {
    expect(observations(1, 4)).toEqual([63, 126, 189, 252]);
  });

  it("settles a plain reverse convertible directly from the final level", () => {
    const path = new Float64Array(253).fill(100);
    path[252] = 72;
    const result = evaluate("rc", path, {
      variant: "plain",
      coupon: 8,
      settlement: "cash",
      tenor: 1,
      frequency: 4,
    });

    expect(result.principal).toBe(72);
    expect(result.coupons).toBe(8);
    expect(result.totalReturn).toBe(-20);
  });

  it("recovers missed memory coupons when the trigger is met later", () => {
    const path = new Float64Array(253).fill(100);
    path[63] = 70;
    path[126] = 70;
    path[189] = 90;
    const result = evaluate("coupon", path, {
      style: "memory",
      coupon: 12,
      couponLevel: 80,
      autocall: false,
      callLevel: 100,
      barrier: 60,
      settlement: "cash",
      tenor: 1,
      frequency: 4,
    });

    expect(result.missed).toBe(2);
    expect(result.recovered).toBeCloseTo(6);
    expect(result.coupons).toBeCloseTo(12);
    expect(result.memoryUnpaid).toBe(0);
  });

  it("produces deterministic simulations for a fixed seed", () => {
    const params = {
      style: "step",
      lockLevel: 110,
      initialFloor: 80,
      capture: 80,
      tenor: 1,
      frequency: 4,
      vol: 30,
    } satisfies LockParams;
    expect(simulate("lock", params, 42, 20).returns).toEqual(
      simulate("lock", params, 42, 20).returns,
    );
  });

  it("lets downside skew change barrier and autocall outcomes without changing drift", () => {
    const params = {
      variant: "autocall",
      coupon: 8,
      barrier: 65,
      barrierObservation: "daily",
      settlement: "cash",
      callLevel: 100,
      tenor: 3,
      frequency: 4,
      vol: 30,
    } as const;
    const flat = simulate("rc", { ...params, volModel: "flat" }, 904271, 4000);
    const skewed = simulate("rc", { ...params, volModel: "downside-skew" }, 904271, 4000);

    expect(Math.abs(skewed.stats.barrier - flat.stats.barrier)).toBeGreaterThan(0.005);
    expect(Math.abs(skewed.stats.called - flat.stats.called)).toBeGreaterThan(0.005);
    expect(skewed.returns).not.toEqual(flat.returns);
  });
});
