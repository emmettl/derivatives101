export type Side = "long" | "short";
export type OptionType = "call" | "put";
export type BarrierType = "none" | "down-in" | "down-out" | "up-in" | "up-out";

export interface OptionLeg {
  id: number;
  enabled: boolean;
  side: Side;
  quantity: number;
  type: OptionType;
  strike: number;
  barrierType: BarrierType;
  barrier: number;
}

export interface StrategyPreset {
  id: string;
  name: string;
  description: string;
  legs: OptionLeg[];
}

export interface Market {
  spot: number;
  volatility: number;
  tenor: number;
  rate: number;
  dividend: number;
}

export interface StrategyState extends Market {
  presetId: string;
  observedLow: number;
  observedHigh: number;
  terminal: number;
  legs: OptionLeg[];
}

export interface PricingResult {
  premium: number;
  vanilla: number;
  weight: number;
  hitProbability: number;
}

export interface LegOutcome {
  payoff: number;
  pnl: number;
  signedQuantity: number;
  premium: number;
  hit: boolean;
  active: boolean;
  pricing: PricingResult | null;
}

export interface StrategyOutcome {
  terminalSpot: number;
  legs: LegOutcome[];
  pnl: number;
  payoff: number;
  netPremium: number;
}

export interface StrategyMetrics {
  curve: StrategyOutcome[];
  selected: StrategyOutcome;
  breakEvens: number[];
  minimumPnl: number;
  maximumPnl: number;
  netPremium: number;
}

export interface RiskMeasures {
  value: number;
  delta: number;
  gamma: number;
  vega: number;
  theta30: number;
}

export interface ScenarioCell {
  volatilityMove: number;
  volatility: number;
  value: number;
  pnl: number;
}

export interface ScenarioRow {
  spotMove: number;
  spot: number;
  cells: ScenarioCell[];
}

export interface MarketControl {
  key: keyof Pick<StrategyState, "spot" | "volatility" | "tenor" | "rate" | "dividend" | "observedLow" | "observedHigh" | "terminal">;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

export type CatalogueRow = readonly [presetId: string, name: string, recipe: string, shape: string, tradeOff: string];
export type RuleRow = readonly [decision: string, question: string, reason: string];

export interface ViewHandlers {
  onPreset: (id: string) => void;
  onLegChange: (index: number, field: keyof OptionLeg, value: OptionLeg[keyof OptionLeg]) => void;
}
