import { describe, expect, it } from "vitest";
import { judges, parseFirstNumber } from "./predict";

describe("predict-then-reveal helpers", () => {
  it("parses the first number out of a readout", () => {
    expect(parseFirstNumber("29%")).toBe(29);
    expect(parseFirstNumber("−4.2")).toBe(-4.2);
    expect(parseFirstNumber("+6.02% p.a.")).toBe(6.02);
    expect(parseFirstNumber("1.84 yr")).toBe(1.84);
    expect(parseFirstNumber("None")).toBeUndefined();
  });

  it("judges direction with a tolerance on the readout's scale", () => {
    const judge = judges.direction(1);
    expect(judge(29, 41)).toBe("up");
    expect(judge(29, 29.5)).toBe("same");
    expect(judge(29, 20)).toBe("down");
  });

  it("judges the size of a rise against a ratio", () => {
    const judge = judges.riseSize(1.5);
    expect(judge(20, 31)).toBe("big");
    expect(judge(20, 25)).toBe("small");
    expect(judge(20, 19)).toBe("down");
  });
});
