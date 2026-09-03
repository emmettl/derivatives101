import { strategyOutcome } from "./engine";
import type { StrategyMetrics, StrategyOutcome, StrategyState } from "./types";
import { applyChartSize, responsiveChartSize } from "../shared/chart-size";

const baseDimensions = { width: 900, height: 440, left: 68, right: 25, top: 28, bottom: 55 };
let dimensions = { ...baseDimensions };

interface InteractionContext {
  state: StrategyState;
  metrics: StrategyMetrics;
  x: (value: number) => number;
  y: (value: number) => number;
}

let interaction: InteractionContext | null = null;
let dragging = false;

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing strategy lab element #${id}`);
  return element as unknown as T;
}

function esc(value: string): string {
  return value.replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character,
  );
}

function signed(value: number): string {
  if (Math.abs(value) < 0.005) return "0.00";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
}

function marketFrom(state: StrategyState) {
  return {
    spot: state.spot,
    volatility: state.volatility,
    tenor: state.tenor,
    rate: state.rate,
    dividend: state.dividend,
  };
}

function hideInspector(): void {
  byId<SVGGElement>("strategy-chart-inspector").classList.add("hidden");
  byId<HTMLElement>("strategy-chart-tooltip").hidden = true;
}

function inspect(terminalSpot: number): void {
  if (!interaction) return;
  const { state, metrics, x, y } = interaction;
  const minimum = metrics.curve[0].terminalSpot;
  const maximum = metrics.curve.at(-1)!.terminalSpot;
  const terminal = Math.max(minimum, Math.min(maximum, terminalSpot));
  const outcome = strategyOutcome(
    marketFrom(state),
    state.legs,
    terminal,
    state.observedLow,
    state.observedHigh,
  );
  const group = byId<SVGGElement>("strategy-chart-inspector");
  group.classList.remove("hidden");
  const line = group.querySelector<SVGLineElement>("line")!;
  line.setAttribute("x1", String(x(terminal)));
  line.setAttribute("x2", String(x(terminal)));
  const total = group.querySelector<SVGCircleElement>('[data-point="total"]')!;
  total.setAttribute("cx", String(x(terminal)));
  total.setAttribute("cy", String(y(outcome.pnl)));
  state.legs.forEach((leg, index) => {
    const point = group.querySelector<SVGCircleElement>(`[data-point="leg-${index}"]`)!;
    point.classList.toggle("hidden", !leg.enabled);
    if (!leg.enabled) return;
    point.setAttribute("cx", String(x(terminal)));
    point.setAttribute("cy", String(y(outcome.legs[index].pnl)));
  });
  const tooltip = byId<HTMLElement>("strategy-chart-tooltip");
  tooltip.hidden = false;
  const position =
    ((x(terminal) - dimensions.left) / (dimensions.width - dimensions.left - dimensions.right)) *
    100;
  tooltip.style.left = `${Math.max(5, Math.min(78, position))}%`;
  tooltip.innerHTML = `<strong>Expiry ${terminal.toFixed(1)}</strong><span class="total">Combined <b>${signed(outcome.pnl)}</b></span>${state.legs
    .map((leg, index) =>
      leg.enabled
        ? `<span class="leg-${index}">Leg ${index + 1} · ${esc(leg.side)} ${esc(leg.type)} <b>${signed(outcome.legs[index].pnl)}</b></span>`
        : "",
    )
    .join("")}`;
}

function terminalFromPointer(event: PointerEvent): number {
  const svg = byId<SVGElement>("strategy-chart");
  const rect = svg.getBoundingClientRect();
  const userX = ((event.clientX - rect.left) / rect.width) * dimensions.width;
  const points = interaction!.metrics.curve;
  const proportion =
    (userX - dimensions.left) / (dimensions.width - dimensions.left - dimensions.right);
  return (
    points[0].terminalSpot +
    Math.max(0, Math.min(1, proportion)) * (points.at(-1)!.terminalSpot - points[0].terminalSpot)
  );
}

export function createChartInteractions(onSelect: (terminalSpot: number) => void): void {
  const svg = byId<SVGElement>("strategy-chart");
  const select = (value: number) => {
    const rounded = Math.round(value);
    inspect(rounded);
    onSelect(rounded);
  };
  svg.addEventListener("pointerdown", (event) => {
    dragging = true;
    svg.setPointerCapture(event.pointerId);
    select(terminalFromPointer(event));
  });
  svg.addEventListener("pointermove", (event) => {
    const terminal = terminalFromPointer(event);
    if (dragging) select(terminal);
    else inspect(terminal);
  });
  svg.addEventListener("pointerup", (event) => {
    dragging = false;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  });
  svg.addEventListener("pointercancel", () => {
    dragging = false;
    hideInspector();
  });
  svg.addEventListener("pointerleave", () => {
    if (!dragging && document.activeElement !== svg) hideInspector();
  });
  svg.addEventListener("focus", () => interaction && inspect(interaction.state.terminal));
  svg.addEventListener("blur", hideInspector);
  svg.addEventListener("keydown", (event) => {
    if (!interaction) return;
    const points = interaction.metrics.curve;
    const minimum = points[0].terminalSpot;
    const maximum = points.at(-1)!.terminalSpot;
    let next = interaction.state.terminal;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 1;
    else if (event.key === "PageDown") next -= 5;
    else if (event.key === "PageUp") next += 5;
    else if (event.key === "Home") next = minimum;
    else if (event.key === "End") next = maximum;
    else return;
    event.preventDefault();
    select(Math.max(minimum, Math.min(maximum, next)));
  });
}

