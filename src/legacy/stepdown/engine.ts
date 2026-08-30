"use strict";

export interface StepDownConfig {
  path: number[];
  startCall: number;
  stepSize: number;
  callFloor: number;
  couponBarrier: number;
  couponPerObservation: number;
  protectionBarrier: number;
}

const presets = {
  lateRecovery: {
    id: "lateRecovery",
    name: "Late recovery",
    path: [92, 88, 84, 82, 83, 86, 89, 91],
  },
  earlyRally: {
    id: "earlyRally",
    name: "Early rally",
    path: [103, 108, 112, 109, 114, 118, 121, 125],
  },
  couponGap: {
    id: "couponGap",
    name: "Coupon interruption",
    path: [96, 82, 68, 74, 78, 81, 84, 86],
  },
  maturityLoss: {
    id: "maturityLoss",
    name: "Maturity loss",
    path: [94, 88, 81, 73, 66, 62, 58, 52],
  },
};

function callThreshold(config: StepDownConfig, index: number): number {
  return Math.max(config.callFloor, config.startCall - config.stepSize * index);
}

function evaluate(config: StepDownConfig) {
  const events = [];
  let calledIndex = null;
  let totalCoupons = 0;
  for (let index = 0; index < config.path.length; index += 1) {
    const level = config.path[index];
    const maturity = index === config.path.length - 1;
    const threshold = callThreshold(config, index);
    if (calledIndex != null) {
      events.push({
        index,
        level,
        maturity,
        threshold,
        active: false,
        couponPass: false,
        couponPaid: 0,
        callEligible: false,
        callPass: false,
        decision: "Not observed · note already redeemed",
        cumulativeCoupons: totalCoupons,
        state: "Ended",
      });
      continue;
    }
    const couponPass = level >= config.couponBarrier;
    const couponPaid = couponPass ? config.couponPerObservation : 0;
    totalCoupons += couponPaid;
    const callEligible = !maturity;
    const callPass = callEligible && level >= threshold;
    if (callPass) calledIndex = index;
    events.push({
      index,
      level,
      maturity,
      threshold,
      active: true,
      couponPass,
      couponPaid,
      callEligible,
      callPass,
      decision: callPass
        ? "Autocall threshold met"
        : maturity
          ? "Maturity rules apply"
          : "Continue",
      cumulativeCoupons: totalCoupons,
      state: callPass ? "Redeemed early" : maturity ? "Maturity" : "Alive",
    });
  }
  const finalLevel = config.path[config.path.length - 1];
  const protectionPass = finalLevel >= config.protectionBarrier;
  const principal = calledIndex != null || protectionPass ? 100 : finalLevel;
  const totalCash = principal + totalCoupons;
  return {
    events,
    called: calledIndex != null,
    calledIndex,
    heldObservations: calledIndex == null ? config.path.length : calledIndex + 1,
    totalCoupons,
    finalLevel,
    protectionPass,
    principal,
    totalCash,
    totalReturn: totalCash - 100,
  };
}

function compare(config: StepDownConfig) {
  return {
    stepDown: evaluate(config),
    fixed: evaluate(Object.assign({}, config, { stepSize: 0, callFloor: config.startCall })),
  };
}

export { presets, callThreshold, evaluate, compare };
