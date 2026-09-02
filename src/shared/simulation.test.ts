import { describe, expect, it } from "vitest";
import { nextZeroDriftLevel, pathVolatility } from "./simulation";

describe("path volatility models", () => {
  it("keeps flat volatility constant at every underlying level", () => {
    expect(pathVolatility(60, 100, 30, "flat")).toBeCloseTo(0.3);
    expect(pathVolatility(140, 100, 30, "flat")).toBeCloseTo(0.3);
  });

  it("turns the equity skew curve into higher downside and lower upside local volatility", () => {
    expect(pathVolatility(60, 100, 30, "downside-skew")).toBeGreaterThan(0.3);
    expect(pathVolatility(100, 100, 30, "downside-skew")).toBeCloseTo(0.3);
    expect(pathVolatility(140, 100, 30, "downside-skew")).toBeLessThan(0.3);
  });

  it("preserves the flat model's zero-drift lognormal step", () => {
    const actual = nextZeroDriftLevel(100, 100, 30, 1 / 252, 0.75, "flat");
    const volatility = 0.3;
    const expected =
      100 *
      Math.exp(-0.5 * volatility * volatility * (1 / 252) + volatility * Math.sqrt(1 / 252) * 0.75);
    expect(actual).toBeCloseTo(expected);
  });
});
