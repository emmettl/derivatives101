import { candidateBounds, priceIncreasesWithCandidate } from "./engine";
import type {
  BarrierStyle,
  SolveVariable,
  SolverInputs,
  SolverSolution,
  SolverStep,
} from "./engine";
import {
  calculateSolver,
  type SolverCalculationRequest,
  type SolverCalculationResult,
} from "./calculation";
import type { OptionType } from "../option-lab/types";
import { applyChartSize, onResize, responsiveChartSize } from "../shared/chart-size";
import { initCollapsibleSections } from "../shared/collapsible";
import marketSnapshotJson from "../../market-data/latest.json";
import {
  marketDataAgeDays,
  parseMarketSnapshot,
  type MarketInstrumentSnapshot,
  type MarketSnapshot,
} from "./market-snapshot";

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const defaults = {
  type: "call" as OptionType,
  solveFor: "strike" as SolveVariable,
  barrierStyle: "knock-in" as BarrierStyle,
  target: 8.5,
  S: 100,
  K: 100,
  v: 0.25,
  T: 1,
  r: 0.03,
  q: 0.01,
};

let state = { ...defaults };

function solverTolerance(inputs: SolverInputs): number {
  return Math.max(0.0000005, inputs.S * 0.00005);
}

const emptySolution = (): SolverSolution => ({
  steps: [],
  value: Number.NaN,
  price: Number.NaN,
  converged: false,
});

let solution: SolverSolution = emptySolution();
let calculation: SolverCalculationResult | undefined;
let calculationPending = true;
let calculationVersion = 0;
let calculationTimer: ReturnType<typeof setTimeout> | undefined;
let renderFrame: number | undefined;
let activeRequest: SolverCalculationRequest | undefined;
let calculationSource: "worker" | "fallback" = "worker";
let solverWorker =
  typeof Worker !== "undefined"
    ? new Worker(new URL("./calculation-worker.ts", import.meta.url), { type: "module" })
    : null;
let visibleSteps = 0;
let timer: number | undefined;
let animateNextRender = false;
let previousChartVisual: ChartVisual | undefined;
let marketSnapshot: MarketSnapshot | undefined;

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartVisual {
  lower: ChartPoint;
  upper: ChartPoint;
  midpoint?: ChartPoint;
}

const controls = {
  target: $("#target") as HTMLInputElement,
  spot: $("#spot") as HTMLInputElement,
  strike: $("#strike") as HTMLInputElement,
  vol: $("#vol") as HTMLInputElement,
  expiry: $("#expiry") as HTMLInputElement,
  rate: $("#rate") as HTMLInputElement,
  dividend: $("#dividend") as HTMLInputElement,
};

const marketControls = {
  underlying: $("#market-underlying") as HTMLSelectElement,
  apply: $("#apply-market") as HTMLButtonElement,
  status: $("#market-status"),
};

const defaultControlRanges = new Map(
  Object.values(controls).map((control) => [
    control,
    { min: control.min, max: control.max, step: control.step },
  ]),
);

function priceDecimals(): number {
  if (state.S < 10) return 4;
  if (state.S < 100) return 3;
  return 2;
}

function formatPrice(value: number): string {
  return value.toFixed(priceDecimals());
}

function formatError(value: number): string {
  return value.toFixed(priceDecimals() + 2);
}

function readInputs(): SolverInputs {
  return {
    type: state.type,
    solveFor: state.solveFor,
    barrierStyle: state.barrierStyle,
    target: Number(controls.target.value),
    S: Number(controls.spot.value),
    K: Number(controls.strike.value),
    v: Number(controls.vol.value) / 100,
    T: Number(controls.expiry.value),
    r: Number(controls.rate.value) / 100,
    q: Number(controls.dividend.value) / 100,
  };
}

function selectedMarketInstrument(): MarketInstrumentSnapshot | undefined {
  return marketSnapshot?.instruments.find(
    (instrument) => instrument.id === marketControls.underlying.value,
  );
}

function marketInputStep(value: number): number {
  if (value < 10) return 0.0001;
  if (value < 100) return 0.01;
  return 0.1;
}

