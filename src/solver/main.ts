import {
  candidateBounds,
  priceAtCandidate,
  priceIncreasesWithCandidate,
  solveVariable,
} from "./engine";
import type { SolveVariable, SolverInputs, SolverSolution, SolverStep } from "./engine";
import type { OptionType } from "../option-lab/types";

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const defaults = {
  type: "call" as OptionType,
  solveFor: "strike" as SolveVariable,
  target: 8.5,
  S: 100,
  K: 100,
  v: 0.25,
  T: 1,
  r: 0.03,
  q: 0.01,
};

let state = { ...defaults };
let solution: SolverSolution = solveVariable(state);
let visibleSteps = 0;
let timer: number | undefined;
let animateNextRender = false;
let previousChartVisual: ChartVisual | undefined;

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

const format2 = (value: number) => value.toFixed(2);

function readInputs(): SolverInputs {
  return {
    type: state.type,
    solveFor: state.solveFor,
    target: Number(controls.target.value),
    S: Number(controls.spot.value),
    K: Number(controls.strike.value),
    v: Number(controls.vol.value) / 100,
    T: Number(controls.expiry.value),
    r: Number(controls.rate.value) / 100,
    q: Number(controls.dividend.value) / 100,
  };
}

function stopTimer(): void {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  $("#solve").textContent = "Solve automatically";
}

function resetTrail(): void {
  stopTimer();
  state = readInputs();
  solution = solveVariable(state);
  visibleSteps = 0;
  animateNextRender = false;
  previousChartVisual = undefined;
  render();
}

function currentStep(): SolverStep | undefined {
  return solution.steps[Math.max(0, visibleSteps - 1)];
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
} as const;

function formatCandidate(value: number): string {
  return state.solveFor === "volatility" ? `${(value * 100).toFixed(1)}%` : value.toFixed(2);
}

function formatAxisCandidate(value: number): string {
  return state.solveFor === "volatility" ? `${(value * 100).toFixed(0)}%` : value.toFixed(0);
}

