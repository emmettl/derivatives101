import { describe, expect, it } from "vitest";
import { downBarrierPrice, priceAtCandidate, solveVariable } from "./engine";
import type { SolveVariable, SolverInputs } from "./engine";

const base = {
  S: 100,
  K: 100,
  T: 1,
  r: 0.03,
  q: 0.01,
  v: 0.25,
  type: "call" as const,
  target: 0,
  solveFor: "strike" as SolveVariable,
  barrierStyle: "knock-in" as const,
};

function recover(inputs: SolverInputs, expected: number): void {
  const target = priceAtCandidate(inputs, expected);
  const result = solveVariable({ ...inputs, target });
  expect(result.converged).toBe(true);
  expect(result.value).toBeCloseTo(expected, inputs.solveFor === "volatility" ? 3 : 1);
  expect(result.price).toBeCloseTo(target, 2);
}

describe("inverse option solver", () => {
  it("recovers call and put strikes", () => {
    recover({ ...base, solveFor: "strike", type: "call" }, 110);
    recover({ ...base, solveFor: "strike", type: "put" }, 92);
  });

  it("recovers implied volatility for calls and puts", () => {
    recover({ ...base, solveFor: "volatility", type: "call" }, 0.32);
    recover({ ...base, solveFor: "volatility", type: "put" }, 0.41);
  });

  it("recovers spot for calls and puts", () => {
    recover({ ...base, solveFor: "spot", type: "call" }, 112);
    recover({ ...base, solveFor: "spot", type: "put" }, 88);
  });

  it("recovers knock-in and knock-out down barriers", () => {
    // A put's value moves strongly with a down barrier, so the price tolerance
    // pins the barrier tightly. A down-and-in call below the strike is nearly
    // worthless whatever the barrier, so its inverse problem is ill-conditioned.
    recover({ ...base, solveFor: "barrier", type: "put", barrierStyle: "knock-in" }, 72);
    recover({ ...base, solveFor: "barrier", type: "put", barrierStyle: "knock-out" }, 84);
  });

  it("prices down barriers with the Reiner-Rubinstein closed form", () => {
    // Reference values computed independently and cross-checked with a
    // 2,000-step Monte Carlo (S 100, T 1, r 3%, q 1%, vol 25%).
    const market = { S: 100, T: 1, r: 0.03, q: 0.01, v: 0.25 };
    const price = (K: number, type: "call" | "put", barrier: number) =>
      downBarrierPrice({ ...market, K }, type, barrier, "knock-in");
    expect(price(100, "put", 70)).toBeCloseTo(4.7033, 3);
    expect(price(100, "put", 84)).toBeCloseTo(8.2545, 3);
    expect(price(100, "call", 70)).toBeCloseTo(0.0161, 3);
    expect(price(100, "call", 90)).toBeCloseTo(2.925, 3);
    expect(price(60, "call", 70)).toBeCloseTo(1.7836, 3);
    expect(price(60, "put", 70)).toBeCloseTo(0.1144, 3);
  });

  it("keeps knock-in and knock-out values consistent with the vanilla option", () => {
    const market = { S: 100, K: 100, T: 1, r: 0.03, q: 0.01, v: 0.25 };
    const vanilla = priceAtCandidate({ ...base, solveFor: "strike", type: "put" }, 100);
    const knockIn = downBarrierPrice(market, "put", 70, "knock-in");
    const knockOut = downBarrierPrice(market, "put", 70, "knock-out");
    expect(knockIn + knockOut).toBeCloseTo(vanilla, 6);
    expect(downBarrierPrice(market, "put", 100, "knock-in")).toBeCloseTo(vanilla, 6);
    expect(downBarrierPrice(market, "put", 100, "knock-out")).toBeCloseTo(0, 6);
    expect(downBarrierPrice(market, "put", 80, "knock-in")).toBeGreaterThan(knockIn);
  });

  it("reports an unreachable target", () => {
    const result = solveVariable({ ...base, solveFor: "strike", target: 200 });
    expect(result.converged).toBe(false);
    expect(result.steps).toHaveLength(0);
  });
});
