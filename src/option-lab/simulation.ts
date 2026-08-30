import type { SimulationRequest, SimulationResult } from "./types";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function normal(random: () => number): number {
  let u = 0, v = 0;
  while (!u) u = random();
  while (!v) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulatePaths(request: SimulationRequest): SimulationResult {
  const { id, sample, p, type, seed, paths = 4000, drawN = 64, steps = 80 } = request;
  const random = seeded(seed);
  const timeStep = p.T / steps;
  const drift = (p.r - p.q - 0.5 * p.v * p.v) * timeStep;
  const shock = p.v * Math.sqrt(timeStep);
  const samples: Float64Array[] = [];
  const ends = new Float64Array(paths);
  let payoffSum = 0;
  for (let pathIndex = 0; pathIndex < paths; pathIndex += 1) {
    let spot = p.S;
    const path = pathIndex < drawN ? new Float64Array(steps + 1) : null;
    if (path) path[0] = spot;
    for (let step = 1; step <= steps; step += 1) {
      spot *= Math.exp(drift + shock * normal(random));
      if (path) path[step] = spot;
    }
    payoffSum += type === "call" ? Math.max(spot - p.K, 0) : Math.max(p.K - spot, 0);
    ends[pathIndex] = spot;
    if (path) samples.push(path);
  }
  return { id, sample, samples, ends, estimate: Math.exp(-p.r * p.T) * payoffSum / paths, steps, p, type };
}
