import type { OptionMetrics, OptionParams, OptionType } from "./types";

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function normCdf(x: number): number {
  const coefficients = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const sign = x < 0 ? -1 : 1;
  const absolute = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * absolute);
  let polynomial = 0, power = t;
  coefficients.forEach(coefficient => {
    polynomial += coefficient * power;
    power *= t;
  });
  const value = 1 - normPdf(absolute) * polynomial;
  return sign > 0 ? value : 1 - value;
}

export function optionMetrics({ S, K, T, r, q, v }: OptionParams, type: OptionType): OptionMetrics {
  const discountRate = Math.exp(-r * T);
  const discountDividend = Math.exp(-q * T);
  const intrinsic = type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  if (T <= 0 || v <= 0 || S <= 0 || K <= 0) {
    return {
      price: intrinsic,
      delta: type === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      intrinsic
    };
  }
  const root = Math.sqrt(T);
  const volatilityTime = v * root;
  const d1 = (Math.log(S / K) + (r - q + 0.5 * v * v) * T) / volatilityTime;
  const d2 = d1 - volatilityTime;
  const density = normPdf(d1);
  let price: number, delta: number, theta: number, rho: number;
  if (type === "call") {
    price = S * discountDividend * normCdf(d1) - K * discountRate * normCdf(d2);
    delta = discountDividend * normCdf(d1);
    theta = -(S * discountDividend * density * v) / (2 * root) - r * K * discountRate * normCdf(d2) + q * S * discountDividend * normCdf(d1);
    rho = K * T * discountRate * normCdf(d2);
  } else {
    price = K * discountRate * normCdf(-d2) - S * discountDividend * normCdf(-d1);
    delta = -discountDividend * normCdf(-d1);
    theta = -(S * discountDividend * density * v) / (2 * root) + r * K * discountRate * normCdf(-d2) - q * S * discountDividend * normCdf(-d1);
    rho = -K * T * discountRate * normCdf(-d2);
  }
  return {
    price,
    delta,
    gamma: discountDividend * density / (S * volatilityTime),
    vega: S * discountDividend * density * root,
    theta,
    rho,
    intrinsic
  };
}

export function metricValue(metrics: OptionMetrics, greek: keyof Pick<OptionMetrics, "delta" | "gamma" | "vega" | "theta" | "rho">): number {
  if (greek === "vega" || greek === "rho") return metrics[greek] / 100;
  if (greek === "theta") return metrics.theta / 365;
  return metrics[greek];
}
