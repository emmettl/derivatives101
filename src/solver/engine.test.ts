import { describe, expect, it } from "vitest";
import { priceAtCandidate, solveVariable } from "./engine";
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

  it("reports an unreachable target", () => {
    const result = solveVariable({ ...base, solveFor: "strike", target: 200 });
    expect(result.converged).toBe(false);
    expect(result.steps).toHaveLength(0);
  });
});