function setRange(
  control: HTMLInputElement,
  minimum: number,
  maximum: number,
  step: number,
  value: number,
): void {
  control.min = String(minimum);
  control.max = String(maximum);
  control.step = String(step);
  control.value = String(value);
}

function describeMarketInstrument(instrument: MarketInstrumentSnapshot): void {
  const age = marketDataAgeDays(instrument);
  const freshness = age > 3 ? `Snapshot is ${Math.floor(age)} days old. ` : "";
  marketControls.status.textContent = `${freshness}${instrument.spotAsOf}: ${instrument.quoteConvention}; spot ${instrument.spot.toFixed(4)} and 60-session realised vol ${(instrument.realisedVolatility60 * 100).toFixed(1)}%. Discount and foreign-rate assumptions remain editable.`;
}

function applyMarketInstrument(): void {
  const instrument = selectedMarketInstrument();
  if (!instrument) return;
  const spot = instrument.spot;
  const inputStep = marketInputStep(spot);
  setRange(controls.spot, spot * 0.5, spot * 1.5, inputStep, spot);
  setRange(controls.strike, spot * 0.4, spot * 1.8, inputStep, spot);
  setRange(controls.target, spot * 0.0025, spot * 0.4, inputStep / 2, spot * 0.085);
  setRange(controls.vol, 0.5, 80, 0.1, instrument.realisedVolatility60 * 100);
  resetTrail();
  marketControls.status.textContent = `${instrument.label} inputs applied: latest reference spot and 60-session realised-volatility proxy. Rates remain assumptions, not snapshot observations.`;
}

function initialiseMarketSnapshot(): void {
  try {
    marketSnapshot = parseMarketSnapshot(marketSnapshotJson);
    marketControls.underlying.replaceChildren(
      ...marketSnapshot.instruments.map((instrument) => {
        const option = document.createElement("option");
        option.value = instrument.id;
        option.textContent = instrument.label;
        return option;
      }),
    );
    marketControls.underlying.disabled = false;
    marketControls.apply.disabled = false;
    const first = selectedMarketInstrument();
    if (first) describeMarketInstrument(first);
  } catch {
    marketControls.underlying.replaceChildren(new Option("Snapshot unavailable"));
    marketControls.status.textContent =
      "The dated market snapshot could not be loaded. The illustrative inputs remain available.";
  }
}

function stopTimer(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  $("#solve").textContent = "Solve automatically";
}

function finishCalculation(result: SolverCalculationResult, source: "worker" | "fallback"): void {
  if (result.id !== calculationVersion) return;
  activeRequest = undefined;
  calculation = result;
  calculationSource = source;
  calculationPending = false;
  solution = result.solution;
  render();
}

function calculateWithoutWorker(request: SolverCalculationRequest): void {
  setTimeout(() => finishCalculation(calculateSolver(request), "fallback"), 0);
}

function startCalculation(request: SolverCalculationRequest): void {
  if (request.id !== calculationVersion) return;
  activeRequest = request;
  if (solverWorker) solverWorker.postMessage(request);
  else calculateWithoutWorker(request);
}

function scheduleRender(): void {
  if (renderFrame !== undefined) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = undefined;
    render();
  });
}

function resetTrail(delay = 48): void {
  stopTimer();
  state = readInputs();
  solution = emptySolution();
  calculation = undefined;
  calculationPending = true;
  visibleSteps = 0;
  animateNextRender = false;
  previousChartVisual = undefined;
  const request: SolverCalculationRequest = {
    id: ++calculationVersion,
    inputs: { ...state },
    tolerance: solverTolerance(state),
  };
  clearTimeout(calculationTimer);
  calculationTimer = setTimeout(() => startCalculation(request), delay);
  scheduleRender();
}

if (solverWorker) {
  solverWorker.onmessage = (event: MessageEvent<SolverCalculationResult>) =>
    finishCalculation(event.data, "worker");
  solverWorker.onerror = () => {
    solverWorker?.terminate();
    solverWorker = null;
    if (activeRequest?.id === calculationVersion) calculateWithoutWorker(activeRequest);
  };
}

function currentStep(): SolverStep | undefined {
  return visibleSteps > 0 ? solution.steps[visibleSteps - 1] : undefined;
}

