import { describe, expect, it } from "vitest";
import {
  cholesky,
  closedFormReference,
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
    expect(buffer.byteLength).toBe(112);
    expect([u32[0], u32[1], u32[2], u32[3], u32[5]]).toEqual([5, 7, 3, 252, 1]);
    expect(f32[11]).toBe(100);
    expect(f32[16]).toBe(1);
    expect(f32[20]).toBeCloseTo(0.5, 6);
  });
});
