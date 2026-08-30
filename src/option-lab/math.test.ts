import { describe, expect, it } from "vitest";
import { metricValue, optionMetrics } from "./math";

const base = { S: 100, K: 100, T: 1, r: 0.03, q: 0.01, v: 0.25 };

describe("option metrics", () => {
  it("satisfies put-call parity", () => {
    const call = optionMetrics(base, "call").price;
    const put = optionMetrics(base, "put").price;
    const parity = base.S * Math.exp(-base.q * base.T) - base.K * Math.exp(-base.r * base.T);
    expect(call - put).toBeCloseTo(parity, 8);
  });

  it("produces positive gamma and vega", () => {
    const metrics = optionMetrics(base, "call");
    expect(metrics.gamma).toBeGreaterThan(0);
    expect(metrics.vega).toBeGreaterThan(0);
    expect(metricValue(metrics, "vega")).toBeCloseTo(metrics.vega / 100, 12);
  });

  it("converges to intrinsic value at expiry", () => {
    expect(optionMetrics({ ...base, S: 120, T: 0 }, "call").price).toBe(20);
    expect(optionMetrics({ ...base, S: 80, T: 0 }, "put").price).toBe(20);
  });
});