const variableMeta = {
  strike: {
    label: "strike",
    solvedLabel: "Solved strike",
    symbol: "K",
    axis: "Strike K",
    inputs: "S, <mark>K</mark>, T, r, q, σ",
    explanation:
      "There is no simple rearrangement for K. Call value falls as strike rises; put value rises. That monotonic relationship gives the solver a direction.",
  },
  volatility: {
    label: "volatility",
    solvedLabel: "Implied volatility",
    symbol: "σ",
    axis: "Volatility σ",
    inputs: "S, K, T, r, q, <mark>σ</mark>",
    explanation:
      "This is how implied volatility is recovered from a market price. Call and put values both rise with volatility, so every comparison points the search up or down.",
  },
  spot: {
    label: "spot",
    solvedLabel: "Implied spot",
    symbol: "S",
    axis: "Spot S",
    inputs: "<mark>S</mark>, K, T, r, q, σ",
    explanation:
      "Call value rises with spot, while put value falls. The same bracket works, but its search direction flips when the option type changes.",
  },
  barrier: {
    label: "barrier",
    solvedLabel: "Solved down barrier",
    symbol: "H",
    axis: "Down barrier H",
    inputs: "S, K, T, r, q, σ, <mark>H</mark>",
    explanation:
      "A higher down barrier makes a touch more likely. That raises knock-in value and lowers knock-out value, so switching activation style reverses the search direction. For a call struck above the barrier the value is nearly flat in the barrier, so the solve is ill-conditioned: many barriers satisfy the tolerance.",
  },
} as const;

function formatCandidate(value: number): string {
  return state.solveFor === "volatility" ? `${(value * 100).toFixed(1)}%` : formatPrice(value);
}

function formatAxisCandidate(value: number): string {
  if (state.solveFor === "volatility") return `${(value * 100).toFixed(0)}%`;
  return value.toFixed(state.S < 10 ? 3 : 0);
}

function renderOutputs(): void {
  const meta = variableMeta[state.solveFor];
  $("#target-out").textContent = formatPrice(state.target);
  $("#spot-out").textContent = formatPrice(state.S);
  $("#strike-out").textContent = formatPrice(state.K);
  $("#vol-out").textContent = `${(state.v * 100).toFixed(1)}%`;
  $("#expiry-out").textContent = `${state.T.toFixed(2)}y`;
  $("#rate-out").textContent = `${(state.r * 100).toFixed(1)}%`;
  $("#dividend-out").textContent = `${(state.q * 100).toFixed(1)}%`;
  $("#target-summary").textContent = formatPrice(state.target);
  $("#equation-target").textContent = formatPrice(state.target);
  $("#equation-type").textContent = state.type === "call" ? "Call price" : "Put price";
  $("#solve-heading").textContent = `Solve for ${meta.label}`;
  $("#solved-label").textContent = meta.solvedLabel;
  $("#equation-inputs").innerHTML = meta.inputs;
  $("#equation-explanation").textContent = meta.explanation;
  $("#lower-label").textContent = `Tested lower ${meta.label}`;
  $("#upper-label").textContent = `Tested upper ${meta.label}`;
  $("#test-variable-heading").textContent = `Test ${meta.symbol}`;
  const known = [state.type === "call" ? "Call" : "Put", `target ${formatPrice(state.target)}`];
  if (state.solveFor !== "spot") known.push(`S ${formatPrice(state.S)}`);
  if (state.solveFor !== "strike") known.push(`K ${formatPrice(state.K)}`);
  if (state.solveFor !== "volatility") known.push(`σ ${(state.v * 100).toFixed(0)}%`);
  known.push(`${state.T.toFixed(2)}y`);
  $("#controls-summary").textContent = known.join(" · ");
  document.querySelectorAll<HTMLElement>("[data-input]").forEach((row) => {
    row.classList.toggle("is-hidden", row.dataset.input === state.solveFor);
  });
  document.querySelectorAll<HTMLElement>("[data-mode='barrier']").forEach((control) => {
    control.classList.toggle("is-hidden", state.solveFor !== "barrier");
  });
}

