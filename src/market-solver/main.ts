import {
  type BarrierObservation,
  type SolveResult,
  type SolveStep,
  type SolveTarget,
} from "./engine";
import {
  calculateMarketSolver,
  definitionForState,
  type Headline,
  type MarketSolverCalculationRequest,
  type MarketSolverCalculationResult,
  type MarketSolverChart,
  type MarketSolverDefinition,
  type MarketSolverState,
  type Product,
} from "./calculation";
import {
  atmVolatility,
  curveFor,
  impliedVolatility,
  snapshot,
  underlyingById,
  zeroRate,
  type VolatilityModel,
} from "./snapshot";

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const tenorRanges: Record<Product, { min: number; max: number; step: number; value: number }> = {
  autocall: { min: 1, max: 6, step: 1, value: 3 },
  rc: { min: 0.5, max: 3, step: 0.5, value: 1 },
  protected: { min: 1, max: 8, step: 1, value: 5 },
};

const defaultTargets: Record<Product, SolveTarget> = {
  autocall: "autocall-barrier",
  rc: "rc-barrier",
  protected: "protection",
};

const targetOptions: Record<Product, Array<[SolveTarget, string]>> = {
  autocall: [["autocall-barrier", "Knock-in barrier for a target coupon"]],
  rc: [["rc-barrier", "Knock-in barrier for a target coupon"]],
  protected: [
    ["protection", "Protection level for a target participation"],
    ["cap", "Upside cap for a target participation"],
  ],
};

const defaults: MarketSolverState = {
  underlying: "SX5E",
  product: "autocall",
  volModel: "skew",
  tenor: 3,
  frequency: 4,
  trigger: 100,
  barrier: 60,
  barrierObservation: "maturity",
  strike: 100,
  protection: 100,
  capEnabled: false,
  cap: 150,
  fee: 1,
  spread: 1,
  margin: 1,
  solveTarget: "autocall-barrier",
  target: 0,
};

let state: MarketSolverState = { ...defaults };

const controls = {
  underlying: $("#underlying") as HTMLSelectElement,
  tenor: $("#tenor") as HTMLInputElement,
  frequency: $("#frequency") as HTMLSelectElement,
  trigger: $("#trigger") as HTMLInputElement,
  barrier: $("#barrier") as HTMLInputElement,
  strike: $("#strike") as HTMLInputElement,
  protection: $("#protection") as HTMLInputElement,
  capEnabled: $("#cap-enabled") as HTMLInputElement,
  cap: $("#cap") as HTMLInputElement,
  fee: $("#fee") as HTMLInputElement,
  spread: $("#spread") as HTMLInputElement,
  margin: $("#margin") as HTMLInputElement,
  solveTarget: $("#solve-target") as HTMLSelectElement,
  target: $("#target-value") as HTMLInputElement,
};

const percent = (value: number, digits = 1) => `${value.toFixed(digits)}%`;

function readState(): void {
  state = {
    ...state,
    underlying: controls.underlying.value,
    tenor: Number(controls.tenor.value),
    frequency: Number(controls.frequency.value),
    trigger: Number(controls.trigger.value),
    barrier: Number(controls.barrier.value),
    strike: Number(controls.strike.value),
    protection: Number(controls.protection.value),
    capEnabled: controls.capEnabled.checked,
    cap: Number(controls.cap.value),
    fee: Number(controls.fee.value),
    spread: Number(controls.spread.value),
    margin: Number(controls.margin.value),
    solveTarget: controls.solveTarget.value as SolveTarget,
    target: Number(controls.target.value),
  };
}

function writeControls(): void {
  controls.underlying.value = state.underlying;
  const range = tenorRanges[state.product];
  controls.tenor.min = String(range.min);
  controls.tenor.max = String(range.max);
  controls.tenor.step = String(range.step);
  controls.tenor.value = String(state.tenor);
  controls.frequency.value = String(state.frequency);
  controls.trigger.value = String(state.trigger);
  controls.barrier.value = String(state.barrier);
  controls.strike.value = String(state.strike);
  controls.protection.value = String(state.protection);
  controls.capEnabled.checked = state.capEnabled;
  controls.cap.value = String(state.cap);
  controls.fee.value = String(state.fee);
  controls.spread.value = String(state.spread);
  controls.margin.value = String(state.margin);
  controls.target.value = String(state.target);
  setSegmented("#product", state.product);
  setSegmented("#vol-model", state.volModel);
  setSegmented("#barrier-observation", state.barrierObservation);
}

