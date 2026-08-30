import {
  TRADING_DAYS as DAYS,
  average,
  normalRandom as normal,
  observationDays as observations,
  seededRandom as seeded,
} from "../shared/simulation";

type Anchor = readonly [number, number];
export type StructuredMode = "rc" | "coupon" | "lock";
export type StructuredScenario = "random" | "rally" | "crash" | "memory" | "lock" | "decline";
type Settlement = "cash" | "physical";

interface CommonParams {
  tenor: number;
  frequency: number;
  vol?: number;
}

export interface ReverseConvertibleParams extends CommonParams {
  variant?: "plain" | "barrier" | "issuer" | "autocall";
  coupon: number;
  barrier?: number;
  barrierObservation?: "daily" | "maturity";
  settlement?: Settlement;
  callLevel?: number;
  callPolicy?: "above" | "first" | "never";
}

export interface CouponParams extends CommonParams {
  style: "fixed" | "conditional" | "memory";
  coupon: number;
  couponLevel: number;
  autocall: boolean;
  callLevel: number;
  barrier: number;
  settlement?: Settlement;
}

export interface LockParams extends CommonParams {
  style: "par" | "step";
  lockLevel: number;
  initialFloor: number;
  capture: number;
  coupon?: number;
  barrier?: number;
  settlement?: Settlement;
}

export type StructuredParams = ReverseConvertibleParams | CouponParams | LockParams;

export interface StructuredEvent {
  day: number;
  level: number;
  coupon: number;
  couponTest: string;
  memoryBank: number;
  barrierState: boolean;
  barrierNew: boolean;
  decision: string;
  state: string;
  memoryRecovered?: number;
  lockedFloor?: number;
  lockChanged?: boolean;
}

export interface StructuredResult {
  path: Float64Array;
  events: StructuredEvent[];
  principal: number;
  coupons: number;
  totalReturn: number;
  finalLevel: number;
  loss: boolean;
  called?: boolean;
  callKind?: string;
  terminationDay?: number;
  barrierBreached?: boolean;
  life?: number;
  variant?: string;
  style?: string;
  settlement?: Settlement;
  physicalDelivery?: boolean;
  deliveredUnits?: number;
  cashPrincipal?: number;
  deliveryValue?: number;
  missed?: number;
  recovered?: number;
  memoryUnpaid?: number;
  lockCount?: number;
  lockedFloor?: number;
}

export interface StructuredSimulation {
  mode: StructuredMode;
  count: number;
  returns: number[];
  stats: {
    called: number;
    loss: number;
    barrier: number;
    averageLife: number;
    averageReturn: number;
    averageCoupons: number;
    averageMissed: number;
    averageRecovered: number;
    locked: number;
    averageLockFloor: number;
    averageLockFloorWhenLocked: number;
  };
}

function anchorLevel(anchors: readonly Anchor[], t: number): number {
  for (let i = 1; i < anchors.length; i++)
    if (t <= anchors[i][0]) {
      const [t0, a] = anchors[i - 1],
        [t1, b] = anchors[i],
        u = (t - t0) / (t1 - t0);
      return a + (b - a) * u;
    }
  return anchors.at(-1)?.[1] ?? 0;
}
const scenarioAnchors: Record<Exclude<StructuredScenario, "random">, readonly Anchor[]> = {
  rally: [
    [0, 100],
    [0.24, 103],
    [0.52, 116],
    [1, 128],
  ],
  crash: [
    [0, 100],
    [0.24, 94],
    [0.43, 52],
    [0.72, 84],
    [1, 108],
  ],
  memory: [
    [0, 100],
    [0.18, 82],
    [0.42, 69],
    [0.7, 93],
    [1, 108],
  ],
  lock: [
    [0, 100],
    [0.3, 119],
    [0.55, 132],
    [0.76, 91],
    [1, 68],
  ],
  decline: [
    [0, 100],
    [0.3, 94],
    [0.63, 76],
    [1, 57],
  ],
};
function generatePath({
  seed = 1,
  tenor = 3,
  vol = 30,
  scenario = "random",
}: {
  seed?: number;
  tenor?: number;
  vol?: number;
  scenario?: StructuredScenario;
} = {}): Float64Array {
  const random = seeded(seed),
    end = Math.round(tenor * DAYS),
    path = new Float64Array(end + 1);
  path[0] = 100;
  if (scenario === "random") {
    const sigma = vol / 100,
      dt = 1 / DAYS,
      drift = -0.5 * sigma * sigma * dt,
      shock = sigma * Math.sqrt(dt);
    for (let day = 1; day <= end; day++)
      path[day] = path[day - 1] * Math.exp(drift + shock * normal(random));
    return path;
  }
  const anchors = scenarioAnchors[scenario];
  let noise = 0;
  for (let day = 1; day <= end; day++) {
    noise = 0.93 * noise + normal(random) * (vol / 100) * 0.35;
    path[day] = Math.max(1, anchorLevel(anchors, day / end) * Math.exp(noise / 100));
  }
  return path;
}
function breachInfo(
  path: Float64Array,
  barrier: number,
): { breached: boolean; day: number | null } {
  for (let day = 1; day < path.length; day++)
    if (path[day] <= barrier) return { breached: true, day };
  return { breached: false, day: null };
}
function baseResult(
  path: Float64Array,
  events: StructuredEvent[],
  principal: number,
  coupons: number,
  extra: Partial<StructuredResult> = {},
): StructuredResult {
  const finalLevel = path.at(-1) ?? 0,
    totalReturn = principal + coupons - 100;
  return {
    path,
    events,
    principal,
    coupons,
    totalReturn,
    finalLevel,
    loss: totalReturn < 0,
    ...extra,
  };
}
function deliveryDetails(
  p: { settlement?: Settlement },
  called: boolean,
  principal: number,
  eligible = true,
) {
  const settlement = eligible ? p.settlement || "cash" : "cash",
    physicalDelivery = settlement === "physical" && !called && principal < 100;
  return {
    settlement,
    physicalDelivery,
    deliveredUnits: physicalDelivery ? 1 : 0,
    cashPrincipal: physicalDelivery ? 0 : principal,
    deliveryValue: physicalDelivery ? principal : 0,
  };
}

