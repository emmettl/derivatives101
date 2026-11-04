import { describe, expect, it } from "vitest";
import { optionMetrics } from "../option-lab/math";
import { downBarrierPrice } from "../solver/engine";
import {
  bookGreeks,
  buildGrid,
  DEFAULT_PARAMS,
  europeanBarrierPut,
  fairCoupon,
  MIN_TIME,
  normCdf,
  putGreeks,
  putValue,
  timeAxis,
  type SurfaceParams,
} from "./engine";
import { buildMesh, project, viewProjection, DEFAULT_CAMERA } from "./mesh";

const params = (overrides: Partial<SurfaceParams> = {}): SurfaceParams => ({
  ...DEFAULT_PARAMS,
  ...overrides,
});

describe("normal distribution", () => {
  it("matches known values to double precision", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 15);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021048517795, 13);
    expect(normCdf(-3)).toBeCloseTo(0.0013498980316301, 14);
    expect(normCdf(-8) / 6.220960574271786e-16).toBeCloseTo(1, 7);
  });
});

describe("knock-in put prices", () => {
  it("agrees with the solver's Reiner-Rubinstein put while the barrier is intact", () => {
    for (const spot of [71, 80, 100, 125]) {
      for (const time of [1, 0.25, 0.02]) {
        const solver = downBarrierPrice(
          { S: spot, K: 100, T: time, r: 0.02, q: 0, v: 0.25 },
          "put",
          70,
          "knock-in",
        );
        // The solver's normal approximation is good to about 1e-7, so agree to 1e-4.
        expect(putValue(params(), spot, time)).toBeCloseTo(solver, 4);
      }
    }
  });

  it("is the vanilla put once spot is at or below a continuous barrier", () => {
    const vanilla = optionMetrics({ S: 65, K: 100, T: 0.5, r: 0.02, q: 0, v: 0.25 }, "put").price;
    expect(putValue(params(), 65, 0.5)).toBeCloseTo(vanilla, 5);
  });

  it("is continuous across a continuous barrier", () => {
    const below = putValue(params(), 70, 0.3);
    const above = putValue(params(), 70.0001, 0.3);
    expect(Math.abs(above - below)).toBeLessThan(1e-3);
  });

  it("prices daily-close monitoring below continuous monitoring", () => {
    expect(putValue(params({ observation: "close" }), 85, 0.5)).toBeLessThan(
      putValue(params(), 85, 0.5),
    );
  });

  it("splits an at-maturity barrier put into a put at the barrier plus a digital", () => {
    const market = { spot: 90, strike: 100, time: 0.5, rate: 0.02, vol: 0.25 };
    const atBarrier = optionMetrics({ S: 90, K: 70, T: 0.5, r: 0.02, q: 0, v: 0.25 }, "put").price;
    const european = europeanBarrierPut(market, 70);
    expect(european).toBeGreaterThan(atBarrier);
    // A barrier at the strike is just the vanilla put.
    const vanilla = optionMetrics({ S: 90, K: 100, T: 0.5, r: 0.02, q: 0, v: 0.25 }, "put").price;
    expect(europeanBarrierPut(market, 100)).toBeCloseTo(vanilla, 4);
  });

  it("never prices the European barrier put above the continuous one", () => {
    for (const spot of [72, 85, 100, 120])
      expect(putValue(params({ observation: "maturity" }), spot, 0.5)).toBeLessThan(
        putValue(params(), spot, 0.5),
      );
  });
});

describe("Greeks", () => {
  it("match the closed-form vanilla Greeks once knocked in", () => {
    const metrics = optionMetrics({ S: 60, K: 100, T: 0.75, r: 0.02, q: 0, v: 0.25 }, "put");
    const greeks = putGreeks(params(), 60, 0.75);
    expect(greeks.delta).toBeCloseTo(metrics.delta, 5);
    expect(greeks.gamma).toBeCloseTo(metrics.gamma, 4);
    expect(greeks.vega).toBeCloseTo(metrics.vega / 100, 4);
  });

  it("make the note worth par at issue with the fair coupon", () => {
    const note = bookGreeks(params(), 100, 1, "note");
    expect(note.value).toBeCloseTo(100, 8);
    expect(fairCoupon(params())).toBeGreaterThan(2);
  });

  it("give the investor the opposite Greeks to the issuer's long put", () => {
    const note = bookGreeks(params(), 85, 0.4, "note");
    const desk = bookGreeks(params(), 85, 0.4, "desk");
    expect(note.delta).toBeCloseTo(-desk.delta, 12);
    expect(note.gamma).toBeCloseTo(-desk.gamma, 12);
    expect(note.vega).toBeCloseTo(-desk.vega, 12);
  });

  it("pile gamma onto the barrier as maturity approaches", () => {
    const atIssue = putGreeks(params(), 71, 1).gamma;
    const nearMaturity = putGreeks(params(), 71, 3 / 252).gamma;
    expect(nearMaturity).toBeGreaterThan(50 * atIssue);
  });

  it("make delta jump across a continuous barrier", () => {
    const above = putGreeks(params(), 70.5, 0.25).delta;
    const below = putGreeks(params(), 69.5, 0.25).delta;
    expect(above).toBeLessThan(-1.5);
    expect(below).toBeGreaterThan(-1.01);
  });

  it("flip the sign of gamma across an at-maturity barrier near expiry", () => {
    const european = params({ observation: "maturity" });
    expect(putGreeks(european, 72, 3 / 252).gamma).toBeGreaterThan(1);
    expect(putGreeks(european, 68, 3 / 252).gamma).toBeLessThan(-1);
  });

  it("give the investor more than one delta near the barrier", () => {
    expect(bookGreeks(params(), 72, 10 / 252, "note").delta).toBeGreaterThan(1);
  });
});

describe("surface grid and mesh", () => {
  it("bunches time rows towards maturity and stops a day short", () => {
    const times = timeAxis(1, 97);
    expect(times[0]).toBeCloseTo(1, 12);
    expect(times[96]).toBeCloseTo(MIN_TIME, 12);
    expect(times[95] - times[96]).toBeLessThan(times[0] - times[1]);
  });

  it("produces finite numbers everywhere for every observation style", () => {
    for (const observation of ["continuous", "close", "maturity"] as const) {
      const grid = buildGrid(params({ observation }), "note", { spots: 41, times: 13 });
      for (const metric of ["value", "delta", "gamma", "vega"] as const)
        expect(grid[metric].every(Number.isFinite)).toBe(true);
    }
  });

  it("builds a mesh whose heights stay inside the box", () => {
    const grid = buildGrid(params(), "desk", { spots: 41, times: 13 });
    const mesh = buildMesh(grid, { metric: "gamma", compressed: true, tenor: 1 });
    expect(mesh.indices.length).toBe(40 * 12 * 6);
    for (let index = 1; index < mesh.vertices.length; index += 11)
      expect(Math.abs(mesh.vertices[index])).toBeLessThanOrEqual(0.75 + 1e-6);
  });

  it("projects the centre of the box near the middle of the screen", () => {
    const matrix = viewProjection(DEFAULT_CAMERA, 1.6, true);
    const point = project(matrix, [0, 0, 0], 800, 500);
    expect(Math.abs(point.x - 400)).toBeLessThan(80);
    expect(Math.abs(point.y - 250)).toBeLessThan(80);
  });
});
