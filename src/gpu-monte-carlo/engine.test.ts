import { describe, expect, it } from "vitest";
import {
  cholesky,
  closedFormReference,
  couponWithCalls,
  DEFAULT_PARAMS,
  estimate,
  fairCoupon,
  PathRng,
  pcgHash,
  simulateBatch,
  type McParams,
} from "./engine";
import { packParams } from "./gpu";

const single: McParams = { ...DEFAULT_PARAMS, assets: 1 };

describe("GPU Monte Carlo engine", () => {
  it("matches reference PCG hash outputs", () => {
    // Values from the same hash compiled as C with native uint32_t arithmetic,
    // which is what the WGSL kernel computes.
    expect(pcgHash(0)).toBe(129708002);
    expect(pcgHash(1)).toBe(2831084092);
    expect(pcgHash(123456789)).toBe(4272394698);
  });

  it("draws uniforms strictly inside (0, 1)", () => {
    const rng = new PathRng(7, 3);
    for (let index = 0; index < 10_000; index += 1) {
      const value = rng.uniform();
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("factors the equicorrelation matrix", () => {
    const factor = cholesky(3, 0.6);
    for (let row = 0; row < 3; row += 1)
      for (let column = 0; column < 3; column += 1) {
        let product = 0;
        for (let k = 0; k < 3; k += 1) product += factor[row * 3 + k] * factor[column * 3 + k];
        expect(product).toBeCloseTo(row === column ? 1 : 0.6, 12);
      }
    expect(cholesky(1, 0.6)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("converges onto the Reiner-Rubinstein price for one continuously monitored name", () => {
    const sums = simulateBatch(single, 0, 40_000);
    const result = estimate(sums, single);
    const reference = closedFormReference(single);
    expect(reference).not.toBeNull();
    expect(Math.abs(result.put - reference!.put)).toBeLessThan(3.5 * result.standardError);
    expect(result.knockInProbability).toBeCloseTo(reference!.knockInProbability, 2);
  });

  it("converges onto the continuity-corrected price for daily-close monitoring", () => {
    const params: McParams = { ...single, monitoring: "close", barrier: 80 };
    const result = estimate(simulateBatch(params, 0, 40_000), params);
    const reference = closedFormReference(params)!;
    expect(reference.corrected).toBe(true);
    expect(Math.abs(result.put - reference.put)).toBeLessThan(3.5 * result.standardError);
  });

  it("prices daily-close monitoring below continuous monitoring", () => {
    const continuous = estimate(simulateBatch(single, 0, 20_000), single).put;
    const close = { ...single, monitoring: "close" as const };
    expect(estimate(simulateBatch(close, 0, 20_000), close).put).toBeLessThan(continuous);
  });

  it("makes the worst-of put dearer as correlation falls", () => {
    const at = (corr: number) => {
      const params = { ...DEFAULT_PARAMS, corr };
      return estimate(simulateBatch(params, 0, 8_000), params).put;
    };
    expect(at(0.2)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.8));
  });

  it("adds interest and the grown put premium to make the coupon", () => {
    expect(fairCoupon(0, { rate: 0, tenor: 1 })).toBeCloseTo(0, 12);
    expect(fairCoupon(5, { rate: 0, tenor: 1 })).toBeCloseTo(5, 12);
    expect(fairCoupon(0, { rate: 0.02, tenor: 1 })).toBeCloseTo(100 * (Math.exp(0.02) - 1), 10);
  });

  it("has no closed form once there are two or more names", () => {
    expect(closedFormReference(DEFAULT_PARAMS)).toBeNull();
  });

  it("packs the uniform block in kernel order", () => {
    const buffer = packParams(DEFAULT_PARAMS, 5, 7);
    const u32 = new Uint32Array(buffer);
    const f32 = new Float32Array(buffer);
    expect(buffer.byteLength).toBe(128);
    expect([u32[0], u32[1], u32[2], u32[3], u32[5], u32[6]]).toEqual([5, 7, 3, 252, 1, 63]);
    expect(f32[11]).toBe(100);
    expect(f32[13]).toBe(1e9);
    expect(f32[16]).toBe(1);
    expect(f32[20]).toBeCloseTo(0.5, 6);
    expect(f32[28]).toBe(1e9);
    const featured = new Float32Array(
      packParams({ ...DEFAULT_PARAMS, lockIn: 110, autocall: "stepdown" }, 0, 1),
    );
    expect(featured[13]).toBeCloseTo(Math.log(1.1), 6);
    expect(featured[28]).toBeCloseTo(0, 6);
    expect(featured[31]).toBeCloseTo(Math.log(0.97), 6);
  });
});

describe("Lock-in and autocall", () => {
  const paths = 12_000;
  const run = (params: McParams) => estimate(simulateBatch(params, 0, paths), params);

  it("leaves the plain note unchanged when both features are off", () => {
    const result = run(DEFAULT_PARAMS);
    expect(result.put).toBe(result.base.put);
    expect(result.knockInProbability).toBe(result.base.knockInProbability);
    expect(result.coupon).toBeCloseTo(result.base.coupon, 12);
    expect(result.lockProbability).toBe(0);
    expect(result.expectedLife).toBe(1);
  });

  it("prices the plain note identically whichever features are switched on", () => {
    const plain = run(DEFAULT_PARAMS);
    const featured = run({ ...DEFAULT_PARAMS, lockIn: 110, autocall: "flat" });
    expect(featured.base.put).toBe(plain.base.put);
    expect(featured.base.coupon).toBe(plain.base.coupon);
  });

  it("makes the put cheaper and the coupon lower with a lock-in, more so for a lower level", () => {
    const plain = run(DEFAULT_PARAMS);
    const high = run({ ...DEFAULT_PARAMS, lockIn: 125 });
    const low = run({ ...DEFAULT_PARAMS, lockIn: 105 });
    expect(high.put).toBeLessThan(plain.put);
    expect(low.put).toBeLessThan(high.put);
    expect(low.coupon).toBeLessThan(high.coupon);
    expect(low.lockProbability).toBeGreaterThan(high.lockProbability);
    expect(low.knockInProbability).toBeLessThan(plain.knockInProbability);
  });

  it("calls the note early, shortens its life and raises the coupon p.a.", () => {
    const plain = run(DEFAULT_PARAMS);
    const called = run({ ...DEFAULT_PARAMS, autocall: "flat" });
    const total = called.callProbabilities.reduce((sum, p) => sum + p, 0);
    expect(called.callProbabilities[0]).toBeGreaterThan(called.callProbabilities[1]);
    expect(total).toBeGreaterThan(0.2);
    expect(called.expectedLife).toBeLessThan(1);
    expect(called.put).toBeLessThan(plain.put);
    expect(called.coupon).toBeGreaterThan(plain.coupon);
  });

  it("calls more often with a step-down schedule", () => {
    const flat = run({ ...DEFAULT_PARAMS, autocall: "flat" });
    const step = run({ ...DEFAULT_PARAMS, autocall: "stepdown" });
    expect(step.callProbabilities[2]).toBeGreaterThan(flat.callProbabilities[2]);
    expect(step.put).toBeLessThan(flat.put);
  });

  it("solves the coupon from the redemption timing", () => {
    const params = { rate: 0.02, tenor: 1 };
    expect(couponWithCalls(4, [0, 0, 0], params)).toBeCloseTo(fairCoupon(4, params), 12);
    // Certain call at three months: par plus a quarter of the coupon, discounted 3 months.
    const df = Math.exp(-0.02 * 0.25);
    const c = couponWithCalls(0, [1, 0, 0], params);
    expect(df * (100 + c * 0.25)).toBeCloseTo(100, 10);
  });
});
