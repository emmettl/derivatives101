(function (root) {
  "use strict";

  function leg(id, side, quantity, type, strike, barrierType, barrier) {
    return { id, enabled: true, side, quantity, type, strike, barrierType: barrierType || "none", barrier: barrier || 0 };
  }

  const presets = {
    longCall: { id: "longCall", name: "Long call", description: "One call creates convex upside with a known premium at risk.", legs: [leg(1, "long", 1, "call", 100)] },
    bullSpread: { id: "bullSpread", name: "Bull call spread", description: "Buy lower-strike upside and fund part of it by selling a higher strike.", legs: [leg(1, "long", 1, "call", 95), leg(2, "short", 1, "call", 110)] },
    bearSpread: { id: "bearSpread", name: "Bear put spread", description: "Buy downside protection and sell the more remote downside tail.", legs: [leg(1, "long", 1, "put", 105), leg(2, "short", 1, "put", 90)] },
    straddle: { id: "straddle", name: "Straddle", description: "Buy a call and put at the same strike: direction matters less than the size of the move.", legs: [leg(1, "long", 1, "call", 100), leg(2, "long", 1, "put", 100)] },
    strangle: { id: "strangle", name: "Strangle", description: "Move the call and put strikes apart: cheaper than a straddle, but a larger move is needed.", legs: [leg(1, "long", 1, "put", 90), leg(2, "long", 1, "call", 110)] },
    butterfly: { id: "butterfly", name: "Call butterfly", description: "Long one lower call, short two middle calls and long one upper call: a three-leg view on where expiry lands.", legs: [leg(1, "long", 1, "call", 90), leg(2, "short", 2, "call", 100), leg(3, "long", 1, "call", 110)] },
    riskReversal: { id: "riskReversal", name: "Risk reversal", description: "Buy an upside call and finance it by selling a downside put.", legs: [leg(1, "short", 1, "put", 90), leg(2, "long", 1, "call", 110)] },
    seagull: { id: "seagull", name: "Seagull", description: "A call spread financed further by selling a downside put: capped upside with a downside obligation.", legs: [leg(1, "short", 1, "put", 85), leg(2, "long", 1, "call", 105), leg(3, "short", 1, "call", 120)] },
    barrierWings: { id: "barrierWings", name: "Barrier wings", description: "A down-and-in put and up-and-in call activate only after their respective barriers are touched.", legs: [leg(1, "long", 1, "put", 90, "down-in", 75), leg(2, "long", 1, "call", 110, "up-in", 125)] }
  };

  function clonePreset(preset, spot) {
    const scale = spot / 100;
    const legs = preset.legs.map((item) => Object.assign({}, item, { strike: item.strike * scale, barrier: item.barrier ? item.barrier * scale : 0 }));
    while (legs.length < 3) legs.push({ id: legs.length + 1, enabled: false, side: "long", quantity: 1, type: "call", strike: spot, barrierType: "none", barrier: spot * 1.2 });
    return Object.assign({}, preset, { legs });
  }

  function normCdf(x) {
    const sign = x < 0 ? -1 : 1;
    const value = Math.abs(x) / Math.sqrt(2);
    const t = 1 / (1 + 0.3275911 * value);
    const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-value * value);
    return 0.5 * (1 + sign * erf);
  }

  function vanillaPrice(market, optionType, strike, spotOverride) {
    const spot = spotOverride == null ? market.spot : spotOverride;
    const tenor = Math.max(0.000001, market.tenor);
    const volatility = Math.max(0.000001, market.volatility);
    const rootT = Math.sqrt(tenor);
    const d1 = (Math.log(spot / strike) + (market.rate - market.dividend + 0.5 * volatility * volatility) * tenor) / (volatility * rootT);
    const d2 = d1 - volatility * rootT;
    if (optionType === "call") return spot * Math.exp(-market.dividend * tenor) * normCdf(d1) - strike * Math.exp(-market.rate * tenor) * normCdf(d2);
    return strike * Math.exp(-market.rate * tenor) * normCdf(-d2) - spot * Math.exp(-market.dividend * tenor) * normCdf(-d1);
  }

  function hitProbability(market, barrierType, barrier) {
    if (barrierType === "none") return 0;
    const direction = barrierType.startsWith("down") ? "down" : "up";
    if ((direction === "down" && barrier >= market.spot) || (direction === "up" && barrier <= market.spot)) return 1;
    const sigma = Math.max(0.000001, market.volatility);
    const tenor = Math.max(0.000001, market.tenor);
    const drift = market.rate - market.dividend - 0.5 * sigma * sigma;
    const root = sigma * Math.sqrt(tenor);
    const h = Math.log(barrier / market.spot);
    let probability;
    if (direction === "up") {
      probability = normCdf((drift * tenor - h) / root) + Math.exp(2 * drift * h / (sigma * sigma)) * normCdf((-drift * tenor - h) / root);
    } else {
      probability = normCdf((-drift * tenor + h) / root) + Math.exp(2 * drift * h / (sigma * sigma)) * normCdf((drift * tenor + h) / root);
    }
    return Math.max(0, Math.min(1, probability));
  }

  function premium(market, optionLeg) {
    const vanilla = vanillaPrice(market, optionLeg.type, optionLeg.strike);
    if (optionLeg.barrierType === "none") return { premium: vanilla, vanilla, weight: 1, hitProbability: 0 };
    const probability = hitProbability(market, optionLeg.barrierType, optionLeg.barrier);
    const isIn = optionLeg.barrierType.endsWith("-in");
    const weight = isIn ? probability : 1 - probability;
    return { premium: vanilla * weight, vanilla, weight, hitProbability: probability };
  }

  function barrierHit(optionLeg, terminalSpot, observedLow, observedHigh, initialSpot) {
    if (optionLeg.barrierType === "none") return false;
    const low = Math.min(observedLow, terminalSpot, initialSpot);
    const high = Math.max(observedHigh, terminalSpot, initialSpot);
    return optionLeg.barrierType.startsWith("down") ? low <= optionLeg.barrier : high >= optionLeg.barrier;
  }

  function isActive(optionLeg, hit) {
    if (optionLeg.barrierType === "none") return true;
    return optionLeg.barrierType.endsWith("-in") ? hit : !hit;
  }

  function intrinsic(optionType, strike, terminalSpot) {
    return optionType === "call" ? Math.max(terminalSpot - strike, 0) : Math.max(strike - terminalSpot, 0);
  }

  function legOutcome(market, optionLeg, terminalSpot, observedLow, observedHigh) {
    if (!optionLeg.enabled) return { payoff: 0, pnl: 0, signedQuantity: 0, premium: 0, hit: false, active: false };
    const pricing = premium(market, optionLeg);
    const hit = barrierHit(optionLeg, terminalSpot, observedLow, observedHigh, market.spot);
    const active = isActive(optionLeg, hit);
    const payoff = active ? intrinsic(optionLeg.type, optionLeg.strike, terminalSpot) : 0;
    const signedQuantity = (optionLeg.side === "long" ? 1 : -1) * optionLeg.quantity;
    return { payoff, pnl: signedQuantity * (payoff - pricing.premium), signedQuantity, premium: pricing.premium, hit, active, pricing };
  }

  function strategyOutcome(market, legs, terminalSpot, observedLow, observedHigh) {
    const outcomes = legs.map((optionLeg) => legOutcome(market, optionLeg, terminalSpot, observedLow, observedHigh));
    return {
      terminalSpot,
      legs: outcomes,
      pnl: outcomes.reduce((sum, result) => sum + result.pnl, 0),
      payoff: outcomes.reduce((sum, result) => sum + result.signedQuantity * result.payoff, 0),
      netPremium: outcomes.reduce((sum, result) => sum + result.signedQuantity * result.premium, 0)
    };
  }

  function strategyCurve(market, legs, observedLow, observedHigh, minimum, maximum, count) {
    const points = [];
    const total = Math.max(3, count || 241);
    for (let index = 0; index < total; index += 1) {
      const terminalSpot = minimum + (maximum - minimum) * index / (total - 1);
      points.push(strategyOutcome(market, legs, terminalSpot, observedLow, observedHigh));
    }
    return points;
  }

  function breakEvens(points) {
    const values = [];
    for (let index = 1; index < points.length; index += 1) {
      const left = points[index - 1], right = points[index];
      if (left.pnl === 0) values.push(left.terminalSpot);
      const stateChanged = left.legs.some((legResult, legIndex) => legResult.active !== right.legs[legIndex].active);
      if (left.pnl * right.pnl < 0 && !stateChanged) {
        const weight = -left.pnl / (right.pnl - left.pnl);
        values.push(left.terminalSpot + weight * (right.terminalSpot - left.terminalSpot));
      }
    }
    return values.filter((value, index) => index === 0 || Math.abs(value - values[index - 1]) > 0.25);
  }

  function metrics(market, legs, observedLow, observedHigh, selectedTerminal) {
    const minimum = Math.max(1, market.spot * 0.4);
    const maximum = market.spot * 1.6;
    const curve = strategyCurve(market, legs, observedLow, observedHigh, minimum, maximum, 321);
    const pnl = curve.map((point) => point.pnl);
    const selected = strategyOutcome(market, legs, selectedTerminal, observedLow, observedHigh);
    return { curve, selected, breakEvens: breakEvens(curve), minimumPnl: Math.min(...pnl), maximumPnl: Math.max(...pnl), netPremium: selected.netPremium };
  }

  const api = { presets, clonePreset, normCdf, vanillaPrice, hitProbability, premium, barrierHit, isActive, intrinsic, legOutcome, strategyOutcome, strategyCurve, breakEvens, metrics };
  root.StrategyEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
}(typeof self !== "undefined" ? self : globalThis));
