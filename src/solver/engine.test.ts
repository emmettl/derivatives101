import { describe, expect, it } from "vitest";
import { priceAtStrike, solveStrike } from "./engine";

const base = { S: 100, T: 1, r: 0.03, q: 0.01, v: 0.25 };

describe("strike solver", () => {
  it("recovers a call strike from its model price", () => {
    const target = priceAtStrike({ ...base, type: "call", target: 0 }, 110);
    const result = solveStrike({ ...base, type: "call", target });
    expect(result.converged).toBe(true);
    expect(result.strike).toBeCloseTo(110, 1);
    expect(result.price).toBeCloseTo(target, 2);
  });

  it("recovers a put strike from its model price", () => {
    const target = priceAtStrike({ ...base, type: "put", target: 0 }, 92);
    const result = solveStrike({ ...base, type: "put", target });
    expect(result.converged).toBe(true);
    expect(result.strike).toBeCloseTo(92, 1);
  });

  it("reports an unreachable target", () => {
    const result = solveStrike({ ...base, type: "call", target: 200 });
    expect(result.converged).toBe(false);
    expect(result.steps).toHaveLength(0);
  });
});
