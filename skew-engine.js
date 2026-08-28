(function (root) {
  "use strict";

  const presets = {
    flat: { id: "flat", name: "Flat", skew: 0, curvature: 0 },
    equity: { id: "equity", name: "Equity downside skew", skew: -0.22, curvature: 0.08 },
    smile: { id: "smile", name: "Symmetric smile", skew: 0, curvature: 0.55 },
    call: { id: "call", name: "Upside call skew", skew: 0.18, curvature: 0.1 }
  };

  function normCdf(x) {
    const sign = x < 0 ? -1 : 1;
    const z = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * z);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-z * z);
    return 0.5 * (1 + sign * erf);
  }

  function optionPrices(spot, strike, tenor, rate, dividend, volatility) {
    if (tenor <= 0) return { call: Math.max(spot - strike, 0), put: Math.max(strike - spot, 0) };
    const rootT = Math.sqrt(tenor);
    const d1 = (Math.log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * tenor) / (volatility * rootT);
    const d2 = d1 - volatility * rootT;
    const call = spot * Math.exp(-dividend * tenor) * normCdf(d1) - strike * Math.exp(-rate * tenor) * normCdf(d2);
    const put = strike * Math.exp(-rate * tenor) * normCdf(-d2) - spot * Math.exp(-dividend * tenor) * normCdf(-d1);
    return { call, put };
  }

  function surfaceVol(config, strike) {
    const moneyness = strike / config.spot - 1;
    return Math.max(0.03, Math.min(1.5, config.atmVolatility + config.skew * moneyness + config.curvature * moneyness * moneyness));
  }

  function point(config, strike) {
    const localVolatility = surfaceVol(config, strike);
    const flat = optionPrices(config.spot, strike, config.tenor, config.rate, config.dividend, config.atmVolatility);
    const surface = optionPrices(config.spot, strike, config.tenor, config.rate, config.dividend, localVolatility);
    return { strike, moneyness: strike / config.spot, localVolatility, flat, surface };
  }

  function curve(config, minimum, maximum, count) {
    const output = [];
    const total = Math.max(2, count || 81);
    for (let index = 0; index < total; index += 1) output.push(point(config, minimum + (maximum - minimum) * index / (total - 1)));
    return output;
  }

  function annuityFactor(rate, tenor) {
    return Math.abs(rate) < 1e-10 ? tenor : (1 - Math.exp(-rate * tenor)) / rate;
  }

  function productTerms(config) {
    const putPoint = point(config, config.putStrike);
    const callPoint = point(config, config.callStrike);
    const putScale = 100 / config.putStrike;
    const flatPutCost = putScale * putPoint.flat.put;
    const surfacePutCost = putScale * putPoint.surface.put;
    const annuity = 100 * annuityFactor(config.rate, config.tenor);
    const flatCoupon = flatPutCost / annuity;
    const surfaceCoupon = surfacePutCost / annuity;
    const flatParticipation = config.optionBudget / callPoint.flat.call;
    const surfaceParticipation = config.optionBudget / callPoint.surface.call;
    return { putPoint, callPoint, flatPutCost, surfacePutCost, flatCoupon, surfaceCoupon, flatParticipation, surfaceParticipation };
  }

  const api = { presets, normCdf, optionPrices, surfaceVol, point, curve, annuityFactor, productTerms };
  root.SkewEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof self !== "undefined" ? self : globalThis));