function evaluateRC(path: Float64Array, p: ReverseConvertibleParams): StructuredResult {
  const obs = observations(p.tenor, p.frequency),
    end = path.length - 1,
    variant = p.variant || "barrier",
    hasBarrier = variant !== "plain";
  const dailyBreach =
    hasBarrier && p.barrierObservation === "daily"
      ? breachInfo(path, p.barrier ?? 0)
      : { breached: false, day: null };
  let barrierBreached = false,
    coupons = 0,
    called = false,
    callKind = "",
    terminationDay = end,
    previous = 0,
    principal = 100;
  const events: StructuredEvent[] = [];
  for (let index = 0; index < obs.length; index++) {
    const day = obs[index],
      level = path[day],
      maturity = day === end,
      periodCoupon = (p.coupon * (day - previous)) / DAYS,
      wasBreached = barrierBreached;
    if (
      hasBarrier &&
      p.barrierObservation === "daily" &&
      dailyBreach.breached &&
      dailyBreach.day !== null &&
      dailyBreach.day <= day
    )
      barrierBreached = true;
    if (hasBarrier && p.barrierObservation === "maturity" && maturity && level <= (p.barrier ?? 0))
      barrierBreached = true;
    coupons += periodCoupon;
    let decision = "Continue";
    if (!maturity && index >= 1 && variant === "autocall" && level >= (p.callLevel ?? 100)) {
      called = true;
      callKind = "Automatic call";
      decision = "Autocall trigger met";
    }
    if (!maturity && index >= 1 && variant === "issuer") {
      const exercise =
        p.callPolicy === "first" || (p.callPolicy === "above" && level >= (p.callLevel ?? 100));
      if (exercise) {
        called = true;
        callKind = "Issuer call";
        decision = "Issuer exercises its right";
      } else decision = "Issuer does not exercise";
    }
    events.push({
      day,
      level,
      coupon: periodCoupon,
      couponTest: "Unconditional",
      memoryBank: 0,
      barrierState: barrierBreached,
      barrierNew: barrierBreached && !wasBreached,
      decision,
      state: called ? "Redeemed early" : maturity ? "Maturity" : "Alive",
    });
    previous = day;
    if (called) {
      terminationDay = day;
      break;
    }
  }
  if (!called) {
    const final = path[end];
    principal =
      variant === "plain" ? Math.min(100, final) : barrierBreached && final < 100 ? final : 100;
  }
  return baseResult(path, events, principal, coupons, {
    called,
    callKind,
    terminationDay,
    barrierBreached,
    life: terminationDay / DAYS,
    variant,
    ...deliveryDetails(p, called, principal),
  });
}

function evaluateCoupon(path: Float64Array, p: CouponParams): StructuredResult {
  const obs = observations(p.tenor, p.frequency),
    end = path.length - 1;
  let coupons = 0,
    bank = 0,
    missed = 0,
    recovered = 0,
    called = false,
    terminationDay = end,
    previous = 0,
    principal = 100;
  const events: StructuredEvent[] = [];
  for (let index = 0; index < obs.length; index++) {
    const day = obs[index],
      level = path[day],
      maturity = day === end,
      due = (p.coupon * (day - previous)) / DAYS,
      passes = p.style === "fixed" || level >= p.couponLevel;
    let paid = 0,
      recoveredNow = 0,
      couponTest = "Pass";
    if (p.style === "fixed") paid = due;
    else if (passes) {
      paid = due;
      if (p.style === "memory" && bank) {
        recoveredNow = due * bank;
        recovered += recoveredNow;
        paid += recoveredNow;
        bank = 0;
      }
    } else {
      missed++;
      couponTest = "Miss";
      if (p.style === "memory") bank++;
    }
    coupons += paid;
    let decision = "Continue";
    if (p.autocall && !maturity && index >= 1 && level >= p.callLevel) {
      called = true;
      decision = "Autocall trigger met";
      terminationDay = day;
    }
    events.push({
      day,
      level,
      coupon: paid,
      couponTest,
      memoryBank: bank,
      memoryRecovered: recoveredNow,
      barrierState: false,
      barrierNew: false,
      decision,
      state: called ? "Redeemed early" : maturity ? "Maturity" : "Alive",
    });
    previous = day;
    if (called) break;
  }
  const final = path[end],
    barrierBreached = !called && final < p.barrier;
  if (!called) principal = barrierBreached ? final : 100;
  return baseResult(path, events, principal, coupons, {
    called,
    callKind: called ? "Automatic call" : "",
    terminationDay,
    barrierBreached,
    life: terminationDay / DAYS,
    missed,
    recovered,
    memoryUnpaid: bank,
    style: p.style,
    ...deliveryDetails(p, called, principal),
  });
}