function renderOutputs(): void {
  const meta = variableMeta[state.solveFor];
  $("#target-out").textContent = format2(state.target);
  $("#spot-out").textContent = state.S.toFixed(0);
  $("#strike-out").textContent = state.K.toFixed(0);
  $("#vol-out").textContent = `${(state.v * 100).toFixed(0)}%`;
  $("#expiry-out").textContent = `${state.T.toFixed(2)}y`;
  $("#rate-out").textContent = `${(state.r * 100).toFixed(1)}%`;
  $("#dividend-out").textContent = `${(state.q * 100).toFixed(1)}%`;
  $("#target-summary").textContent = format2(state.target);
  $("#equation-target").textContent = format2(state.target);
  $("#equation-type").textContent = state.type === "call" ? "Call price" : "Put price";
  $("#solve-heading").textContent = `Solve for ${meta.label}`;
  $("#solved-label").textContent = meta.solvedLabel;
  $("#equation-inputs").innerHTML = meta.inputs;
  $("#equation-explanation").textContent = meta.explanation;
  $("#lower-label").textContent = `Lower ${meta.label}`;
  $("#upper-label").textContent = `Upper ${meta.label}`;
  $("#test-variable-heading").textContent = `Test ${meta.symbol}`;
  document.querySelectorAll<HTMLElement>("[data-input]").forEach((row) => {
    row.classList.toggle("is-hidden", row.dataset.input === state.solveFor);
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
  $("#candidate-price").textContent = step ? format2(step.price) : "—";
  $("#error-summary").textContent = step ? Math.abs(step.error).toFixed(4) : "—";
  $("#iteration-summary").textContent = String(visibleSteps);
  $("#step").toggleAttribute(
    "disabled",
    visibleSteps >= solution.steps.length || !solution.steps.length,
  );
  $("#solve").toggleAttribute("disabled", !solution.steps.length);

  const pill = $("#status-pill");
  pill.classList.toggle("solved", complete);
  pill.textContent = complete
    ? `Solved in ${solution.steps.length} steps`
    : visibleSteps
      ? `Step ${visibleSteps} of ${solution.steps.length}`
      : "Ready to solve";

  if (!solution.steps.length) {
    $("#action-note").textContent =
      "The target is outside the current search range. Lower the target premium or raise spot.";
  } else if (complete) {
    $("#action-note").textContent =
      `The model price is within 0.005 of the ${format2(state.target)} target.`;
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

  if (!step) {
    $("#decision-copy").textContent = "The first step will test the middle of the starting range.";
    return;
  }
  if (step.converged) {
    $("#decision-copy").textContent =
      `The price ${format2(step.price)} is close enough to the target. The search stops.`;
    return;
  }
  const comparison = step.price > state.target ? "above" : "below";
  const increasing = priceIncreasesWithCandidate(state);
  const candidateTooLow = increasing ? step.price < state.target : step.price > state.target;
  const variable = variableMeta[state.solveFor].label;
  const implication = `The ${variable} is too ${candidateTooLow ? "low" : "high"}, so discard the ${candidateTooLow ? "lower" : "upper"} half.`;
  $("#decision-copy").textContent =
    `${format2(step.price)} is ${comparison} ${format2(state.target)}. ${implication}`;

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
    body.innerHTML =
      '<tr class="empty-row"><td colspan="6">No guesses yet. Take the first step above.</td></tr>';
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
        <td>${format2(step.price)}</td>
        <td>${step.error >= 0 ? "+" : ""}${step.error.toFixed(4)}</td>
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
  const width = 900;
  const height = 350;
  const margin = { top: 22, right: 24, bottom: 46, left: 58 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const [minCandidate, maxCandidate] = candidateBounds(state);
  const samples = Array.from({ length: 101 }, (_, index) => {
    const candidate = minCandidate + ((maxCandidate - minCandidate) * index) / 100;
    return { candidate, price: priceAtCandidate(state, candidate) };
  });
  const maxPrice = Math.max(state.target * 1.2, ...samples.map((point) => point.price)) * 1.04;
  const x = (candidate: number) =>
    margin.left + ((candidate - minCandidate) / (maxCandidate - minCandidate)) * plotW;
  const y = (price: number) => margin.top + plotH - (price / maxPrice) * plotH;
  svg.replaceChildren();

  const svgTitle = svgElement("title", { id: "chart-title" });
  svgTitle.textContent = `Option price by ${variableMeta[state.solveFor].label}`;
  const svgDescription = svgElement("desc", { id: "chart-description" });
  svgDescription.textContent = `A curve showing option value across candidate ${variableMeta[state.solveFor].label} values, the target price, and the solver's current bracket.`;
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
    label.textContent = price.toFixed(0);
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
  const lower = step?.lower ?? minCandidate;
  const upper = step?.upper ?? maxCandidate;
  const currentVisual: ChartVisual = {
    lower: { x: x(lower), y: y(priceAtCandidate(state, lower)) },
    upper: { x: x(upper), y: y(priceAtCandidate(state, upper)) },
    midpoint: step ? { x: x(step.midpoint), y: y(step.price) } : undefined,
  };
  const bracketZone = svgElement("rect", {
    x: String(currentVisual.lower.x),
    y: String(margin.top),
    width: String(Math.max(0, currentVisual.upper.x - currentVisual.lower.x)),
    height: String(plotH),
    class: "bracket-zone",
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
  targetLabel.textContent = `TARGET ${format2(state.target)}`;
  svg.append(targetLabel);

  const bracketLine = svgElement("line", {
    x1: String(currentVisual.lower.x),
    x2: String(currentVisual.upper.x),
    y1: String(currentVisual.lower.y),
    y2: String(currentVisual.upper.y),
    class: "bracket-line",
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
  svg.append(bracketLine, lowerDot, upperDot);

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
    bracketLine.animate([{ opacity: 0.15 }, { opacity: 1 }], {
      duration: 460,
      easing: "ease-out",
    });
    bracketZone.animate(
      [
        { opacity: 0.03, transform: "scaleY(.86)" },
        { opacity: 1, transform: "scaleY(1)" },
      ],
      { duration: 500, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    if (candidateDot && currentVisual.midpoint) {
      const origin = previousChartVisual.midpoint ?? {
        x: (previousChartVisual.lower.x + previousChartVisual.upper.x) / 2,
        y: currentVisual.midpoint.y,
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

Object.values(controls).forEach((control) => control.addEventListener("input", resetTrail));

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
  document.querySelectorAll<HTMLButtonElement>("#option-type button").forEach((button) => {
    const on = button.dataset.value === defaults.type;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  resetTrail();
});

render();