function renderSummary(): void {
  const step = currentStep();
  const complete = visibleSteps >= solution.steps.length && solution.converged;
  $("#solved-value").textContent = complete
    ? formatCandidate(solution.value)
    : step
      ? formatCandidate(step.midpoint)
      : "—";
  $("#candidate-price").textContent = step ? formatPrice(step.price) : "—";
  $("#error-summary").textContent = step ? formatError(Math.abs(step.error)) : "—";
  $("#iteration-summary").textContent = String(visibleSteps);
  $("#step").toggleAttribute(
    "disabled",
    visibleSteps >= solution.steps.length || !solution.steps.length,
  );
  $("#solve").toggleAttribute("disabled", !solution.steps.length);

  const pill = $("#status-pill");
  pill.classList.toggle("solved", complete);
  pill.textContent = calculationPending
    ? "Updating model…"
    : complete
      ? `Solved in ${solution.steps.length} steps`
      : visibleSteps
        ? `Step ${visibleSteps} of ${solution.steps.length}`
        : "Ready to solve";

  if (calculationPending) {
    $("#action-note").textContent = "Inputs updated. Repricing…";
  } else if (!solution.steps.length) {
    $("#action-note").textContent =
      "The target is outside the prices available in this search range. Adjust the target or model inputs.";
  } else if (complete) {
    const [initialLower, initialUpper] = candidateBounds(state);
    const finalStep = solution.steps.at(-1);
    const bracketShare = finalStep
      ? (finalStep.nextUpper - finalStep.nextLower) / (initialUpper - initialLower)
      : 0;
    const toleranceCopy = `The model price is within ${formatError(solverTolerance(state))} of the ${formatPrice(state.target)} target.`;
    $("#action-note").textContent =
      bracketShare > 0.05
        ? `${toleranceCopy} The bracket is still wide: the price barely moves with this variable here, so many candidates pass the tolerance.`
        : toleranceCopy;
  } else if (!step) {
    $("#action-note").textContent =
      "Take one step to inspect each decision, or run the full solve.";
  }

  if (animateNextRender) {
    [
      "#solved-value",
      "#candidate-price",
      "#error-summary",
      "#iteration-summary",
      "#status-pill",
    ].forEach((selector) => pulseValue($(selector)));
  }
}

