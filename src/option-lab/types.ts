export type OptionType = "call" | "put";
export type Greek = "delta" | "gamma" | "vega" | "theta" | "rho";

export interface OptionParams {
  S: number;
  K: number;
  T: number;
  r: number;
  q: number;
  v: number;
}

export interface OptionMetrics {
  price: number;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho: number;
  intrinsic: number;
}

export interface SimulationRequest {
  id: number;
  sample: number;
  p: OptionParams;
  type: OptionType;
  seed: number;
  paths?: number;
  drawN?: number;
  steps?: number;
}

export interface SimulationResult {
  id: number;
  sample: number;
  samples: Float64Array[];
  ends: Float64Array;
  estimate: number;
  steps: number;
  p: OptionParams;
  type: OptionType;
}
