import { clonePreset, defaultState, isPresetId, presets } from "./config";
import { createChartInteractions } from "./chart";
import { metrics, riskMeasures, scenarioMatrix } from "./engine";
import { simulateStrategy } from "./simulation";
import { drawSimulationChart } from "./simulation-chart";
import { createMarketControls, render as renderView } from "./view";
import { onResize } from "../shared/chart-size";
import { initCollapsibleSections } from "../shared/collapsible";
import type {
  Market,
  MarketControl,
  OptionLeg,
  StrategySimulationRequest,
  StrategySimulationResult,
} from "./types";

const spotMoves = [-0.2, -0.1, 0, 0.1, 0.2];
const volatilityMoves = [-0.05, 0, 0.05];
let state = defaultState();
let framePending = false;
let simulationTimer: ReturnType<typeof setTimeout> | undefined;
let simulationVersion = 0;
let simulationSample = 1;
let simulationSeed = 481516;
let lastSimulation: StrategySimulationResult | null = null;
const simulationWorker =
  typeof Worker !== "undefined"
    ? new Worker(new URL("./simulation-worker.ts", import.meta.url), { type: "module" })
    : null;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing strategy lab element #${id}`);
  return element as T;
}

function market(): Market {
  return {
    spot: state.spot,
    volatility: state.volatility,
    tenor: state.tenor,
    rate: state.rate,
    dividend: state.dividend,
  };
}

function applyPreset(id: string): void {
  if (!isPresetId(id)) throw new Error(`Unknown strategy preset: ${id}`);
  state.presetId = id;
  state.legs = clonePreset(presets[id], state.spot).legs;
  render();
  scheduleSimulation(0);
}

function updateMarket(key: MarketControl["key"], value: number): void {
  const previousSpot = state.spot;
  state[key] = value;
  if (key === "spot" && previousSpot !== state.spot) {
    const scale = state.spot / previousSpot;
    state.legs.forEach((item) => {
      item.strike *= scale;
      if (item.barrier) item.barrier *= scale;
    });
    state.observedLow *= scale;
    state.observedHigh *= scale;
    state.terminal *= scale;
  }
  scheduleRender();
  if (key !== "terminal") scheduleSimulation();
}

function updateLeg(index: number, field: keyof OptionLeg, value: OptionLeg[keyof OptionLeg]): void {
  const item = state.legs[index];
  if (!item) throw new Error(`Unknown strategy leg: ${index}`);
  switch (field) {
    case "id":
      item.id = Number(value);
      break;
    case "enabled":
      item.enabled = Boolean(value);
      break;
    case "side":
      item.side = value as OptionLeg["side"];
      break;
    case "quantity":
      item.quantity = Number(value);
      break;
    case "type":
      item.type = value as OptionLeg["type"];
      break;
    case "strike":
      item.strike = Number(value);
      break;
    case "barrierType":
      item.barrierType = value as OptionLeg["barrierType"];
      break;
    case "barrier":
      item.barrier = Number(value);
      break;
  }
  if (
    field === "barrierType" &&
    item.barrierType.startsWith("down") &&
    (item.barrier <= 0 || item.barrier >= state.spot)
  )
    item.barrier = state.spot * 0.75;
  if (field === "barrierType" && item.barrierType.startsWith("up") && item.barrier <= state.spot)
    item.barrier = state.spot * 1.25;
  state.presetId = "custom";
  render();
  scheduleSimulation();
}

function setSimulationStatus(message: string, busy = false): void {
  const status = byId<HTMLElement>("strategy-simulation-status");
  status.textContent = message;
  status.classList.toggle("busy", busy);
}

