import {
  TRADING_DAYS as DAYS,
  average,
  normalRandom as normal,
  observationDays,
  seededRandom as seeded,
} from "../shared/simulation";

export type KodaKind = "koda" | "kodd";
export type KodaScenario = "random" | "knockout" | "recover" | "geared";

export interface KodaParams {
  kind: KodaKind;
  strike: number;
  knockOut: number;
  baseUnits: number;
  gearing: number;
  tenor: number;
  frequency: number;
  guaranteed: number;
  vol: number;
}

export interface KodaPathOptions extends KodaParams {
  seed?: number;
  scenario?: KodaScenario;
}

type Anchor = readonly [number, number];

interface KodaEvent {
  index: number;
  day: number;
  spot: number;
  knockOutTest: string;
  sizeTest: string;
  quantity: number;
  cash: number;
  cumulativeUnits: number;
  status: string;
  geared: boolean;
  executed: boolean;
  guaranteed: boolean;
}

function interpolate(anchors: readonly Anchor[], t: number): number {
  for (let i = 1; i < anchors.length; i++)
    if (t <= anchors[i][0]) {
      const [t0, a] = anchors[i - 1],
        [t1, b] = anchors[i],
        weight = (t - t0) / (t1 - t0);
      return a + (b - a) * weight;
    }
  return anchors.at(-1)?.[1] ?? 0;
}

function scenarioAnchors(p: KodaParams, scenario: KodaScenario): Anchor[] {
  const koda = p.kind === "koda",
    adverse = koda ? -1 : 1,
    favourable = -adverse,
    strike = Number(p.strike),
    knockOut = Number(p.knockOut);
  if (scenario === "knockout")
    return [
      [0, 100],
      [0.2, knockOut + favourable * 3],
      [1, knockOut + favourable * 12],
    ];
  if (scenario === "recover")
    return [
      [0, 100],
      [0.3, strike + adverse * 8],
      [0.66, strike - adverse * 5],
      [1, 100],
    ];
  if (scenario === "geared")
    return [
      [0, 100],
      [0.2, strike + adverse * 5],
      [1, koda ? Math.max(10, strike - 38) : strike + 48],
    ];
  return [
    [0, 100],
    [0.22, (100 + strike) / 2],
    [0.48, strike + adverse * 2],
    [0.72, 100],
    [1, (100 + strike) / 2],
  ];
}

function generatePath({ seed = 1, scenario = "random", ...p }: KodaPathOptions): Float64Array {
  const random = seeded(seed),
    end = Math.round(p.tenor * DAYS),
    path = new Float64Array(end + 1);
  path[0] = 100;
  if (scenario !== "random") {
    const anchors = scenarioAnchors(p, scenario);
    let noise = 0;
    for (let day = 1; day <= end; day++) {
      noise = 0.92 * noise + normal(random) * (p.vol / 100) * 0.18;
      path[day] = Math.max(0.1, interpolate(anchors, day / end) * Math.exp(noise / 100));
    }
    return path;
  }
  const sigma = p.vol / 100,
    dt = 1 / DAYS,
    drift = -0.5 * sigma * sigma * dt,
    shock = sigma * Math.sqrt(dt);
  for (let day = 1; day <= end; day++)
    path[day] = Math.max(0.1, path[day - 1] * Math.exp(drift + shock * normal(random)));
  return path;
}

function isKnockOut(spot: number, p: KodaParams): boolean {
  return p.kind === "koda" ? spot >= p.knockOut : spot <= p.knockOut;
}
function isAdverse(spot: number, p: KodaParams): boolean {
  return p.kind === "koda" ? spot < p.strike : spot > p.strike;
}

function evaluate(path: Float64Array, p: KodaParams) {
  const observations = observationDays(p.tenor, p.frequency),
    guaranteed = Math.min(observations.length, Math.max(0, Math.round(p.guaranteed || 0))),
    events: KodaEvent[] = [];
  let knockedOut = false,
    knockOutDay = null,
    knockOutIndex = null,
    totalUnits = 0,
    totalCash = 0,
    gearedFixings = 0;
  for (let index = 0; index < observations.length; index++) {
    if (knockedOut && index >= guaranteed) break;
    const day = observations[index],
      spot = path[day],
      hit = isKnockOut(spot, p),
      firstHit = hit && !knockedOut;
    if (firstHit) {
      knockedOut = true;
      knockOutDay = day;
      knockOutIndex = index;
    }
    const protectedObservation = index < guaranteed,
      execute = !knockedOut || protectedObservation,
      geared = execute && !knockedOut && isAdverse(spot, p),
      quantity = (execute ? 1 : 0) * p.baseUnits * (geared ? p.gearing : 1),
      cash = quantity * p.strike;
    if (geared) gearedFixings++;
    totalUnits += quantity;
    totalCash += cash;
    let status = "Base trade";
    if (firstHit && protectedObservation) status = "KO; guarantee continues";
    else if (firstHit) status = "Knocked out";
    else if (knockedOut && protectedObservation) status = "Guaranteed continuation";
    else if (geared) status = "Geared trade";
    events.push({
      index,
      day,
      spot,
      knockOutTest: hit ? "Hit" : "No hit",
      sizeTest: execute ? (geared ? `${p.gearing.toFixed(1)}× geared` : "1× base") : "No trade",
      quantity,
      cash,
      cumulativeUnits: totalUnits,
      status,
      geared,
      executed: execute,
      guaranteed: protectedObservation,
    });
  }
  const terminationDay = knockedOut
      ? (events.at(-1)?.day ?? observations.at(-1) ?? 0)
      : (observations.at(-1) ?? 0),
    valuationSpot = path[terminationDay],
    marketValue = totalUnits * valuationSpot;
  const pnl = p.kind === "koda" ? marketValue - totalCash : totalCash - marketValue,
    baseNotional = p.baseUnits * observations.length * p.strike,
    pnlPercent = baseNotional ? (pnl / baseNotional) * 100 : 0;
  return {
    path,
    observations,
    events,
    knockedOut,
    knockOutDay,
    knockOutIndex,
    terminationDay,
    valuationSpot,
    totalUnits,
    totalCash,
    marketValue,
    pnl,
    pnlPercent,
    baseNotional,
    maxUnits: p.baseUnits * observations.length * p.gearing,
    gearedFixings,
    executedFixings: events.filter((event) => event.executed).length,
    life: terminationDay / DAYS,
  };
}

function simulate(p: KodaParams, seed = 1, count = 2000) {
  const returns = [];
  let knockedOut = 0,
    geared = 0,
    units = 0,
    life = 0;
  for (let index = 0; index < count; index++) {
    const path = generatePath({
        ...p,
        scenario: "random",
        seed: (seed + index * 2654435761) >>> 0,
      }),
      result = evaluate(path, p);
    returns.push(result.pnlPercent);
    knockedOut += result.knockedOut ? 1 : 0;
    geared += result.gearedFixings > 0 ? 1 : 0;
    units += result.totalUnits;
    life += result.life;
  }
  returns.sort((a, b) => a - b);
  return {
    count,
    returns,
    stats: {
      knockOutRate: knockedOut / count,
      gearedRate: geared / count,
      averageUnits: units / count,
      averageLife: life / count,
      averagePnl: average(returns),
    },
  };
}

export { DAYS, seeded, observationDays, generatePath, isKnockOut, isAdverse, evaluate, simulate };
