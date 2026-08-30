"use strict";

import {
  TRADING_DAYS as DAYS,
  average,
  normalRandom as normal,
  observationDays as observations,
  seededRandom as seeded,
} from "../shared/simulation";

const NAMES = ["Asset A", "Asset B", "Asset C"];
function anchor(anchors, t) {
  for (let i = 1; i < anchors.length; i++)
    if (t <= anchors[i][0]) {
      const [t0, a] = anchors[i - 1],
        [t1, b] = anchors[i],
        u = (t - t0) / (t1 - t0);
      return a + (b - a) * u;
    }
  return anchors.at(-1)[1];
}
const scenarios = {
  rally: [
    [
      [0, 100],
      [0.45, 112],
      [1, 132],
    ],
    [
      [0, 100],
      [0.45, 108],
      [1, 121],
    ],
    [
      [0, 100],
      [0.45, 105],
      [1, 116],
    ],
  ],
  break: [
    [
      [0, 100],
      [0.4, 106],
      [1, 123],
    ],
    [
      [0, 100],
      [0.4, 101],
      [1, 112],
    ],
    [
      [0, 100],
      [0.3, 91],
      [0.65, 58],
      [1, 44],
    ],
  ],
  diverge: [
    [
      [0, 100],
      [0.4, 116],
      [1, 143],
    ],
    [
      [0, 100],
      [0.4, 101],
      [1, 92],
    ],
    [
      [0, 100],
      [0.4, 88],
      [1, 68],
    ],
  ],
  selloff: [
    [
      [0, 100],
      [0.35, 88],
      [1, 62],
    ],
    [
      [0, 100],
      [0.35, 92],
      [1, 67],
    ],
    [
      [0, 100],
      [0.35, 84],
      [1, 54],
    ],
  ],
};
function generatePaths({ seed = 1, tenor = 3, vol = 30, correlation = 50, scenario = "random" }) {
  const random = seeded(seed),
    end = Math.round(tenor * DAYS),
    paths = NAMES.map(() => new Float64Array(end + 1));
  paths.forEach((path) => (path[0] = 100));
  if (scenario !== "random") {
    const sets = scenarios[scenario] || scenarios.diverge,
      noises = [0, 0, 0];
    for (let day = 1; day <= end; day++)
      for (let i = 0; i < 3; i++) {
        noises[i] = 0.94 * noises[i] + normal(random) * (vol / 100) * 0.25;
        paths[i][day] = Math.max(1, anchor(sets[i], day / end) * Math.exp(noises[i] / 100));
      }
    return paths;
  }
  const rho = Math.max(0, Math.min(0.95, correlation / 100)),
    commonWeight = Math.sqrt(rho),
    ownWeight = Math.sqrt(1 - rho),
    sigma = vol / 100,
    dt = 1 / DAYS,
    drift = -0.5 * sigma * sigma * dt,
    shock = sigma * Math.sqrt(dt);
  for (let day = 1; day <= end; day++) {
    const common = normal(random);
    for (let i = 0; i < 3; i++) {
      const z = commonWeight * common + ownWeight * normal(random);
      paths[i][day] = paths[i][day - 1] * Math.exp(drift + shock * z);
    }
  }
  return paths;
}
function reference(levels, basis) {
  return basis === "average"
    ? levels.reduce((a, b) => a + b, 0) / levels.length
    : Math.min(...levels);
}
function evaluate(paths, p) {
  const obs = observations(p.tenor, p.frequency),
    end = paths[0].length - 1;
  let coupons = 0,
    called = false,
    terminationDay = end,
    previous = 0;
  const events = [];
  for (let index = 0; index < obs.length; index++) {
    const day = obs[index],
      levels = paths.map((path) => path[day]),
      ref = reference(levels, p.basis),
      maturity = day === end,
      due = (p.coupon * (day - previous)) / DAYS,
      passes = ref >= p.couponLevel,
      coupon = passes ? due : 0;
    coupons += coupon;
    let decision = "Continue";
    if (p.autocall && !maturity && index >= 1 && ref >= p.callLevel) {
      called = true;
      terminationDay = day;
      decision = "Autocall trigger met";
    }
    events.push({
      day,
      levels,
      reference: ref,
      couponTest: passes ? "Pass" : "Miss",
      coupon,
      decision,
      state: called ? "Redeemed early" : maturity ? "Maturity" : "Alive",
    });
    previous = day;
    if (called) break;
  }
  const finalLevels = paths.map((path) => path[end]),
    terminalReference = reference(finalLevels, p.basis),
    worstIndex = finalLevels.indexOf(Math.min(...finalLevels)),
    barrierBreached = !called && terminalReference < p.barrier,
    principal = called || !barrierBreached ? 100 : terminalReference;
  const endLevels = paths.map((path) => path[terminationDay]),
    endReference = reference(endLevels, p.basis),
    endWorstIndex = endLevels.indexOf(Math.min(...endLevels));
  const physicalDelivery =
      p.basis === "worst" && p.settlement === "physical" && !called && principal < 100,
    deliveredUnits = physicalDelivery ? 1 : 0,
    cashPrincipal = physicalDelivery ? 0 : principal,
    deliveryValue = physicalDelivery ? principal : 0,
    totalReturn = principal + coupons - 100;
  const ranking = endLevels
    .map((level, index) => ({ name: NAMES[index], level, index }))
    .sort((a, b) => b.level - a.level);
  return {
    paths,
    events,
    called,
    terminationDay,
    life: terminationDay / DAYS,
    coupons,
    finalLevels,
    terminalReference,
    worstIndex,
    worstName: NAMES[worstIndex],
    endLevels,
    endReference,
    endWorstIndex,
    endWorstName: NAMES[endWorstIndex],
    barrierBreached,
    principal,
    settlement: p.basis === "worst" ? p.settlement || "cash" : "cash",
    physicalDelivery,
    deliveredUnits,
    cashPrincipal,
    deliveryValue,
    totalReturn,
    loss: totalReturn < 0,
    ranking,
    basis: p.basis,
  };
}
function simulate(p, seed = 1, count = 2000) {
  const returns = [];
  let called = 0,
    loss = 0,
    coupons = 0,
    terminal = 0;
  const worstCounts = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const paths = generatePaths({
        seed: (seed + i * 2654435761) >>> 0,
        tenor: p.tenor,
        vol: p.vol,
        correlation: p.correlation,
        scenario: "random",
      }),
      result = evaluate(paths, p);
    returns.push(result.totalReturn);
    called += result.called ? 1 : 0;
    loss += result.loss ? 1 : 0;
    coupons += result.coupons;
    terminal += result.endReference;
    worstCounts[result.endWorstIndex]++;
  }
  returns.sort((a, b) => a - b);
  return {
    count,
    returns,
    stats: {
      called: called / count,
      loss: loss / count,
      averageCoupons: coupons / count,
      averageReturn: average(returns),
      averageTerminalReference: terminal / count,
      worstShares: worstCounts.map((value) => value / count),
    },
  };
}

export { DAYS, NAMES, seeded, observations, generatePaths, reference, evaluate, simulate };
