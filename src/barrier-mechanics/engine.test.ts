import { describe, expect, it } from "vitest";
import { directionForPath, evaluateBarrierScenario, type BarrierScenario } from "./engine";

const base: BarrierScenario = {
  direction: "down",
  barrierSwitch: "in",
  vanillaType: "put",
  pathId: "down-touch",
};

describe("barrier mechanism", () => {
  it("matches touch path presets to their barrier direction", () => {
    expect(directionForPath("down-touch")).toBe("down");
    expect(directionForPath("up-touch")).toBe("up");
    expect(directionForPath("inside")).toBeNull();
  });

  it("activates a knock-in after the relevant barrier is touched", () => {
    const result = evaluateBarrierScenario(base);
    expect(result.touched).toBe(true);
    expect(result.startsActive).toBe(false);
    expect(result.activeAtMaturity).toBe(true);
    expect(result.barrierPayoff).toBe(10);
  });

  it("terminates a knock-out after the relevant barrier is touched", () => {
    const result = evaluateBarrierScenario({ ...base, barrierSwitch: "out" });
    expect(result.startsActive).toBe(true);
    expect(result.activeAtMaturity).toBe(false);
    expect(result.barrierPayoff).toBe(0);
  });

  it("does not confuse a move in the opposite direction with a touch", () => {
    const result = evaluateBarrierScenario({ ...base, pathId: "up-touch" });
    expect(result.touched).toBe(false);
    expect(result.barrierPayoff).toBe(0);
  });

  it("keeps matching no-rebate knock-in and knock-out payoffs equal to vanilla", () => {
    const knockIn = evaluateBarrierScenario(base);
    const knockOut = evaluateBarrierScenario({ ...base, barrierSwitch: "out" });
    expect(knockIn.barrierPayoff + knockOut.barrierPayoff).toBe(knockIn.vanillaPayoff);
  });
});
