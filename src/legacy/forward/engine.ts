"use strict";

export interface ForwardConfig {
  spot: number;
  rate: number;
  dividendYield: number;
  tenor: number;
  strike: number;
  volatility: number;
  optionBudget: number;
}

const presets = {
  financing: {
    id: "financing",
    name: "Financing dominates",
    spot: 100,
    rate: 0.05,
    dividendYield: 0.01,
    tenor: 2,
    strike: 100,
    volatility: 0.2,
    optionBudget: 10,
  },
  dividends: {
    id: "dividends",
    name: "Dividends dominate",
    spot: 100,
    rate: 0.015,
    dividendYield: 0.045,
    tenor: 2,
    strike: 100,
    volatility: 0.2,
    optionBudget: 10,
  },
  neutral: {
    id: "neutral",
    name: "Carry neutral",
    spot: 100,
    rate: 0.03,
    dividendYield: 0.03,
    tenor: 3,
    strike: 100,
    volatility: 0.2,
    optionBudget: 10,
  },
  longDated: {
    id: "longDated",
    name: "Long-dated carry",
    spot: 100,
    rate: 0.04,
    dividendYield: 0.015,
    tenor: 5,
    strike: 110,
    volatility: 0.25,
    optionBudget: 10,
  },
};

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function optionFromForward(
  forward: number,
  strike: number,
  tenor: number,
  rate: number,
  volatility: number,
) {
  if (tenor <= 0 || volatility <= 0) {
    const discountFactor = Math.exp(-rate * Math.max(0, tenor));
    return {
      call: discountFactor * Math.max(forward - strike, 0),
      put: discountFactor * Math.max(strike - forward, 0),
    };
  }
  const rootT = Math.sqrt(tenor);
  const d1 =
    (Math.log(forward / strike) + 0.5 * volatility * volatility * tenor) / (volatility * rootT);
  const d2 = d1 - volatility * rootT;
  const discountFactor = Math.exp(-rate * tenor);
  return {
    call: discountFactor * (forward * normCdf(d1) - strike * normCdf(d2)),
    put: discountFactor * (strike * normCdf(-d2) - forward * normCdf(-d1)),
  };
}

function metrics(config: ForwardConfig) {
  const rateDiscount = Math.exp(-config.rate * config.tenor);
  const dividendDiscount = Math.exp(-config.dividendYield * config.tenor);
  const prepaidForward = config.spot * dividendDiscount;
  const forward = config.spot * Math.exp((config.rate - config.dividendYield) * config.tenor);
  const financingOnlyForward = config.spot * Math.exp(config.rate * config.tenor);
  const dividendOnlyForward = config.spot * dividendDiscount;
  const prices = optionFromForward(
    forward,
    config.strike,
    config.tenor,
    config.rate,
    config.volatility,
  );
  const spotForwardPrices = optionFromForward(
    config.spot,
    config.strike,
    config.tenor,
    config.rate,
    config.volatility,
  );
  return {
    spot: config.spot,
    rateDiscount,
    dividendDiscount,
    prepaidForward,
    forward,
    financingOnlyForward,
    dividendOnlyForward,
    dividendAdjustment: prepaidForward - config.spot,
    financingAdjustment: forward - prepaidForward,
    basis: forward - config.spot,
    carryReturn: forward / config.spot - 1,
    netCarry: config.rate - config.dividendYield,
    forwardMoneyness: config.strike / forward,
    prices,
    spotForwardPrices,
    participation: config.optionBudget / prices.call,
    spotForwardParticipation: config.optionBudget / spotForwardPrices.call,
    parityLeft: prices.call - prices.put,
    parityRight: config.spot * dividendDiscount - config.strike * rateDiscount,
  };
}

function forwardCurve(config: ForwardConfig, maximumTenor: number, count?: number) {
  const points = [];
  const total = Math.max(2, count || 101);
  for (let index = 0; index < total; index += 1) {
    const tenor = (maximumTenor * index) / (total - 1);
    points.push({
      tenor,
      forward: config.spot * Math.exp((config.rate - config.dividendYield) * tenor),
      financingOnly: config.spot * Math.exp(config.rate * tenor),
      dividendOnly: config.spot * Math.exp(-config.dividendYield * tenor),
      spot: config.spot,
    });
  }
  return points;
}

function optionStrip(
  config: ForwardConfig,
  minimumStrike: number,
  maximumStrike: number,
  count?: number,
) {
  const points = [];
  const total = Math.max(2, count || 81);
  const result = metrics(config);
  for (let index = 0; index < total; index += 1) {
    const strike = minimumStrike + ((maximumStrike - minimumStrike) * index) / (total - 1);
    points.push({
      strike,
      carried: optionFromForward(
        result.forward,
        strike,
        config.tenor,
        config.rate,
        config.volatility,
      ),
      spotForward: optionFromForward(
        config.spot,
        strike,
        config.tenor,
        config.rate,
        config.volatility,
      ),
    });
  }
  return points;
}

export { presets, normCdf, optionFromForward, metrics, forwardCurve, optionStrip };