export function drawChart(
  state: StrategyState,
  metrics: StrategyMetrics,
  title: string,
  hiddenLegs: ReadonlySet<number> = new Set(),
): void {
  const svg = byId<SVGSVGElement>("strategy-chart");
  const size = responsiveChartSize(svg, baseDimensions, 0.68);
  applyChartSize(svg, size);
  dimensions = {
    ...baseDimensions,
    width: size.width,
    height: size.height,
    left: size.width < 600 ? 50 : baseDimensions.left,
  };
  const { width, height, left, right, top, bottom } = dimensions;
  const points = metrics.curve;
  const allValues = points.flatMap((point) => [
    point.pnl,
    ...point.legs.map((result) => result.pnl),
  ]);
  let yMin = Math.min(...allValues, 0),
    yMax = Math.max(...allValues, 0);
  const padding = Math.max(4, (yMax - yMin) * 0.12);
  yMin -= padding;
  yMax += padding;
  const x = (value: number) =>
    left +
    ((value - points[0].terminalSpot) / (points.at(-1)!.terminalSpot - points[0].terminalSpot)) *
      (width - left - right);
  const y = (value: number) => top + ((yMax - value) / (yMax - yMin)) * (height - top - bottom);
  interaction = { state, metrics, x, y };
  const path = (accessor: (point: StrategyOutcome) => number) =>
    points
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${x(point.terminalSpot).toFixed(2)},${y(accessor(point)).toFixed(2)}`,
      )
      .join(" ");
  const xTicks = [40, 60, 80, 100, 120, 140, 160].map((percent) => (state.spot * percent) / 100);
  const yTicks = Array.from({ length: 6 }, (_, index) => yMin + ((yMax - yMin) * index) / 5);

  svg.setAttribute("aria-valuemin", points[0].terminalSpot.toFixed(0));
  svg.setAttribute("aria-valuemax", points.at(-1)!.terminalSpot.toFixed(0));
  svg.setAttribute("aria-valuenow", state.terminal.toFixed(0));
  svg.setAttribute(
    "aria-valuetext",
    `Expiry ${state.terminal.toFixed(0)}, strategy profit or loss ${metrics.selected.pnl.toFixed(2)}`,
  );
  svg.innerHTML = `<title>${esc(title)} expiry profit or loss</title><desc>Inspect across terminal levels with a pointer. Click or drag to set the selected expiry. The thick line is the combined strategy after premium; thin lines are active option legs.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 19}" text-anchor="middle">${tick.toFixed(0)}</text>`).join("")}<line class="strategy-zero" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"></line><line class="strategy-spot" x1="${x(state.spot)}" x2="${x(state.spot)}" y1="${top}" y2="${height - bottom}"></line>${state.legs.map((item, index) => (item.enabled ? `<path class="strategy-leg strategy-leg-${index}${hiddenLegs.has(index) ? " hidden" : ""}" d="${path((point) => point.legs[index].pnl)}"></path>` : "")).join("")}<path class="strategy-total" d="${path((point) => point.pnl)}"></path>${metrics.breakEvens.map((value) => `<circle class="strategy-breakeven" cx="${x(value)}" cy="${y(0)}" r="4"><title>Break-even ${value.toFixed(1)}</title></circle>`).join("")}<line class="strategy-selected" x1="${x(state.terminal)}" x2="${x(state.terminal)}" y1="${top}" y2="${height - bottom}"></line><circle class="strategy-selected-point" cx="${x(state.terminal)}" cy="${y(metrics.selected.pnl)}" r="6"></circle><g id="strategy-chart-inspector" class="strategy-inspector hidden"><line x1="0" x2="0" y1="${top}" y2="${height - bottom}"></line><circle data-point="total" r="6"></circle>${state.legs.map((_item, index) => `<circle data-point="leg-${index}" class="leg-${index}" r="4"></circle>`).join("")}</g><text class="axis strategy-axis-title" x="${(left + width - right) / 2}" y="${height - 9}" text-anchor="middle">Underlying at expiry</text><text class="axis strategy-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Profit / loss after premium</text>`;
  if (document.activeElement === svg) inspect(state.terminal);
  else hideInspector();
}