function finishSimulation(result: StrategySimulationResult): void {
  if (result.id !== simulationVersion) return;
  lastSimulation = result;
  drawSimulationChart(result);
  const difference = result.estimate - result.currentValue;
  byId("strategy-simulation-stats").innerHTML =
    `<div><span>Probability of profit</span><strong>${(result.probabilityOfProfit * 100).toFixed(1)}%</strong><p>Expiry P/L above zero</p></div><div><span>Median expiry P/L</span><strong>${result.medianPnl.toFixed(2)}</strong><p>Half the paths finish above</p></div><div><span>Middle 90% of P/L</span><strong>${result.percentile05.toFixed(1)} to ${result.percentile95.toFixed(1)}</strong><p>5th–95th percentiles</p></div><div><span>MC package value</span><strong>${result.estimate.toFixed(2)}</strong><p>${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(2)} vs current mark</p></div>`;
  const hasBarriers = state.legs.some((item) => item.enabled && item.barrierType !== "none");
  byId("strategy-simulation-note").textContent = hasBarriers
    ? `8,000 shared risk-neutral paths use ${result.steps} monitoring steps and carry the selected observed low/high into every future path. The ${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(2)} gap versus the current mark also reflects that the page's fast barrier premium is only a probability-weighted vanilla approximation.`
    : `For this vanilla package, Monte Carlo is a distribution view rather than a better pricer: the current mark remains the exact signed sum of Black–Scholes values. The sampling gap is ${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(2)} across 8,000 paths.`;
  setSimulationStatus(`Sample ${result.sample} · current`);
}

function startSimulation(id: number): void {
  if (id !== simulationVersion) return;
  const request: StrategySimulationRequest = {
    id,
    sample: simulationSample,
    market: market(),
    legs: state.legs,
    observedLow: state.observedLow,
    observedHigh: state.observedHigh,
    seed: simulationSeed,
    paths: 8000,
    drawN: 48,
    steps: Math.max(40, Math.round(126 * state.tenor)),
  };
  setSimulationStatus(`Sample ${simulationSample} · calculating…`, true);
  if (simulationWorker) simulationWorker.postMessage(request);
  else setTimeout(() => finishSimulation(simulateStrategy(request)), 0);
}

function scheduleSimulation(delay = 180): void {
  const id = ++simulationVersion;
  clearTimeout(simulationTimer);
  setSimulationStatus(`Sample ${simulationSample} · ${delay ? "waiting…" : "calculating…"}`, true);
  simulationTimer = setTimeout(() => startSimulation(id), delay);
}

if (simulationWorker)
  simulationWorker.onmessage = (event: MessageEvent<StrategySimulationResult>) =>
    finishSimulation(event.data);

function scheduleRender(): void {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    render();
  });
}

function render(): void {
  const currentMarket = market();
  const currentMetrics = metrics(
    currentMarket,
    state.legs,
    state.observedLow,
    state.observedHigh,
    state.terminal,
  );
  const risk = riskMeasures(currentMarket, state.legs);
  const scenarios = scenarioMatrix(currentMarket, state.legs, spotMoves, volatilityMoves);
  renderView(state, currentMetrics, risk, scenarios, {
    onPreset: applyPreset,
    onLegChange: updateLeg,
  });
}

byId<HTMLButtonElement>("strategy-reset").addEventListener("click", () => {
  state = defaultState();
  simulationSample = 1;
  simulationSeed = 481516;
  applyPreset(state.presetId);
});
byId<HTMLButtonElement>("strategy-resample").addEventListener("click", () => {
  const freshSeed = new Uint32Array(1);
  crypto.getRandomValues(freshSeed);
  simulationSeed = freshSeed[0] || (simulationSeed * 1664525 + 1013904223) >>> 0 || 1;
  simulationSample += 1;
  scheduleSimulation(0);
});
function redrawCharts(): void {
  render();
  if (lastSimulation) drawSimulationChart(lastSimulation);
}

createMarketControls(state, updateMarket);
createChartInteractions((terminalSpot) => {
  if (terminalSpot === state.terminal) return;
  state.terminal = terminalSpot;
  scheduleRender();
});
initCollapsibleSections("(max-width: 1100px)");
onResize(redrawCharts);
document.addEventListener("collapsible-toggle", (event) => {
  if (!(event as CustomEvent<{ collapsed: boolean }>).detail.collapsed) redrawCharts();
});
if (window.matchMedia("(hover: none)").matches)
  byId("chart-instruction").textContent = "Tap to inspect · drag to set expiry";
applyPreset(state.presetId);