function renderDecision(): void {
  const step = currentStep();
  const [initialLower, initialUpper] = candidateBounds(state);
  $("#lower-value").textContent = formatCandidate(step?.lower ?? initialLower);
  $("#upper-value").textContent = formatCandidate(step?.upper ?? initialUpper);
  $("#mid-value").textContent = formatCandidate(
    step?.midpoint ?? (initialLower + initialUpper) / 2,
  );

  if (calculationPending) {
    $("#decision-copy").textContent = "Updating the solution and chart…";
    return;
  }
  if (!step) {
    $("#decision-copy").textContent = "The first step will test the middle of the starting range.";
    return;
  }
  if (step.converged) {
    $("#decision-copy").textContent =
      `The price ${formatPrice(step.price)} is close enough to the target. The search stops.`;
    return;
  }
  const comparison = step.price > state.target ? "above" : "below";
  const increasing = priceIncreasesWithCandidate(state);
  const candidateTooLow = increasing ? step.price < state.target : step.price > state.target;
  const variable = variableMeta[state.solveFor].label;
  const implication = `The ${variable} is too ${candidateTooLow ? "low" : "high"}, so discard the ${candidateTooLow ? "lower" : "upper"} half.`;
  const retained = `Retained bracket: ${formatCandidate(step.nextLower)} — ${formatCandidate(step.nextUpper)}.`;
  $("#decision-copy").textContent =
    `${formatPrice(step.price)} is ${comparison} ${formatPrice(state.target)}. ${implication} ${retained}`;

  if (animateNextRender) {
    ["#lower-value", "#mid-value", "#upper-value"].forEach((selector) => pulseValue($(selector)));
    $("#decision-copy").animate(
      [
        { opacity: 0, transform: "translateY(7px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  }
}

function renderTable(): void {
  const body = $("#iteration-body") as HTMLTableSectionElement;
  const shown = solution.steps.slice(0, visibleSteps);
  if (!shown.length) {
    const message = calculationPending
      ? "Updating the model…"
      : "No guesses yet. Take the first step above.";
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${message}</td></tr>`;
    return;
  }
  body.innerHTML = shown
    .map(
      (
        step,
        index,
      ) => `<tr${animateNextRender && index === shown.length - 1 ? ' class="new-step"' : ""}>
        <td>${step.iteration}</td>
        <td>${formatCandidate(step.lower)} — ${formatCandidate(step.upper)}</td>
        <td><strong>${formatCandidate(step.midpoint)}</strong></td>
        <td>${formatPrice(step.price)}</td>
        <td>${step.error >= 0 ? "+" : ""}${formatError(step.error)}</td>
        <td class="decision-keep">${step.decision}</td>
      </tr>`,
    )
    .join("");
}

function pulseValue(element: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(
    [
      { opacity: 0.35, transform: "translateY(5px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" },
  );
}

function travel(element: SVGElement, from: ChartPoint, to: ChartPoint, delay = 0): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(
    [
      { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)` },
      { transform: "translate(0, 0)" },
    ],
    {
      duration: 520,
      delay,
      easing: "cubic-bezier(.22,.85,.24,1)",
      fill: "backwards",
    },
  );
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function renderChart(): void {
  const svg = $("#solver-chart") as unknown as SVGSVGElement;
  if (!calculation) {
    svg.classList.add("is-updating");
    svg.setAttribute("aria-busy", "true");
    return;
  }
  svg.classList.remove("is-updating");
  svg.setAttribute("aria-busy", "false");
  svg.dataset.calculationSource = calculationSource;
  svg.dataset.modelSpot = String(state.S);
  const { width, height } = responsiveChartSize(svg, { width: 900, height: 350 }, 0.8);
  applyChartSize(svg, { width, height });
  const margin = { top: 22, right: 24, bottom: 46, left: width < 600 ? 48 : 58 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const { minCandidate, maxCandidate, samples, maxPrice } = calculation;
  const x = (candidate: number) =>
    margin.left + ((candidate - minCandidate) / (maxCandidate - minCandidate)) * plotW;
  const y = (price: number) => margin.top + plotH - (price / maxPrice) * plotH;
  svg.replaceChildren();

  const svgTitle = svgElement("title", { id: "chart-title" });
  svgTitle.textContent = `Option price by ${variableMeta[state.solveFor].label}`;
  const svgDescription = svgElement("desc", { id: "chart-description" });
  svgDescription.textContent = `A curve showing option value across candidate ${variableMeta[state.solveFor].label} values, the target price, the range just tested, and the bracket retained for the next step.`;
  svg.append(svgTitle, svgDescription);

  for (let i = 0; i <= 4; i += 1) {
    const price = (maxPrice * i) / 4;
    const yy = y(price);
    svg.append(
      svgElement("line", {
        x1: String(margin.left),
        x2: String(width - margin.right),
        y1: String(yy),
        y2: String(yy),
        class: "grid-line",
      }),
    );
    const label = svgElement("text", {
      x: String(margin.left - 10),
      y: String(yy + 4),
      "text-anchor": "end",
      class: "axis-label",
    });
    label.textContent = price.toFixed(state.S < 10 ? 3 : 0);
    svg.append(label);
  }

  for (let i = 0; i <= 4; i += 1) {
    const candidate = minCandidate + ((maxCandidate - minCandidate) * i) / 4;
    const label = svgElement("text", {
      x: String(x(candidate)),
      y: String(height - 18),
      "text-anchor": "middle",
      class: "axis-label",
    });
    label.textContent = formatAxisCandidate(candidate);
    svg.append(label);
  }

  const step = currentStep();
  const testedLower = step?.lower ?? minCandidate;
  const testedUpper = step?.upper ?? maxCandidate;
  const lower = step?.nextLower ?? minCandidate;
  const upper = step?.nextUpper ?? maxCandidate;
  const boundPrices = step
    ? calculation.retainedBoundPrices[visibleSteps - 1]
    : calculation.initialBoundPrices;
  if (!boundPrices) return;
  const currentVisual: ChartVisual = {
    lower: { x: x(lower), y: y(boundPrices.lower) },
    upper: { x: x(upper), y: y(boundPrices.upper) },
    midpoint: step ? { x: x(step.midpoint), y: y(step.price) } : undefined,
  };
  if (step) {
    svg.append(
      svgElement("rect", {
        x: String(x(testedLower)),
        y: String(margin.top),
        width: String(Math.max(0, x(testedUpper) - x(testedLower))),
        height: String(plotH),
        class: "tested-zone",
        "data-lower": String(testedLower),
        "data-upper": String(testedUpper),
      }),
    );
  }
  const bracketZone = svgElement("rect", {
    x: String(currentVisual.lower.x),
    y: String(margin.top),
    width: String(Math.max(0, currentVisual.upper.x - currentVisual.lower.x)),
    height: String(plotH),
    class: "bracket-zone",
    "data-lower": String(lower),
    "data-upper": String(upper),
  });
  svg.append(bracketZone);

  const pathData = samples
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${x(point.candidate).toFixed(2)} ${y(point.price).toFixed(2)}`,
    )
    .join(" ");
  svg.append(svgElement("path", { d: pathData, class: "price-curve" }));
  svg.append(
    svgElement("line", {
      x1: String(margin.left),
      x2: String(width - margin.right),
      y1: String(y(state.target)),
      y2: String(y(state.target)),
      class: "target-line",
    }),
  );
  const targetLabel = svgElement("text", {
    x: String(width - margin.right - 4),
    y: String(y(state.target) - 8),
    "text-anchor": "end",
    class: "target-label",
  });
  targetLabel.textContent = `TARGET ${formatPrice(state.target)}`;
  svg.append(targetLabel);

  const lowerBoundary = svgElement("line", {
    x1: String(currentVisual.lower.x),
    x2: String(currentVisual.lower.x),
    y1: String(margin.top),
    y2: String(margin.top + plotH),
    class: "bracket-boundary",
  });
  const upperBoundary = svgElement("line", {
    x1: String(currentVisual.upper.x),
    x2: String(currentVisual.upper.x),
    y1: String(margin.top),
    y2: String(margin.top + plotH),
    class: "bracket-boundary",
  });
  const lowerDot = svgElement("circle", {
    cx: String(currentVisual.lower.x),
    cy: String(currentVisual.lower.y),
    r: "6",
    class: "bracket-dot",
  });
  const upperDot = svgElement("circle", {
    cx: String(currentVisual.upper.x),
    cy: String(currentVisual.upper.y),
    r: "6",
    class: "bracket-dot",
  });
  svg.append(lowerBoundary, upperBoundary, lowerDot, upperDot);

  let candidateDot: SVGCircleElement | undefined;
  if (currentVisual.midpoint) {
    if (step?.converged) {
      svg.append(
        svgElement("circle", {
          cx: String(currentVisual.midpoint.x),
          cy: String(currentVisual.midpoint.y),
          r: "9",
          class: "candidate-ring",
        }),
      );
    }
    candidateDot = svgElement("circle", {
      cx: String(currentVisual.midpoint.x),
      cy: String(currentVisual.midpoint.y),
      r: "8",
      class: "candidate-dot",
    });
    svg.append(candidateDot);
  }

  if (animateNextRender && previousChartVisual) {
    travel(lowerDot, previousChartVisual.lower, currentVisual.lower);
    travel(upperDot, previousChartVisual.upper, currentVisual.upper);
    [lowerBoundary, upperBoundary].forEach((boundary) =>
      boundary.animate([{ opacity: 0.15 }, { opacity: 1 }], {
        duration: 460,
        easing: "ease-out",
      }),
    );
    bracketZone.animate(
      [
        { opacity: 0.03, transform: "scaleY(.86)" },
        { opacity: 1, transform: "scaleY(1)" },
      ],
      { duration: 500, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    if (candidateDot && currentVisual.midpoint) {
      const origin = previousChartVisual.midpoint ?? {
        x: currentVisual.midpoint.x,
        y: margin.top + plotH,
      };
      travel(candidateDot, origin, currentVisual.midpoint, 70);
      candidateDot.animate(
        [
          { opacity: 0.65, r: 6 },
          { opacity: 1, r: 10, offset: 0.78 },
          { opacity: 1, r: 8 },
        ],
        { duration: 580, delay: 70, easing: "ease-out" },
      );
    }
  }

  const xTitle = svgElement("text", {
    x: String(margin.left + plotW / 2),
    y: String(height - 1),
    "text-anchor": "middle",
    class: "axis-title",
  });
  xTitle.textContent = variableMeta[state.solveFor].axis;
  svg.append(xTitle);
  const yTitle = svgElement("text", {
    x: "13",
    y: String(margin.top + plotH / 2),
    transform: `rotate(-90 13 ${margin.top + plotH / 2})`,
    "text-anchor": "middle",
    class: "axis-title",
  });
  yTitle.textContent = "Option price";
  svg.append(yTitle);
  previousChartVisual = currentVisual;
}

function render(): void {
  renderOutputs();
  renderSummary();
  renderDecision();
  renderTable();
  renderChart();
  animateNextRender = false;
}

Object.values(controls).forEach((control) => control.addEventListener("input", () => resetTrail()));

marketControls.underlying.addEventListener("change", () => {
  const instrument = selectedMarketInstrument();
  if (instrument) describeMarketInstrument(instrument);
});
marketControls.apply.addEventListener("click", applyMarketInstrument);

$("#solve-variable").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
  if (!button) return;
  state.solveFor = button.dataset.value as SolveVariable;
  document.querySelectorAll<HTMLButtonElement>("#solve-variable button").forEach((item) => {
    const on = item === button;
    item.classList.toggle("on", on);
    item.setAttribute("aria-pressed", String(on));
  });
  resetTrail();
});

$("#option-type").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
  if (!button) return;
  state.type = button.dataset.value as OptionType;
  document.querySelectorAll<HTMLButtonElement>("#option-type button").forEach((item) => {
    const on = item === button;
    item.classList.toggle("on", on);
    item.setAttribute("aria-pressed", String(on));
  });
  resetTrail();
});

$("#barrier-style").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
  if (!button) return;
  state.barrierStyle = button.dataset.value as BarrierStyle;
  document.querySelectorAll<HTMLButtonElement>("#barrier-style button").forEach((item) => {
    const on = item === button;
    item.classList.toggle("on", on);
    item.setAttribute("aria-pressed", String(on));
  });
  resetTrail();
});

$("#step").addEventListener("click", () => {
  stopTimer();
  visibleSteps = Math.min(solution.steps.length, visibleSteps + 1);
  animateNextRender = true;
  render();
});

$("#solve").addEventListener("click", () => {
  if (!solution.steps.length) return;
  if (timer !== undefined) {
    stopTimer();
    return;
  }
  if (visibleSteps >= solution.steps.length) {
    visibleSteps = 0;
    previousChartVisual = undefined;
    render();
  }
  $("#solve").textContent = "Pause solve";
  timer = window.setInterval(() => {
    visibleSteps += 1;
    animateNextRender = true;
    render();
    if (visibleSteps >= solution.steps.length) stopTimer();
  }, 720);
});

$("#restart").addEventListener("click", () => {
  visibleSteps = 0;
  stopTimer();
  animateNextRender = false;
  previousChartVisual = undefined;
  $("#action-note").textContent = "Take one step to inspect each decision, or run the full solve.";
  render();
});

$("#reset").addEventListener("click", () => {
  state = { ...defaults };
  defaultControlRanges.forEach((range, control) => {
    control.min = range.min;
    control.max = range.max;
    control.step = range.step;
  });
  controls.target.value = String(defaults.target);
  controls.spot.value = String(defaults.S);
  controls.strike.value = String(defaults.K);
  controls.vol.value = String(defaults.v * 100);
  controls.expiry.value = String(defaults.T);
  controls.rate.value = String(defaults.r * 100);
  controls.dividend.value = String(defaults.q * 100);
  document.querySelectorAll<HTMLButtonElement>("#solve-variable button").forEach((button) => {
    const on = button.dataset.value === defaults.solveFor;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll<HTMLButtonElement>("#barrier-style button").forEach((button) => {
    const on = button.dataset.value === defaults.barrierStyle;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll<HTMLButtonElement>("#option-type button").forEach((button) => {
    const on = button.dataset.value === defaults.type;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  resetTrail();
  const instrument = selectedMarketInstrument();
  if (instrument) describeMarketInstrument(instrument);
});

initCollapsibleSections("(max-width: 760px)");
onResize(render);
render();
initialiseMarketSnapshot();
resetTrail(0);
