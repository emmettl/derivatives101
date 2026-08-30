"use strict";

export interface NoteTerms {
  nominal: number;
  issuePrice: number;
  upfrontCost: number;
  initialSpot: number;
  strike: number;
  tenor: number;
  rate: number;
  issuerSpread: number;
  volatility: number;
  dividend: number;
}

export interface DesignedNote extends NoteTerms {
  estimatedValue: number;
  bond: number;
  optionUnit: number;
  optionBudget: number;
  participation: number;
  buildable: boolean;
}

export interface ValuationMarket {
  elapsed: number;
  spot: number;
  rate: number;
  issuerSpread: number;
  volatility: number;
  dividend: number;
  exitCost: number;
}

function normCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

function bsCall(
  spot: number,
  strike: number,
  tenor: number,
  rate: number,
  dividend: number,
  volatility: number,
): number {
  if (tenor <= 0) return Math.max(spot - strike, 0);
  if (volatility <= 0)
    return Math.max(spot * Math.exp(-dividend * tenor) - strike * Math.exp(-rate * tenor), 0);
  const rootT = Math.sqrt(tenor);
  const d1 =
    (Math.log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * tenor) /
    (volatility * rootT);
  const d2 = d1 - volatility * rootT;
  return (
    spot * Math.exp(-dividend * tenor) * normCdf(d1) -
    strike * Math.exp(-rate * tenor) * normCdf(d2)
  );
}

function designNote(terms: NoteTerms): DesignedNote {
  const estimatedValue = terms.issuePrice - terms.upfrontCost;
  const bond = terms.nominal * Math.exp(-(terms.rate + terms.issuerSpread) * terms.tenor);
  const optionUnit =
    bsCall(
      terms.initialSpot,
      terms.strike,
      terms.tenor,
      terms.rate,
      terms.dividend,
      terms.volatility,
    ) * Math.exp(-terms.issuerSpread * terms.tenor);
  const optionBudget = estimatedValue - bond;
  const participation = optionUnit > 0 ? Math.max(0, optionBudget / optionUnit) : 0;
  return Object.assign({}, terms, {
    estimatedValue,
    bond,
    optionUnit,
    optionBudget,
    participation,
    buildable: optionBudget >= 0 && optionUnit > 0,
  });
}

function markNote(note: DesignedNote, market: ValuationMarket) {
  const remaining = Math.max(0, note.tenor - market.elapsed);
  const maturityPayoff = note.nominal + note.participation * Math.max(market.spot - note.strike, 0);
  if (remaining === 0) {
    return {
      remaining,
      bond: note.nominal,
      option: maturityPayoff - note.nominal,
      modelValue: maturityPayoff,
      bid: maturityPayoff,
      maturityPayoff,
    };
  }
  const creditFactor = Math.exp(-market.issuerSpread * remaining);
  const bond = note.nominal * Math.exp(-(market.rate + market.issuerSpread) * remaining);
  const option =
    note.participation *
    bsCall(market.spot, note.strike, remaining, market.rate, market.dividend, market.volatility) *
    creditFactor;
  const modelValue = bond + option;
  const bid = Math.max(0, modelValue - market.exitCost);
  return { remaining, bond, option, modelValue, bid, maturityPayoff };
}

function buildAttribution(note: DesignedNote, market: ValuationMarket) {
  const issueMarket: ValuationMarket = {
    elapsed: 0,
    spot: note.initialSpot,
    rate: note.rate,
    issuerSpread: note.issuerSpread,
    volatility: note.volatility,
    dividend: note.dividend,
    exitCost: 0,
  };
  const steps = [];
  let previous = note.estimatedValue;
  let working = Object.assign({}, issueMarket, { elapsed: market.elapsed });

  function add(label: string, key: keyof ValuationMarket, value: number) {
    working[key] = value;
    const next = markNote(note, Object.assign({}, working, { exitCost: 0 })).modelValue;
    steps.push({ label, from: previous, to: next, change: next - previous });
    previous = next;
  }

  add("Time passed", "elapsed", market.elapsed);
  add("Underlying", "spot", market.spot);
  add("Reference rate", "rate", market.rate);
  add("Issuer spread", "issuerSpread", market.issuerSpread);
  add("Implied volatility", "volatility", market.volatility);
  add("Dividend yield", "dividend", market.dividend);
  steps.push({
    label: "Exit deduction",
    from: previous,
    to: Math.max(0, previous - market.exitCost),
    change: -Math.min(previous, market.exitCost),
  });
  return { start: note.estimatedValue, end: Math.max(0, previous - market.exitCost), steps };
}

function valueCurve(
  note: DesignedNote,
  market: ValuationMarket,
  minimum: number,
  maximum: number,
  count?: number,
) {
  const points = [];
  const n = Math.max(2, count || 81);
  for (let index = 0; index < n; index += 1) {
    const spot = minimum + ((maximum - minimum) * index) / (n - 1);
    const marked = markNote(note, Object.assign({}, market, { spot }));
    points.push({
      spot,
      modelValue: marked.modelValue,
      bid: marked.bid,
      maturityPayoff: marked.maturityPayoff,
    });
  }
  return points;
}

export { normCdf, bsCall, designNote, markNote, buildAttribution, valueCurve };