function evaluateLock(path: Float64Array, p: LockParams): StructuredResult {
  const obs = observations(p.tenor, p.frequency),
    end = path.length - 1;
  let lockedFloor = p.style === "step" ? p.initialFloor : 0,
    lockCount = 0,
    coupons = 0,
    previous = 0;
  const events: StructuredEvent[] = [];
  for (const day of obs) {
    const level = path[day],
      maturity = day === end,
      before = lockedFloor;
    let decision = "No new lock-in";
    if (level >= p.lockLevel) {
      const candidate = p.style === "par" ? 100 : (level * p.capture) / 100;
      lockedFloor = Math.max(lockedFloor, candidate);
      if (lockedFloor > before + 0.001) {
        lockCount++;
        decision = `New floor ${lockedFloor.toFixed(1)}`;
      }
    }
    const coupon = p.style === "par" ? ((p.coupon ?? 0) * (day - previous)) / DAYS : 0;
    coupons += coupon;
    events.push({
      day,
      level,
      coupon,
      couponTest: p.style === "par" ? "Unconditional" : "None",
      memoryBank: 0,
      barrierState: false,
      barrierNew: false,
      decision,
      state: maturity ? "Maturity" : "Alive",
      lockedFloor,
      lockChanged: lockedFloor > before + 0.001,
    });
    previous = day;
  }
  const final = path[end];
  let basePrincipal,
    barrierBreached = false;
  if (p.style === "par") {
    barrierBreached = final < (p.barrier ?? 0);
    basePrincipal = barrierBreached ? final : 100;
  } else basePrincipal = final;
  const principal = Math.max(basePrincipal, lockedFloor);
  return baseResult(path, events, principal, coupons, {
    called: false,
    callKind: "",
    terminationDay: end,
    barrierBreached,
    life: p.tenor,
    lockCount,
    lockedFloor,
    style: p.style,
    ...deliveryDetails(p, false, principal, p.style === "par"),
  });
}

function evaluate(mode: StructuredMode, path: Float64Array, p: StructuredParams): StructuredResult {
  return mode === "rc"
    ? evaluateRC(path, p as ReverseConvertibleParams)
    : mode === "coupon"
      ? evaluateCoupon(path, p as CouponParams)
      : evaluateLock(path, p as LockParams);
}
function simulate(
  mode: StructuredMode,
  p: StructuredParams,
  seed = 1,
  count = 2000,
): StructuredSimulation {
  const returns: number[] = [];
  let called = 0,
    loss = 0,
    barrier = 0,
    life = 0,
    coupons = 0,
    missed = 0,
    recovered = 0,
    locked = 0,
    lockFloor = 0,
    lockedFloorConditional = 0;
  for (let i = 0; i < count; i++) {
    const path = generatePath({
        seed: (seed + i * 2654435761) >>> 0,
        tenor: p.tenor,
        vol: p.vol,
        scenario: "random",
      }),
      result = evaluate(mode, path, p);
    const hasLock = (result.lockCount || 0) > 0;
    returns.push(result.totalReturn);
    called += result.called ? 1 : 0;
    loss += result.loss ? 1 : 0;
    barrier += result.barrierBreached ? 1 : 0;
    life += result.life ?? 0;
    coupons += result.coupons;
    missed += result.missed || 0;
    recovered += result.recovered || 0;
    locked += hasLock ? 1 : 0;
    lockFloor += result.lockedFloor || 0;
    if (hasLock) lockedFloorConditional += result.lockedFloor || 0;
  }
  returns.sort((a, b) => a - b);
  const stats = {
    called: called / count,
    loss: loss / count,
    barrier: barrier / count,
    averageLife: life / count,
    averageReturn: average(returns),
    averageCoupons: coupons / count,
    averageMissed: missed / count,
    averageRecovered: recovered / count,
    locked: locked / count,
    averageLockFloor: lockFloor / count,
    averageLockFloorWhenLocked: locked ? lockedFloorConditional / locked : 0,
  };
  return { mode, count, returns, stats };
}

export { DAYS, seeded, observations, generatePath, evaluate, simulate };