function setSegmented(selector: string, value: string): void {
  document.querySelectorAll<HTMLButtonElement>(`${selector} button`).forEach((button) => {
    const on = button.dataset.value === value;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
}

// ---------------------------------------------------------------------------
// Solver.

let currentHeadline: Headline | undefined;
let currentDefinition: MarketSolverDefinition = definitionForState(state);
const emptySolution = (definition: MarketSolverDefinition): SolveResult => ({
  steps: [],
  candidate: Number.NaN,
  value: Number.NaN,
  converged: false,
  reachable: false,
  range: definition.range,
  minimum: Number.NaN,
  maximum: Number.NaN,
});
let solution: SolveResult = emptySolution(currentDefinition);
let calculation: MarketSolverChart | undefined;
let calculationPending = true;
let calculationVersion = 0;
let calculationTimer: ReturnType<typeof setTimeout> | undefined;
let activeRequest: MarketSolverCalculationRequest | undefined;
let calculationSource: "worker" | "fallback" = "worker";
let calculationWorker =
  typeof Worker !== "undefined"
    ? new Worker(new URL("./calculation-worker.ts", import.meta.url), { type: "module" })
    : null;
let visibleSteps = 0;
let timer: number | undefined;
let animateNextRender = false;

function stopTimer(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  $("#solve").textContent = "Solve automatically";
}

function finishCalculation(
  result: MarketSolverCalculationResult,
  source: "worker" | "fallback",
): void {
  if (result.id !== calculationVersion) return;
  activeRequest = undefined;
  state.target = result.target;
  controls.target.value = String(result.target);
  currentHeadline = result.headline;
  currentDefinition = result.definition;
  solution = result.solution;
  calculation = result.chart;
  calculationSource = source;
  calculationPending = false;
  render();
}

function calculateWithoutWorker(request: MarketSolverCalculationRequest): void {
  setTimeout(() => finishCalculation(calculateMarketSolver(request), "fallback"), 0);
}

function startCalculation(request: MarketSolverCalculationRequest): void {
  if (request.id !== calculationVersion) return;
  activeRequest = request;
  if (calculationWorker) calculationWorker.postMessage(request);
  else calculateWithoutWorker(request);
}

function recompute(seedTarget = false, delay = 48): void {
  stopTimer();
  currentDefinition = definitionForState(state);
  solution = emptySolution(currentDefinition);
  calculation = undefined;
  calculationPending = true;
  visibleSteps = 0;
  animateNextRender = false;
  const request: MarketSolverCalculationRequest = {
    id: ++calculationVersion,
    state: { ...state },
    seedTarget,
  };
  clearTimeout(calculationTimer);
  calculationTimer = setTimeout(() => startCalculation(request), delay);
  render();
}

if (calculationWorker) {
  calculationWorker.onmessage = (event: MessageEvent<MarketSolverCalculationResult>) =>
    finishCalculation(event.data, "worker");
  calculationWorker.onerror = () => {
    calculationWorker?.terminate();
    calculationWorker = null;
    if (activeRequest?.id === calculationVersion) calculateWithoutWorker(activeRequest);
  };
}

function currentStep(): SolveStep | undefined {
  return solution.steps[Math.max(0, visibleSteps - 1)];
}

function formatCandidate(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatResult(value: number): string {
  return currentDefinition.resultLabel === "participation" ? percent(value, 1) : percent(value, 2);
}

// ---------------------------------------------------------------------------
// Rendering.

function renderControls(): void {
  const underlying = underlyingById(state.underlying);
  $("#snapshot-heading").textContent = `${underlying.name} · ${snapshot.asOf}`;
  document.querySelectorAll<HTMLElement>("[data-product]").forEach((element) => {
    const products = (element.dataset.product ?? "").split(" ");
    element.classList.toggle("is-hidden", !products.includes(state.product));
  });
  $("#cap-row").classList.toggle("is-hidden", state.product !== "protected" || !state.capEnabled);
  $("#tenor-out").textContent = `${state.tenor.toFixed(1)}y`;
  $("#trigger-out").textContent = percent(state.trigger, 0);
  $("#barrier-out").textContent = percent(state.barrier, 0);
  $("#strike-out").textContent = percent(state.strike, 0);
  $("#protection-out").textContent = percent(state.protection, 0);
  $("#cap-out").textContent = percent(state.cap, 0);
  $("#fee-out").textContent = percent(state.fee, 1);
  $("#spread-out").textContent = percent(state.spread, 1);
  $("#margin-out").textContent = percent(state.margin, 1);

  const notes: Record<Product, string> = {
    autocall:
      "Autocallable reverse convertible: unconditional coupon, redemption at par on the first observation at or above the trigger, otherwise principal follows the index below the knock-in barrier. Monte Carlo with risk-neutral drift and the snapshot's smile applied as local volatility.",
    rc: "Barrier reverse convertible: issuer bond plus a short down-and-in put, continuously monitored, priced in closed form with the volatility quoted at the barrier.",
    protected:
      "Capital-protected note: zero-coupon floor on the issuer's funding curve, and the residual buys an at-the-money call or a call spread.",
  };
  $("#model-note").textContent = notes[state.product];

  const select = controls.solveTarget;
  const options = targetOptions[state.product];
  if (select.options.length !== options.length || select.options[0]?.value !== options[0][0]) {
    select.replaceChildren(
      ...options.map(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
      }),
    );
  }
  select.value = state.solveTarget;
  $("#target-unit").textContent =
    currentDefinition.resultLabel === "participation" ? "% participation" : "% coupon p.a.";
  controls.target.step = currentDefinition.resultLabel === "participation" ? "1" : "0.25";
}

function renderHeadline(): void {
  const headline = currentHeadline;
  const strip = $("#valuation-strip");
  strip.classList.toggle("is-calculating", calculationPending);
  strip.setAttribute("aria-busy", String(calculationPending));
  if (headline) {
    $("#headline-label").textContent = headline.label;
    $("#headline-value").textContent = headline.value;
    $("#secondary-label").textContent = headline.secondaryLabel;
    $("#secondary-value").textContent = headline.secondary;
    $("#alt-value").textContent = headline.alternative;
    $("#stat-a-label").textContent = headline.statALabel;
    $("#stat-a").textContent = headline.statA;
    $("#stat-b-label").textContent = headline.statBLabel;
    $("#stat-b").textContent = headline.statB;
  }
  const help = {
    autocall: {
      headline:
        "The annual coupon supported by the model after issuer margin. It is the investor-facing term for the current structure.",
      headlineGlossary: ["coupon", "Coupon"],
      secondary:
        "The model’s break-even coupon before issuer margin. The gap to the offered coupon shows the margin’s effect.",
      secondaryGlossary: ["fair-value", "Fair value"],
      statA:
        "The share of simulated paths that redeem early. It changes both expected life and the value of future coupons.",
      statAGlossary: ["autocall", "Autocall"],
      statB:
        "The share of simulated paths ending with a principal loss. It is a model probability, not a forecast or worst-case loss.",
      statBGlossary: ["knock-in", "Knock-in"],
    },
    rc: {
      headline:
        "The annual coupon supported by the bond and embedded short put after issuer margin. It is the investor-facing term.",
      headlineGlossary: ["coupon", "Coupon"],
      secondary:
        "The model’s break-even coupon before issuer margin. The gap to the offered coupon shows the margin’s effect.",
      secondaryGlossary: ["fair-value", "Fair value"],
      statA:
        "The present value of the embedded down-and-in put per 100 of notional. A more valuable short put should fund more coupon.",
      statAGlossary: ["barrier-option", "Barrier option"],
      statB:
        "The implied volatility at the barrier strike used to value the put. It exposes how downside skew enters the price.",
      statBGlossary: ["volatility-skew", "Volatility skew"],
    },
    protected: {
      headline:
        "The share of the index gain bought with the available option budget. 100% means matching the full positive return.",
      headlineGlossary: ["participation", "Participation rate"],
      secondary:
        "The cash left to buy upside after funding the promised protection and deducting the upfront fee.",
      secondaryGlossary: ["bond-floor", "Bond floor"],
      statA:
        "The present cost of the promised maturity repayment. What remains after buying this floor can fund options.",
      statAGlossary: ["bond-floor", "Bond floor"],
      statB:
        "The present cost of one unit of upside participation. The option budget divided by this cost determines participation.",
      statBGlossary: ["call-option", "Call option"],
    },
  }[state.product];
  $("#headline-help-copy").textContent = help.headline;
  $("#secondary-help-copy").textContent = help.secondary;
  $("#stat-a-help-copy").textContent = help.statA;
  $("#stat-b-help-copy").textContent = help.statB;
  [
    ["#headline-help-link", help.headlineGlossary],
    ["#secondary-help-link", help.secondaryGlossary],
    ["#stat-a-help-link", help.statAGlossary],
    ["#stat-b-help-link", help.statBGlossary],
  ].forEach(([selector, glossary]) => {
    const [id, label] = glossary as string[];
    const link = $(selector as string) as HTMLAnchorElement;
    link.href = `glossary.html#${id}`;
    link.textContent = `${label} in the glossary →`;
  });
  const underlying = underlyingById(state.underlying);
  $("#valuation-title").textContent =
    `${underlying.name} · ${state.tenor.toFixed(state.tenor % 1 ? 1 : 0)}-year ${
      state.product === "autocall"
        ? "autocall"
        : state.product === "rc"
          ? "barrier reverse convertible"
          : "capital-protected note"
    }`;
  if (headline) {
    ($("#breakdown-body") as HTMLTableSectionElement).innerHTML = headline.rows
      .map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`)
      .join("");
    $("#valuation-copy").textContent = headline.copy;
  }
}

function renderSolveSummary(): void {
  const step = currentStep();
  const complete = visibleSteps >= solution.steps.length && solution.converged;
  $("#solve-heading").textContent = `Solve for the ${currentDefinition.label}`;
  $("#solved-label").textContent = `Solved ${currentDefinition.label}`;
  $("#solved-value").textContent = complete
    ? formatCandidate(solution.candidate)
    : step
      ? formatCandidate(step.candidate)
      : "—";
  $("#candidate-result").textContent = step ? formatResult(step.value) : "—";
  $("#iteration-summary").textContent = String(visibleSteps);
  $("#step").toggleAttribute(
    "disabled",
    calculationPending || visibleSteps >= solution.steps.length || !solution.steps.length,
  );
  $("#solve").toggleAttribute("disabled", calculationPending || !solution.steps.length);

  const pill = $("#status-pill");
  pill.classList.toggle("solved", !calculationPending && complete);
  pill.classList.toggle("calculating", calculationPending);
  pill.textContent = calculationPending
    ? "Calculating…"
    : complete
      ? `Solved in ${solution.steps.length} steps`
      : visibleSteps
        ? `Step ${visibleSteps} of ${solution.steps.length}`
        : "Ready to solve";

  const note = $("#action-note");
  if (calculationPending) {
    note.textContent = "The selected market is visible. Repricing in the background…";
  } else if (!solution.reachable) {
    note.textContent = `No ${currentDefinition.label} between ${formatCandidate(solution.range[0])} and ${formatCandidate(solution.range[1])} gives ${formatResult(state.target)}. Reachable ${currentDefinition.resultLabel}: ${formatResult(solution.minimum)} to ${formatResult(solution.maximum)}.`;
  } else if (complete) {
    note.textContent = `${formatCandidate(solution.candidate)} gives ${formatResult(solution.value)}, within tolerance of the ${formatResult(state.target)} target.`;
  } else if (!step) {
    note.textContent = "Take one step to inspect each decision, or run the full solve.";
  }

  $("#lower-label").textContent = `Lower ${currentDefinition.label}`;
  $("#upper-label").textContent = `Upper ${currentDefinition.label}`;
  $("#lower-value").textContent = formatCandidate(step?.nextLower ?? solution.range[0]);
  $("#upper-value").textContent = formatCandidate(step?.nextUpper ?? solution.range[1]);
  $("#mid-value").textContent = formatCandidate(
    step?.candidate ?? (solution.range[0] + solution.range[1]) / 2,
  );
  const copy = $("#decision-copy");
  if (calculationPending) copy.textContent = "Updating the solution and chart for these inputs…";
  else if (!solution.reachable)
    copy.textContent = "Change the target or the terms to bring it within range.";
  else if (!step) copy.textContent = "The first step will test the middle of the range.";
  else if (step.converged)
    copy.textContent = `${formatResult(step.value)} is close enough to ${formatResult(state.target)}. The search stops.`;
  else {
    const candidateTooLow = currentDefinition.increasing
      ? step.value < state.target
      : step.value > state.target;
    copy.textContent = `${formatResult(step.value)} is ${step.value > state.target ? "above" : "below"} ${formatResult(state.target)}, so the ${currentDefinition.label} is too ${candidateTooLow ? "low" : "high"}: discard the ${candidateTooLow ? "lower" : "upper"} half.`;
  }
}

function renderTable(): void {
  const body = $("#iteration-body") as HTMLTableSectionElement;
  const shown = solution.steps.slice(0, visibleSteps);
  $("#result-heading").textContent =
    currentDefinition.resultLabel === "participation" ? "Participation" : "Coupon";
  if (!shown.length) {
    body.innerHTML = `<tr class="empty-row"><td colspan="6">${calculationPending ? "Calculating the new model…" : "No guesses yet. Take the first step above."}</td></tr>`;
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
        <td><strong>${formatCandidate(step.candidate)}</strong></td>
        <td>${formatResult(step.value)}</td>
        <td>${step.error >= 0 ? "+" : ""}${step.error.toFixed(3)}</td>
        <td class="decision-keep">${step.decision}</td>
      </tr>`,
    )
    .join("");
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function renderChart(): void {
  const svg = $("#solver-chart") as unknown as SVGSVGElement;
  svg.classList.toggle("is-updating", calculationPending);
  svg.setAttribute("aria-busy", String(calculationPending));
  if (!calculation) return;
  svg.dataset.calculationSource = calculationSource;
  svg.dataset.modelUnderlying = state.underlying;
  const width = 900;
  const height = 350;
  const margin = { top: 22, right: 24, bottom: 46, left: 62 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const [minCandidate, maxCandidate] = currentDefinition.range;
  const { samples } = calculation;
  const values = samples.map((point) => point.value).concat(state.target);
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(...values) * 1.05 || 1;
  const x = (candidate: number) =>
    margin.left + ((candidate - minCandidate) / (maxCandidate - minCandidate)) * plotW;
  const y = (value: number) =>
    margin.top + plotH - ((value - minValue) / (maxValue - minValue)) * plotH;
  svg.replaceChildren();

  const title = svgElement("title", { id: "chart-title" });
  title.textContent = `${currentDefinition.resultLabel} by ${currentDefinition.label}`;
  svg.append(title);

  for (let index = 0; index <= 4; index += 1) {
    const value = minValue + ((maxValue - minValue) * index) / 4;
    svg.append(
      svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: y(value),
        y2: y(value),
        class: "grid-line",
      }),
    );
    const label = svgElement("text", {
      x: margin.left - 10,
      y: y(value) + 4,
      "text-anchor": "end",
      class: "axis-label",
    });
    label.textContent = formatResult(value);
    svg.append(label);
  }
  for (let index = 0; index <= 4; index += 1) {
    const candidate = minCandidate + ((maxCandidate - minCandidate) * index) / 4;
    const label = svgElement("text", {
      x: x(candidate),
      y: height - 18,
      "text-anchor": "middle",
      class: "axis-label",
    });
    label.textContent = formatCandidate(candidate);
    svg.append(label);
  }

  const step = currentStep();
  const lower = step?.nextLower ?? minCandidate;
  const upper = step?.nextUpper ?? maxCandidate;
  if (solution.reachable) {
    svg.append(
      svgElement("rect", {
        x: x(lower),
        y: margin.top,
        width: Math.max(0, x(upper) - x(lower)),
        height: plotH,
        class: "bracket-zone",
      }),
    );
  }
  const pathData = samples
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${x(point.candidate).toFixed(2)} ${y(point.value).toFixed(2)}`,
    )
    .join(" ");
  svg.append(svgElement("path", { d: pathData, class: "price-curve" }));
  svg.append(
    svgElement("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: y(state.target),
      y2: y(state.target),
      class: "target-line",
    }),
  );
  const targetLabel = svgElement("text", {
    x: width - margin.right - 4,
    y: y(state.target) - 8,
    "text-anchor": "end",
    class: "target-label",
  });
  targetLabel.textContent = `TARGET ${formatResult(state.target)}`;
  svg.append(targetLabel);

  if (solution.reachable) {
    const boundValues = step
      ? calculation.retainedBoundValues[visibleSteps - 1]
      : calculation.initialBoundValues;
    if (!boundValues) return;
    const lowerPoint = { x: x(lower), y: y(boundValues.lower) };
    const upperPoint = { x: x(upper), y: y(boundValues.upper) };
    svg.append(
      svgElement("line", {
        x1: lowerPoint.x,
        x2: upperPoint.x,
        y1: lowerPoint.y,
        y2: upperPoint.y,
        class: "bracket-line",
      }),
      svgElement("circle", { cx: lowerPoint.x, cy: lowerPoint.y, r: 6, class: "bracket-dot" }),
      svgElement("circle", { cx: upperPoint.x, cy: upperPoint.y, r: 6, class: "bracket-dot" }),
    );
    if (step) {
      if (step.converged)
        svg.append(
          svgElement("circle", {
            cx: x(step.candidate),
            cy: y(step.value),
            r: 9,
            class: "candidate-ring",
          }),
        );
      svg.append(
        svgElement("circle", {
          cx: x(step.candidate),
          cy: y(step.value),
          r: 8,
          class: "candidate-dot",
        }),
      );
    }
  }

  const xTitle = svgElement("text", {
    x: margin.left + plotW / 2,
    y: height - 1,
    "text-anchor": "middle",
    class: "axis-title",
  });
  xTitle.textContent = `${currentDefinition.label} (${currentDefinition.unit})`;
  const yTitle = svgElement("text", {
    x: 13,
    y: margin.top + plotH / 2,
    transform: `rotate(-90 13 ${margin.top + plotH / 2})`,
    "text-anchor": "middle",
    class: "axis-title",
  });
  yTitle.textContent =
    currentDefinition.resultLabel === "participation" ? "Participation" : "Offered coupon p.a.";
  svg.append(xTitle, yTitle);
}

function renderSnapshot(): void {
  $("#snapshot-note").textContent = `${snapshot.note} Snapshot date ${snapshot.asOf}.`;
  const body = $("#snapshot-body") as HTMLTableSectionElement;
  body.innerHTML = snapshot.underlyings
    .map((underlying) => {
      const curve = curveFor(underlying);
      return `<tr>
        <th scope="row">${underlying.name}</th>
        <td>${underlying.currency}</td>
        <td>${underlying.spot.toLocaleString()}</td>
        <td>${percent(underlying.dividendYield * 100, 1)}</td>
        <td>${percent(zeroRate(curve, 1) * 100, 2)} / ${percent(zeroRate(curve, 3) * 100, 2)}</td>
        <td>${percent(atmVolatility(underlying, 1) * 100, 1)} / ${percent(atmVolatility(underlying, 3) * 100, 1)}</td>
        <td>${percent((impliedVolatility(underlying, 1, 0.9) - atmVolatility(underlying, 1)) * 100, 1)}</td>
      </tr>`;
    })
    .join("");
}

function render(): void {
  renderControls();
  renderHeadline();
  renderSolveSummary();
  renderTable();
  renderChart();
  animateNextRender = false;
}

// ---------------------------------------------------------------------------
// Events.

function onInput(): void {
  readState();
  recompute();
}

Object.values(controls).forEach((control) => {
  control.addEventListener(control instanceof HTMLSelectElement ? "change" : "input", onInput);
});

function switchProduct(product: Product): void {
  state.product = product;
  state.tenor = tenorRanges[product].value;
  state.solveTarget = defaultTargets[product];
  if (product === "protected" && state.solveTarget === "cap") state.capEnabled = true;
  writeControls();
  recompute(true);
}

controls.solveTarget.addEventListener("change", () => {
  readState();
  if (state.solveTarget === "cap") {
    state.capEnabled = true;
    controls.capEnabled.checked = true;
  }
  recompute(true);
});

document.querySelectorAll<HTMLElement>(".segmented[data-state]").forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-value]");
    if (!button) return;
    const key = group.dataset.state as "product" | "volModel" | "barrierObservation";
    const value = button.dataset.value ?? "";
    if (key === "product") {
      switchProduct(value as Product);
      return;
    }
    if (key === "volModel") state.volModel = value as VolatilityModel;
    else state.barrierObservation = value as BarrierObservation;
    setSegmented(`#${group.id}`, value);
    recompute();
  });
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
    render();
  }
  $("#solve").textContent = "Pause solve";
  timer = window.setInterval(() => {
    visibleSteps += 1;
    animateNextRender = true;
    render();
    if (visibleSteps >= solution.steps.length) stopTimer();
  }, 620);
});

$("#restart").addEventListener("click", () => {
  stopTimer();
  visibleSteps = 0;
  render();
});

$("#reset").addEventListener("click", () => {
  state = { ...defaults };
  writeControls();
  recompute(true);
});

controls.underlying.replaceChildren(
  ...snapshot.underlyings.map((underlying) => {
    const option = document.createElement("option");
    option.value = underlying.id;
    option.textContent = `${underlying.name} (${underlying.currency})`;
    return option;
  }),
);
writeControls();
renderSnapshot();
render();
recompute(true, 0);
