import type { StrategySimulationResult } from "./types";
import { applyChartSize, responsiveChartSize } from "../shared/chart-size";
import { attachVerticalInspector } from "../shared/svg-interaction";

const baseSize = { width: 900, height: 390 };

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing strategy lab element #${id}`);
  return element as unknown as T;
}

interface SimulationChartContext {
  width: number;
  height: number;
  pnlLow: number;
  pnlHigh: number;
  bins: number;
  counts: number[];
  maxCount: number;
  histogramLeft: number;
  histogramRight: number;
  top: number;
  bottom: number;
  total: number;
}

let simulationChartContext: SimulationChartContext | null = null;
let selectedSimulationPnl: number | null = null;

function simulationBinIndex(context: SimulationChartContext, value: number): number {
  const binWidth = (context.pnlHigh - context.pnlLow) / context.bins;
  return Math.max(
    0,
    Math.min(context.bins - 1, Math.round((value - context.pnlLow) / binWidth - 0.5)),
  );
}

function highlightSimulationBin(index: number | null): void {
  byId<SVGSVGElement>("strategy-simulation-chart")
    .querySelectorAll<SVGRectElement>(".simulation-bin")
    .forEach((bar) => bar.classList.toggle("selected", Number(bar.dataset.bin) === index));
}

const simulationInspector = attachVerticalInspector(
  byId<SVGSVGElement>("strategy-simulation-chart"),
  () => {
    const context = simulationChartContext;
    if (!context) return null;
    const binWidth = (context.pnlHigh - context.pnlLow) / context.bins;
    const minimum = context.pnlLow + binWidth / 2;
    const maximum = context.pnlHigh - binWidth / 2;
    const selected = Math.max(minimum, Math.min(maximum, selectedSimulationPnl ?? 0));
    return {
      width: context.width,
      height: context.height,
      left: context.histogramLeft,
      right: context.width - context.histogramRight,
      top: context.top,
      bottom: context.bottom,
      minimum,
      maximum,
      plotMinimum: context.pnlLow,
      plotMaximum: context.pnlHigh,
      step: binWidth,
      value: selected,
      label: "Terminal strategy profit and loss distribution",
      inspect(value) {
        const index = simulationBinIndex(context, value);
        const count = context.counts[index];
        const lower = context.pnlLow + index * binWidth;
        const upper = lower + binWidth;
        const midpoint = lower + binWidth / 2;
        return {
          title: `Expiry P/L ${midpoint.toFixed(2)}`,
          rows: [
            { label: "Range", value: `${lower.toFixed(2)} to ${upper.toFixed(2)}` },
            { label: "Paths", value: count.toLocaleString() },
            { label: "Share", value: `${((100 * count) / context.total).toFixed(1)}%` },
          ],
          points: [
            {
              x:
                context.histogramLeft +
                (count / context.maxCount) * (context.histogramRight - context.histogramLeft),
              color: midpoint >= 0 ? "#3e8e7e" : "#b5443a",
            },
          ],
        };
      },
      onSelect(value) {
        selectedSimulationPnl = value;
        highlightSimulationBin(simulationBinIndex(context, value));
      },
      onInspect(value) {
        highlightSimulationBin(simulationBinIndex(context, value));
      },
      onHide() {
        highlightSimulationBin(
          selectedSimulationPnl == null ? null : simulationBinIndex(context, selectedSimulationPnl),
        );
      },
    };
  },
);

