import type { StrategyMetrics, StrategyState } from "./types";

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing strategy lab element #${id}`);
  return element as unknown as T;
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character] ?? character);
}

export function drawChart(state: StrategyState, metrics: StrategyMetrics, title: string): void {
  const svg = byId<SVGElement>("strategy-chart");
  const width = 900, height = 440, left = 68, right = 25, top = 28, bottom = 55;
  const points = metrics.curve;
  const allValues = points.flatMap(point => [point.pnl, ...point.legs.map(result => result.pnl)]);
  let yMin = Math.min(...allValues, 0), yMax = Math.max(...allValues, 0);
  const padding = Math.max(4, (yMax - yMin) * 0.12);
  yMin -= padding;
  yMax += padding;
  const x = (value: number) => left + (value - points[0].terminalSpot) / (points.at(-1)!.terminalSpot - points[0].terminalSpot) * (width - left - right);
  const y = (value: number) => top + (yMax - value) / (yMax - yMin) * (height - top - bottom);
  const path = (accessor: (point: StrategyMetrics["curve"][number]) => number) => points.map((point, index) => `${index ? "L" : "M"}${x(point.terminalSpot).toFixed(2)},${y(accessor(point)).toFixed(2)}`).join(" ");
  const xTicks = [40, 60, 80, 100, 120, 140, 160].map(percent => state.spot * percent / 100);
  const yTicks = Array.from({ length: 6 }, (_, index) => yMin + (yMax - yMin) * index / 5);

  svg.innerHTML = `<title>${esc(title)} expiry profit or loss</title><desc>The thick line is the combined strategy after premium. Thin lines show the profit or loss contribution from each active option leg.</desc>${yTicks.map(tick => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${xTicks.map(tick => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 19}" text-anchor="middle">${tick.toFixed(0)}</text>`).join("")}<line class="strategy-zero" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"></line><line class="strategy-spot" x1="${x(state.spot)}" x2="${x(state.spot)}" y1="${top}" y2="${height - bottom}"></line>${state.legs.map((item, index) => item.enabled ? `<path class="strategy-leg strategy-leg-${index}" d="${path(point => point.legs[index].pnl)}"></path>` : "").join("")}<path class="strategy-total" d="${path(point => point.pnl)}"></path>${metrics.breakEvens.map(value => `<circle class="strategy-breakeven" cx="${x(value)}" cy="${y(0)}" r="4"></circle>`).join("")}<line class="strategy-selected" x1="${x(state.terminal)}" x2="${x(state.terminal)}" y1="${top}" y2="${height - bottom}"></line><circle class="strategy-selected-point" cx="${x(state.terminal)}" cy="${y(metrics.selected.pnl)}" r="6"></circle><text class="axis strategy-axis-title" x="${(left + width - right) / 2}" y="${height - 9}" text-anchor="middle">Underlying at expiry</text><text class="axis strategy-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Profit / loss after premium</text>`;
}
