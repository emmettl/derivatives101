import type { StrategySimulationResult } from "./types";

function byId<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing strategy lab element #${id}`);
  return element as unknown as T;
}

export function drawSimulationChart(result: StrategySimulationResult): void {
  const svg = byId<SVGElement>("strategy-simulation-chart");
  const width = 900;
  const height = 390;
  const margin = { left: 58, right: 22, top: 38, bottom: 42 };
  const split = 630;
  const pathRight = split - 24;
  const pathValues = result.paths.flatMap((path) => Array.from(path));
  const rawLow = Math.min(result.market.spot, ...pathValues);
  const rawHigh = Math.max(result.market.spot, ...pathValues);
  const spotPadding = Math.max(1, (rawHigh - rawLow) * 0.08);
  const spotLow = Math.max(0, rawLow - spotPadding);
  const spotHigh = rawHigh + spotPadding;
  const x = (step: number) => margin.left + (step / result.steps) * (pathRight - margin.left);
  const y = (spot: number) =>
    margin.top + ((spotHigh - spot) / (spotHigh - spotLow)) * (height - margin.top - margin.bottom);
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
  const histogramLeft = split + 22;
  const histogramRight = width - margin.right;
  const histogramHeight = height - margin.top - margin.bottom;
  const barHeight = histogramHeight / bins;
  const pnlY = (value: number) =>
    margin.top + ((pnlHigh - value) / (pnlHigh - pnlLow)) * histogramHeight;

  svg.setAttribute(
    "aria-label",
    `${result.paths.length} visible shared underlying paths and a terminal strategy profit and loss distribution from ${result.terminalPnls.length.toLocaleString()} simulations`,
  );
  svg.innerHTML = `<title>Shared-path Monte Carlo simulation</title><desc>Every visible path drives all active option legs together. The histogram shows the resulting complete-strategy profit and loss at expiry.</desc><text class="simulation-label" x="${margin.left}" y="19">SHARED UNDERLYING PATHS</text><text class="simulation-label" x="${histogramLeft}" y="19">STRATEGY P/L AT EXPIRY</text>${spotTicks.map((tick) => `<line class="grid" x1="${margin.left}" x2="${pathRight}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${margin.left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${timeTicks.map((tick) => `<line class="grid" x1="${x(tick * result.steps)}" x2="${x(tick * result.steps)}" y1="${margin.top}" y2="${height - margin.bottom}"></line><text class="axis" x="${x(tick * result.steps)}" y="${height - 17}" text-anchor="middle">${tick === 0 ? "Today" : tick === 1 ? "Expiry" : `${Math.round(tick * 100)}%`}</text>`).join("")}<line class="simulation-start" x1="${margin.left}" x2="${pathRight}" y1="${y(result.market.spot)}" y2="${y(result.market.spot)}"></line>${result.paths
    .map(
      (path, index) =>
        `<path class="simulation-path ${result.pathPnls[index] >= 0 ? "positive" : "negative"}" d="${Array.from(
          path,
        )
          .map((spot, step) => `${step ? "L" : "M"}${x(step).toFixed(2)},${y(spot).toFixed(2)}`)
          .join(" ")}"></path>`,
    )
    .join("")}${counts
    .map((count, index) => {
      const center = pnlLow + ((index + 0.5) / bins) * (pnlHigh - pnlLow);
      const barWidth = (count / maxCount) * (histogramRight - histogramLeft);
      return `<rect class="simulation-bin ${center >= 0 ? "positive" : "negative"}" x="${histogramLeft}" y="${margin.top + (bins - index - 1) * barHeight}" width="${Math.max(1, barWidth)}" height="${Math.max(1, barHeight - 1)}"><title>${count.toLocaleString()} paths around P/L ${center.toFixed(2)}</title></rect>`;
    })
    .join(
      "",
    )}<line class="simulation-zero" x1="${histogramLeft}" x2="${histogramRight}" y1="${pnlY(0)}" y2="${pnlY(0)}"></line><text class="axis" x="${histogramLeft}" y="${height - 17}">P/L ${pnlLow.toFixed(1)}</text><text class="axis" x="${histogramRight}" y="${height - 17}" text-anchor="end">${pnlHigh.toFixed(1)}</text>`;
}
