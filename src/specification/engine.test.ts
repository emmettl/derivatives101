import { describe, expect, it } from "vitest";
import { compile, evaluate, profiles, scenarios } from "./engine";

describe("specification compiler", () => {
  it("holds execution while a required choice is unresolved", () => {
    const readiness = compile(profiles.draft);
    expect(readiness.executable).toBe(false);
    expect(readiness.open.length).toBeGreaterThan(0);
  });

  it("blocks an average reference with undefined physical delivery", () => {
    const readiness = compile(profiles.conflict);
    expect(readiness.executable).toBe(false);
    expect(readiness.blockers[0]?.id).toBe("average-physical");
  });

  it("respects an inclusive step-down call boundary", () => {
    const result = evaluate(profiles.resolved, scenarios.boundary);
    expect(result.executable).toBe(true);
    expect(result.calledIndex).toBe(1);
    expect(result.principalCash).toBe(100);
  });

  it("banks and later recovers a memory coupon", () => {
    const result = evaluate(profiles.resolved, scenarios.memoryRecovery);
    expect(result.executable).toBe(true);
    expect(result.events[1].couponStatus).toBe("banked");
    expect(result.events[2].couponStatus).toBe("memory paid");
  });
});
