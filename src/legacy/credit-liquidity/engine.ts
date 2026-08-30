"use strict";

export interface CreditInputs {
  contractualAmount: number;
  remaining: number;
  rate: number;
  spread: number;
  exitCost: number;
  recoveryRate: number;
  quoteAvailable: boolean;
  defaulted: boolean;
}

const presets = {
  normal: {
    id: "normal",
    name: "Normal market",
    contractualAmount: 100,
    remaining: 3,
    rate: 0.03,
    spread: 0.015,
    exitCost: 1,
    recoveryRate: 0.4,
    quoteAvailable: true,
    defaulted: false,
  },
  stressed: {
    id: "stressed",
    name: "Credit stress",
    contractualAmount: 100,
    remaining: 3,
    rate: 0.03,
    spread: 0.06,
    exitCost: 4,
    recoveryRate: 0.3,
    quoteAvailable: true,
    defaulted: false,
  },
  closed: {
    id: "closed",
    name: "No secondary quote",
    contractualAmount: 100,
    remaining: 3,
    rate: 0.03,
    spread: 0.06,
    exitCost: 4,
    recoveryRate: 0.3,
    quoteAvailable: false,
    defaulted: false,
  },
  default: {
    id: "default",
    name: "Issuer default",
    contractualAmount: 100,
    remaining: 3,
    rate: 0.03,
    spread: 0.06,
    exitCost: 4,
    recoveryRate: 0.3,
    quoteAvailable: false,
    defaulted: true,
  },
};

function value(inputs: CreditInputs) {
  const nominal = 100;
  const defaultFree = inputs.contractualAmount * Math.exp(-inputs.rate * inputs.remaining);
  const creditAdjusted =
    inputs.contractualAmount * Math.exp(-(inputs.rate + inputs.spread) * inputs.remaining);
  const creditAdjustment = creditAdjusted - defaultFree;
  const bid =
    inputs.quoteAvailable && !inputs.defaulted
      ? Math.max(0, creditAdjusted - inputs.exitCost)
      : null;
  const recoveryScenario = nominal * inputs.recoveryRate;
  return {
    nominal,
    defaultFree,
    creditAdjusted,
    creditAdjustment,
    bid,
    recoveryScenario,
    exitAdjustment: bid == null ? null : bid - creditAdjusted,
  };
}

function spreadCurve(inputs: CreditInputs, maximumSpread?: number, count?: number) {
  const points: Array<{
    spread: number;
    defaultFree: number;
    creditAdjusted: number;
    bid: number | null;
  }> = [];
  const total = Math.max(2, count || 81);
  const maximum = maximumSpread == null ? 0.12 : maximumSpread;
  for (let index = 0; index < total; index += 1) {
    const spread = (maximum * index) / (total - 1);
    const result = value(Object.assign({}, inputs, { spread, defaulted: false }));
    points.push({
      spread,
      defaultFree: result.defaultFree,
      creditAdjusted: result.creditAdjusted,
      bid: result.bid,
    });
  }
  return points;
}

export { presets, value, spreadCurve };
