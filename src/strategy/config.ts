import type { BarrierType, CatalogueRow, MarketControl, OptionLeg, OptionType, RuleRow, Side, StrategyPreset, StrategyState } from "./types";

export const MAX_LEGS = 4;

function leg(id: number, side: Side, quantity: number, type: OptionType, strike: number, barrierType: BarrierType = "none", barrier = 0): OptionLeg {
  return { id, enabled: true, side, quantity, type, strike, barrierType, barrier };
}

export const presets = {
  longCall: {
    id: "longCall",
    name: "Long call",
    description: "One call creates convex upside with a known premium at risk.",
    legs: [leg(1, "long", 1, "call", 100)]
  },
  bullSpread: {
    id: "bullSpread",
    name: "Bull call spread",
    description: "Buy lower-strike upside and fund part of it by selling a higher strike.",
    legs: [leg(1, "long", 1, "call", 95), leg(2, "short", 1, "call", 110)]
  },
  bearSpread: {
    id: "bearSpread",
    name: "Bear put spread",
    description: "Buy downside protection and sell the more remote downside tail.",
    legs: [leg(1, "long", 1, "put", 105), leg(2, "short", 1, "put", 90)]
  },
  straddle: {
    id: "straddle",
    name: "Straddle",
    description: "Buy a call and put at the same strike: direction matters less than the size of the move.",
    legs: [leg(1, "long", 1, "call", 100), leg(2, "long", 1, "put", 100)]
  },
  strangle: {
    id: "strangle",
    name: "Strangle",
    description: "Move the call and put strikes apart: cheaper than a straddle, but a larger move is needed.",
    legs: [leg(1, "long", 1, "put", 90), leg(2, "long", 1, "call", 110)]
  },
  butterfly: {
    id: "butterfly",
    name: "Call butterfly",
    description: "Long one lower call, short two middle calls and long one upper call: a three-contract-line view on where expiry lands.",
    legs: [leg(1, "long", 1, "call", 90), leg(2, "short", 2, "call", 100), leg(3, "long", 1, "call", 110)]
  },
  ironCondor: {
    id: "ironCondor",
    name: "Iron condor",
    description: "Sell an out-of-the-money put spread and call spread: a four-leg credit strategy with capped tail losses.",
    legs: [
      leg(1, "long", 1, "put", 80),
      leg(2, "short", 1, "put", 90),
      leg(3, "short", 1, "call", 110),
      leg(4, "long", 1, "call", 120)
    ]
  },
  riskReversal: {
    id: "riskReversal",
    name: "Risk reversal",
    description: "Buy an upside call and finance it by selling a downside put.",
    legs: [leg(1, "short", 1, "put", 90), leg(2, "long", 1, "call", 110)]
  },
  seagull: {
    id: "seagull",
    name: "Seagull",
    description: "A call spread financed further by selling a downside put: capped upside with a downside obligation.",
    legs: [leg(1, "short", 1, "put", 85), leg(2, "long", 1, "call", 105), leg(3, "short", 1, "call", 120)]
  },
  barrierWings: {
    id: "barrierWings",
    name: "Barrier wings",
    description: "A down-and-in put and up-and-in call activate only after their respective barriers are touched.",
    legs: [leg(1, "long", 1, "put", 90, "down-in", 75), leg(2, "long", 1, "call", 110, "up-in", 125)]
  }
} satisfies Record<string, StrategyPreset>;

export const marketControls: MarketControl[] = [
  { key: "spot", label: "Initial spot", min: 60, max: 140, step: 1, format: value => value.toFixed(0) },
  { key: "volatility", label: "Volatility", min: 0.05, max: 0.8, step: 0.01, format: value => `${(value * 100).toFixed(0)}%` },
  { key: "tenor", label: "Time to expiry", min: 0.1, max: 3, step: 0.1, format: value => `${value.toFixed(1)}y` },
  { key: "rate", label: "Interest rate", min: -0.02, max: 0.12, step: 0.0025, format: value => `${(value * 100).toFixed(2)}%` },
  { key: "dividend", label: "Dividend yield", min: 0, max: 0.1, step: 0.0025, format: value => `${(value * 100).toFixed(2)}%` },
  { key: "observedLow", label: "Observed path low", min: 40, max: 100, step: 1, format: value => value.toFixed(0) },
  { key: "observedHigh", label: "Observed path high", min: 100, max: 160, step: 1, format: value => value.toFixed(0) },
  { key: "terminal", label: "Selected expiry level", min: 40, max: 160, step: 1, format: value => value.toFixed(0) }
];

