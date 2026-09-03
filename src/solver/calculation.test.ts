import { describe, expect, it } from "vitest";
import { calculateSolver } from "./calculation";
import type { SolverInputs } from "./engine";

const inputs: SolverInputs = {
  S: 100,
  K: 100,
  T: 1,
  r: 0.03,
  q: 0.01,
  v: 0.25,
  type: "call",
  target: 8.5,
  solveFor: "strike",
  barrierStyle: "knock-in",
};

describe("solver calculation job", () => {
  it("prepares the solution and every chart price away from the UI thread", () => {
    const result = calculateSolver({ id: 7, inputs, tolerance: 0.005 });
    expect(result.id).toBe(7);
    expect(result.samples).toHaveLength(101);
    expect(result.samples[0].candidate).toBe(20);
    expect(result.samples.at(-1)?.candidate).toBe(250);
    expect(result.solution.steps.length).toBeGreaterThan(1);
    expect(result.retainedBoundPrices).toHaveLength(result.solution.steps.length);
    expect(result.maxPrice).toBeGreaterThan(inputs.target);
  });
});
