"use strict";

interface NoteBase {
  nominal: number;
  issuePrice: number;
  estimatedValue: number;
  strike: number;
  initialSpot: number;
  rate: number;
  issuerSpread: number;
  dividend: number;
  name: string;
  tenor: number;
  issueVolatility: number;
  description: string;
  issueBond: number;
}

export interface ProtectedNote extends NoteBase {
  id: "protected";
  issueOptionUnit: number;
  participation: number;
}

export interface ReverseNote extends NoteBase {
  id: "reverse";
  putScale: number;
  issuePut: number;
  couponRate: number;
}

export type RiskNote = ProtectedNote | ReverseNote;

export interface RiskMarket {
  spot: number;
  remaining: number;
  volatility: number;
  rate: number;
  issuerSpread: number;
  dividend: number;
}

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

function bsPut(
  spot: number,
  strike: number,
  tenor: number,
  rate: number,
  dividend: number,
  volatility: number,
): number {
  if (tenor <= 0) return Math.max(strike - spot, 0);
  if (volatility <= 0)
    return Math.max(strike * Math.exp(-rate * tenor) - spot * Math.exp(-dividend * tenor), 0);
  const rootT = Math.sqrt(tenor);
  const d1 =
    (Math.log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * tenor) /
    (volatility * rootT);
  const d2 = d1 - volatility * rootT;
  return (
    strike * Math.exp(-rate * tenor) * normCdf(-d2) -
    spot * Math.exp(-dividend * tenor) * normCdf(-d1)
  );
}

function annuityFactor(yieldRate: number, tenor: number): number {
  return Math.abs(yieldRate) < 1e-10 ? tenor : (1 - Math.exp(-yieldRate * tenor)) / yieldRate;
}

function designProducts(): { protected: ProtectedNote; reverse: ReverseNote } {
  const common = {
    nominal: 100,
    issuePrice: 100,
    estimatedValue: 98,
    strike: 100,
    initialSpot: 100,
    rate: 0.03,
    issuerSpread: 0.015,
    dividend: 0.02,
  };
  const protectedTerms = {
    ...common,
    id: "protected" as const,
    name: "Capital protected note",
    tenor: 5,
    issueVolatility: 0.18,
    description: "Issuer bond + long call",
  };
  const protectedBond =
    protectedTerms.nominal *
    Math.exp(-(protectedTerms.rate + protectedTerms.issuerSpread) * protectedTerms.tenor);
  const issueOptionUnit =
    bsCall(
      protectedTerms.initialSpot,
      protectedTerms.strike,
      protectedTerms.tenor,
      protectedTerms.rate,
      protectedTerms.dividend,
      protectedTerms.issueVolatility,
    ) * Math.exp(-protectedTerms.issuerSpread * protectedTerms.tenor);
  const protectedNote: ProtectedNote = {
    ...protectedTerms,
    issueBond: protectedBond,
    issueOptionUnit,
    participation: (protectedTerms.estimatedValue - protectedBond) / issueOptionUnit,
  };

  const reverseTerms = {
    ...common,
    id: "reverse" as const,
    name: "Reverse convertible",
    tenor: 2,
    issueVolatility: 0.25,
    description: "Issuer bond + coupons − short put",
    putScale: common.nominal / common.strike,
  };
  const reverseBond =
    reverseTerms.nominal *
    Math.exp(-(reverseTerms.rate + reverseTerms.issuerSpread) * reverseTerms.tenor);
  const issuePut =
    reverseTerms.putScale *
    bsPut(
      reverseTerms.initialSpot,
      reverseTerms.strike,
      reverseTerms.tenor,
      reverseTerms.rate,
      reverseTerms.dividend,
      reverseTerms.issueVolatility,
    ) *
    Math.exp(-reverseTerms.issuerSpread * reverseTerms.tenor);
  const issueAnnuity =
    reverseTerms.nominal *
    annuityFactor(reverseTerms.rate + reverseTerms.issuerSpread, reverseTerms.tenor);
  const reverseConvertible: ReverseNote = {
    ...reverseTerms,
    issueBond: reverseBond,
    issuePut,
    couponRate: (reverseTerms.estimatedValue - reverseBond + issuePut) / issueAnnuity,
  };
  return { protected: protectedNote, reverse: reverseConvertible };
}