export const catalogue: CatalogueRow[] = [
  ["longCall", "Long call", "+1 call K", "Flat loss below K; rising upside above K", "Premium paid for convex upside"],
  ["bullSpread", "Bull call spread", "+1 lower call; −1 higher call", "Limited loss, rising middle, capped gain", "Lower premium in exchange for capped upside"],
  ["bearSpread", "Bear put spread", "+1 higher put; −1 lower put", "Capped gain below; limited loss above", "Cheaper protection with the deepest tail sold"],
  ["straddle", "Straddle", "+1 put K; +1 call K", "V-shaped around one strike", "Two premiums; needs a large move either way"],
  ["strangle", "Strangle", "+1 lower put; +1 higher call", "Flat loss between strikes; gains in both tails", "Cheaper than straddle; wider move required"],
  ["butterfly", "Call butterfly", "+1 low call; −2 middle; +1 high call", "Peak at middle strike; limited wings", "Precise expiry view with limited gain and loss"],
  ["ironCondor", "Iron condor", "+1 low put; −1 put; −1 call; +1 high call", "Credit plateau between short strikes; capped tails", "Time decay and range view; losses if either wing is crossed"],
  ["riskReversal", "Risk reversal", "−1 lower put; +1 higher call", "Downside obligation funds upside", "Directional exposure; short-put tail risk"],
  ["seagull", "Seagull", "−1 put; +1 low call; −1 high call", "Downside obligation; rising then capped upside", "Extra funding in exchange for two sold regions"],
  ["barrierWings", "Barrier wings", "+1 down-in put; +1 up-in call", "Tail payoff only after the relevant touch", "Lower illustrative premium; path dependence"]
];

export const rules: RuleRow[] = [
  ["Contract identity", "Do all legs share the same underlying, currency, multiplier and expiry?", "A payoff recipe does not prevent mismatched contracts."],
  ["Side and ratio", "Is each leg bought or sold, and in what signed quantity?", "A butterfly needs a 1:−2:1 ratio, not merely three strikes."],
  ["Exercise style", "European, American or Bermudan—and can short legs be assigned early?", "One early assignment can dismantle the intended combined exposure."],
  ["Strike ordering", "Are lower, body and upper strikes strictly ordered and equally spaced where required?", "Changing wing widths creates a broken-wing payoff rather than a symmetric butterfly."],
  ["Premium convention", "Market price, model value or agreed premium; per unit or per contract; which currency?", "Break-even and P/L depend on initial cash, not payoff alone."],
  ["Barrier direction", "Down or up; knock-in or knock-out; inclusive or strict touch?", "The same path can activate one contract and extinguish another."],
  ["Barrier monitoring", "Continuous or discrete; which timestamps, source, calendar and disruption fallback?", "A path between observations may or may not count as a touch."],
  ["Barrier extras", "Is there a rebate, delayed activation, window, double barrier or reset?", "The four labels in this lab cover only the simplest barrier state."],
  ["Settlement", "Cash or physical; automatic exercise threshold; rounding and payment timing?", "Legs can create different funding or delivery obligations at expiry."],
  ["Lifecycle handling", "Can legs be closed, exercised or assigned separately?", "The displayed terminal package may not survive intact until expiry."],
  ["Risk aggregation", "Are Greeks, margin and stress calculated per leg and for the net strategy?", "Net delta can hide gross gamma, vega, gap or assignment exposure."]
];

export function defaultState(): StrategyState {
  return {
    presetId: "butterfly",
    spot: 100,
    volatility: 0.25,
    tenor: 1,
    rate: 0.03,
    dividend: 0.01,
    observedLow: 88,
    observedHigh: 114,
    terminal: 100,
    legs: []
  };
}

export function clonePreset(preset: StrategyPreset, spot: number): StrategyPreset {
  const scale = spot / 100;
  const legs = preset.legs.map(item => ({
    ...item,
    strike: item.strike * scale,
    barrier: item.barrier ? item.barrier * scale : 0
  }));
  while (legs.length < MAX_LEGS) {
    legs.push({
      id: legs.length + 1,
      enabled: false,
      side: "long",
      quantity: 1,
      type: "call",
      strike: spot,
      barrierType: "none",
      barrier: spot * 1.2
    });
  }
  return { ...preset, legs };
}

export function isPresetId(id: string): id is keyof typeof presets {
  return id in presets;
}