export function drawSimulationChart(result: StrategySimulationResult): void {
  const svg = byId<SVGSVGElement>("strategy-simulation-chart");
  // Wide layouts place the histogram beside the paths; narrow layouts stack it underneath.
  const { width } = responsiveChartSize(svg, baseSize, 1);
  const stacked = width < 600;
  const margin = { left: 58, right: 22, top: 38, bottom: 42 };
  const split = Math.round(width * 0.7);
  const pathRight = stacked ? width - margin.right : split - 24;
  const pathBottom = stacked ? margin.top + 200 : baseSize.height - margin.bottom;
  const histogramLeft = stacked ? margin.left : split + 22;
  const histogramRight = width - margin.right;
  const histogramTop = stacked ? pathBottom + 60 : margin.top;
  const histogramBottom = stacked ? histogramTop + 190 : baseSize.height - margin.bottom;
  const height = histogramBottom + margin.bottom;
  applyChartSize(svg, { width, height });
  const pathValues = result.paths.flatMap((path) => Array.from(path));
  const rawLow = Math.min(result.market.spot, ...pathValues);
  const rawHigh = Math.max(result.market.spot, ...pathValues);
  const spotPadding = Math.max(1, (rawHigh - rawLow) * 0.08);
  const spotLow = Math.max(0, rawLow - spotPadding);
  const spotHigh = rawHigh + spotPadding;
  const x = (step: number) => margin.left + (step / result.steps) * (pathRight - margin.left);
  const y = (spot: number) =>
    margin.top + ((spotHigh - spot) / (spotHigh - spotLow)) * (pathBottom - margin.top);
  const spotTicks = Array.from(
    { length: 5 },
    (_, index) => spotLow + ((spotHigh - spotLow) * index) / 4,
  );
  const timeTicks = Array.from({ length: 5 }, (_, index) => index / 4);

  const bins = 28;
  let pnlLow = Math.min(...result.terminalPnls, 0);
  let pnlHigh = Math.max(...result.terminalPnls, 0);
  if (pnlHigh - pnlLow < 0.01) {
    pnlLow -= 1;
    pnlHigh += 1;
  }
  const counts = Array.from({ length: bins }, () => 0);
  result.terminalPnls.forEach((value) => {
    const position = (value - pnlLow) / (pnlHigh - pnlLow);
    counts[Math.min(bins - 1, Math.max(0, Math.floor(position * bins)))] += 1;
  });
  const maxCount = Math.max(1, ...counts);
  const histogramHeight = histogramBottom - histogramTop;
  const barHeight = histogramHeight / bins;
  const pnlY = (value: number) =>
    histogramTop + ((pnlHigh - value) / (pnlHigh - pnlLow)) * histogramHeight;

  svg.setAttribute(
    "aria-label",
    `${result.paths.length} visible shared underlying paths and a terminal strategy profit and loss distribution from ${result.terminalPnls.length.toLocaleString()} simulations`,
  );
  svg.innerHTML = `<title>Shared-path Monte Carlo simulation</title><desc>Every visible path drives all active option legs together. The histogram shows the resulting complete-strategy profit and loss at expiry.</desc><text class="simulation-label" x="${margin.left}" y="19">SHARED UNDERLYING PATHS</text><text class="simulation-label" x="${histogramLeft}" y="${histogramTop - 19}">STRATEGY P/L AT EXPIRY</text>${spotTicks.map((tick) => `<line class="grid" x1="${margin.left}" x2="${pathRight}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${margin.left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${timeTicks.map((tick) => `<line class="grid" x1="${x(tick * result.steps)}" x2="${x(tick * result.steps)}" y1="${margin.top}" y2="${pathBottom}"></line><text class="axis" x="${x(tick * result.steps)}" y="${pathBottom + 25}" text-anchor="middle">${tick === 0 ? "Today" : tick === 1 ? "Expiry" : `${Math.round(tick * 100)}%`}</text>`).join("")}<line class="simulation-start" x1="${margin.left}" x2="${pathRight}" y1="${y(result.market.spot)}" y2="${y(result.market.spot)}"></line>${result.paths
    .map(
      (path, index) =>
        `<path class="simulation-path ${result.pathPnls[index] >= 0 ? "positive" : "negative"}" d="${Array.from(
          path,
        )
          .map((spot, step) => `${step ? "L" : "M"}${x(step).toFixed(2)},${y(spot).toFixed(2)}`)
          .join(
            " ",
          )}"><title>Terminal spot ${path.at(-1)?.toFixed(2)} · strategy P/L ${result.pathPnls[index].toFixed(2)}</title></path>`,
    )
    .join("")}${counts
    .map((count, index) => {
      const center = pnlLow + ((index + 0.5) / bins) * (pnlHigh - pnlLow);
      const barWidth = (count / maxCount) * (histogramRight - histogramLeft);
      return `<rect class="simulation-bin ${center >= 0 ? "positive" : "negative"}" data-bin="${index}" x="${histogramLeft}" y="${histogramTop + (bins - index - 1) * barHeight}" width="${Math.max(1, barWidth)}" height="${Math.max(1, barHeight - 1)}"><title>${count.toLocaleString()} paths around P/L ${center.toFixed(2)}</title></rect>`;
    })
    .join(
      "",
    )}<line class="simulation-zero" x1="${histogramLeft}" x2="${histogramRight}" y1="${pnlY(0)}" y2="${pnlY(0)}"></line><text class="axis" x="${histogramLeft}" y="${histogramBottom + 25}">P/L ${pnlLow.toFixed(1)}</text><text class="axis" x="${histogramRight}" y="${histogramBottom + 25}" text-anchor="end">${pnlHigh.toFixed(1)}</text>`;
  simulationChartContext = {
    width,
    height,
    pnlLow,
    pnlHigh,
    bins,
    counts,
    maxCount,
    histogramLeft,
    histogramRight,
    top: histogramTop,
    bottom: histogramBottom,
    total: result.terminalPnls.length,
  };
  if (selectedSimulationPnl != null) {
    const binWidth = (pnlHigh - pnlLow) / bins;
    selectedSimulationPnl = Math.max(
      pnlLow + binWidth / 2,
      Math.min(pnlHigh - binWidth / 2, selectedSimulationPnl),
    );
  }
  simulationInspector.refresh();
  if (selectedSimulationPnl != null)
    highlightSimulationBin(simulationBinIndex(simulationChartContext, selectedSimulationPnl));
}
