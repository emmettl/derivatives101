import { clonePreset, defaultState, isPresetId, presets } from "./config";
import { metrics, riskMeasures, scenarioMatrix } from "./engine";
import { createMarketControls, render as renderView } from "./view";
import type { Market, MarketControl, OptionLeg } from "./types";

const spotMoves = [-0.2, -0.1, 0, 0.1, 0.2];
const volatilityMoves = [-0.05, 0, 0.05];
let state = defaultState();
let framePending = false;

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
  state.presetId = "custom";
  scheduleRender();
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
  if (field === "barrierType" && item.barrierType.startsWith("down") && item.barrier >= state.spot)
    item.barrier = state.spot * 0.75;
  if (field === "barrierType" && item.barrierType.startsWith("up") && item.barrier <= state.spot)
    item.barrier = state.spot * 1.25;
  state.presetId = "custom";
  render();
}

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
  applyPreset(state.presetId);
});
createMarketControls(state, updateMarket);
applyPreset(state.presetId);