function components(note: RiskNote, market: RiskMarket) {
  const tenor = Math.max(0, market.remaining);
  if (tenor === 0) {
    if (note.id === "protected")
      return {
        bond: note.nominal,
        coupons: 0,
        option: note.participation * Math.max(market.spot - note.strike, 0),
      };
    return {
      bond: note.nominal,
      coupons: 0,
      option: -note.putScale * Math.max(note.strike - market.spot, 0),
    };
  }
  const creditFactor = Math.exp(-market.issuerSpread * tenor);
  const bond = note.nominal * Math.exp(-(market.rate + market.issuerSpread) * tenor);
  if (note.id === "protected") {
    return {
      bond,
      coupons: 0,
      option:
        note.participation *
        bsCall(market.spot, note.strike, tenor, market.rate, market.dividend, market.volatility) *
        creditFactor,
    };
  }
  const coupons =
    note.couponRate * note.nominal * annuityFactor(market.rate + market.issuerSpread, tenor);
  const option =
    -note.putScale *
    bsPut(market.spot, note.strike, tenor, market.rate, market.dividend, market.volatility) *
    creditFactor;
  return { bond, coupons, option };
}

function value(note: RiskNote, market: RiskMarket) {
  const parts = components(note, market);
  return { value: parts.bond + parts.coupons + parts.option, components: parts };
}

function maturityPayoff(note: RiskNote, spot: number): number {
  if (note.id === "protected")
    return note.nominal + note.participation * Math.max(spot - note.strike, 0);
  return note.nominal - note.putScale * Math.max(note.strike - spot, 0);
}

function sensitivities(note: RiskNote, market: RiskMarket) {
  const base = value(note, market).value;
  const spotStep = Math.max(0.1, market.spot * 0.0025);
  const upSpot = value(note, Object.assign({}, market, { spot: market.spot + spotStep })).value;
  const downSpot = value(
    note,
    Object.assign({}, market, { spot: Math.max(0.01, market.spot - spotStep) }),
  ).value;
  const delta = (upSpot - downSpot) / (2 * spotStep);
  const gamma = (upSpot - 2 * base + downSpot) / (spotStep * spotStep);
  const volStep = Math.min(0.005, Math.max(0.0005, market.volatility / 2));
  const upVol = value(
    note,
    Object.assign({}, market, { volatility: market.volatility + volStep }),
  ).value;
  const downVol = value(
    note,
    Object.assign({}, market, { volatility: Math.max(0.0001, market.volatility - volStep) }),
  ).value;
  const vegaOnePoint = ((upVol - downVol) / (2 * volStep)) * 0.01;
  const nextRemaining = Math.max(0, market.remaining - Math.min(1 / 12, market.remaining));
  const oneMonthCarry =
    value(note, Object.assign({}, market, { remaining: nextRemaining })).value - base;
  const spreadUp =
    value(note, Object.assign({}, market, { issuerSpread: market.issuerSpread + 0.01 })).value -
    base;
  return { value: base, delta, gamma, vegaOnePoint, oneMonthCarry, spreadUp };
}

function curve(
  note: RiskNote,
  market: RiskMarket,
  minimum: number,
  maximum: number,
  count?: number,
) {
  const points = [];
  const total = Math.max(2, count || 81);
  for (let index = 0; index < total; index += 1) {
    const spot = minimum + ((maximum - minimum) * index) / (total - 1);
    const pointMarket = Object.assign({}, market, { spot });
    const risk = sensitivities(note, pointMarket);
    points.push(Object.assign({ spot, maturityPayoff: maturityPayoff(note, spot) }, risk));
  }
  return points;
}

export {
  normCdf,
  bsCall,
  bsPut,
  annuityFactor,
  designProducts,
  components,
  value,
  maturityPayoff,
  sensitivities,
  curve,
};
