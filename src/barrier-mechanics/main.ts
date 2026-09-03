import {
  barrierFor,
  directionForPath,
  evaluateBarrierScenario,
  pathPresets,
  STRIKE,
  type BarrierDirection,
  type BarrierScenario,
  type BarrierSwitch,
  type PathId,
  type VanillaType,
} from "./engine";

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const state: BarrierScenario = {
  direction: "down",
  barrierSwitch: "in",
  vanillaType: "put",
  pathId: "down-touch",
};

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function setText(selector: string, value: string): void {
  $(selector).textContent = value;
}

function money(value: number): string {
  return value ? value.toFixed(2) : "0.00";
}

function renderControls(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => {
    const key = button.dataset.choice as keyof BarrierScenario;
    const selected = state[key] === button.dataset.value;
    button.classList.toggle("on", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderChart(): void {
  const result = evaluateBarrierScenario(state);
  const path = pathPresets[state.pathId];
  const svg = $("#path-chart") as unknown as SVGSVGElement;
  const width = 900;
  const height = 350;
  const margin = { left: 58, right: 30, top: 26, bottom: 48 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const x = (index: number) => margin.left + (index / (path.prices.length - 1)) * plotWidth;
  const y = (price: number) => margin.top + ((140 - price) / 80) * plotHeight;

  svg.replaceChildren();
  const title = svgElement("title", {});
  title.textContent = `${result.name}: ${path.label}`;
  const description = svgElement("desc", {});
  description.textContent = result.touched
    ? `The underlying reaches the ${result.barrier} barrier at step ${(result.touchIndex ?? 0) + 1}.`
    : `The underlying never reaches the ${result.barrier} barrier.`;
  svg.append(title, description);

  [60, 80, 100, 120, 140].forEach((level) => {
    const line = svgElement("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: y(level),
      y2: y(level),
      class: level === STRIKE ? "strike-line" : "grid-line",
    });
    const label = svgElement("text", {
      x: margin.left - 12,
      y: y(level) + 4,
      class: "axis-label",
      "text-anchor": "end",
    });
    label.textContent = String(level);
    svg.append(line, label);
  });

  const barrierDirections: BarrierDirection[] =
    state.direction === "down" ? ["up", "down"] : ["down", "up"];

  barrierDirections.forEach((direction) => {
    const barrier = barrierFor(direction);
    const contextClass = direction === state.direction ? "" : " context";
    const barrierLine = svgElement("line", {
      x1: margin.left,
      x2: width - margin.right,
      y1: y(barrier),
      y2: y(barrier),
      class: `barrier-line ${direction}${contextClass}`,
    });
    const barrierLabel = svgElement("text", {
      x: width - margin.right,
      y: y(barrier) - 9,
      class: `barrier-label ${direction}${contextClass}`,
      "text-anchor": "end",
    });
    barrierLabel.textContent = `${direction === "down" ? "Lower" : "Upper"} barrier ${barrier}`;
    svg.append(barrierLine, barrierLabel);
  });

  const pathLine = svgElement("polyline", {
    points: path.prices.map((price, index) => `${x(index)},${y(price)}`).join(" "),
    class: "price-path",
  });
  svg.append(pathLine);

  path.prices.forEach((price, index) => {
    const isTouch = index === result.touchIndex;
    const point = svgElement("circle", {
      cx: x(index),
      cy: y(price),
      r: isTouch ? 7 : index === path.prices.length - 1 ? 6 : 3.5,
      class: isTouch ? "path-point touch" : "path-point",
    });
    svg.append(point);
    if (isTouch) {
      const touchLabel = svgElement("text", {
        x: x(index),
        y: y(price) + (state.direction === "down" ? 27 : -16),
        class: "touch-label",
        "text-anchor": "middle",
      });
      touchLabel.textContent = "touch — state changes here";
      svg.append(touchLabel);
    }
  });

  const maturity = svgElement("text", {
    x: width - margin.right,
    y: height - 14,
    class: "axis-title",
    "text-anchor": "end",
  });
  maturity.textContent = `Maturity · final ${result.finalPrice}`;
  svg.append(maturity);
}

function renderResult(): void {
  const result = evaluateBarrierScenario(state);
  const pairedSwitch = state.barrierSwitch === "in" ? "out" : "in";
  const paired = evaluateBarrierScenario({ ...state, barrierSwitch: pairedSwitch });

  setText("#scenario-name", result.name);
  setText("#path-description", pathPresets[state.pathId].label);
  setText("#start-state", result.startsActive ? "Active" : "Dormant");
  setText("#touch-state", result.touched ? "Touched" : "Not touched");
  setText(
    "#touch-explanation",
    result.touched
      ? `${state.direction === "down" ? "Price fell to or below" : "Price rose to or above"} ${result.barrier}. That event is now remembered.`
      : `Price never ${state.direction === "down" ? "fell to" : "rose to"} the ${result.barrier} barrier, so no switch occurred.`,
  );
  setText("#maturity-state", result.activeAtMaturity ? "Active" : "Inactive");
  setText(
    "#maturity-explanation",
    result.activeAtMaturity
      ? `The ${state.vanillaType} survives to maturity, so the strike decides its payoff.`
      : `The ${state.vanillaType} is not alive at maturity, so its payoff is zero.`,
  );
  setText("#vanilla-payoff", money(result.vanillaPayoff));
  setText("#barrier-payoff", money(result.barrierPayoff));
  setText("#selected-parity-label", `${result.name} payoff`);
  setText(
    "#paired-parity-label",
    `${state.direction === "down" ? "Down" : "Up"}-and-${pairedSwitch} ${state.vanillaType} payoff`,
  );
  setText("#selected-parity", money(result.barrierPayoff));
  setText("#paired-parity", money(paired.barrierPayoff));
  setText("#vanilla-parity", money(result.vanillaPayoff));
  const stateChip = $("#state-chip");
  stateChip.textContent = result.activeAtMaturity ? "Option alive at maturity" : "Option inactive";
  stateChip.classList.toggle("alive", result.activeAtMaturity);
  stateChip.classList.toggle("inactive", !result.activeAtMaturity);
}

function render(): void {
  renderControls();
  renderChart();
  renderResult();
}

document.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.choice as keyof BarrierScenario;
    const value = button.dataset.value;
    if (!value) return;
    if (key === "direction") state.direction = value as BarrierDirection;
    if (key === "barrierSwitch") state.barrierSwitch = value as BarrierSwitch;
    if (key === "vanillaType") state.vanillaType = value as VanillaType;
    if (key === "pathId") {
      state.pathId = value as PathId;
      const matchingDirection = directionForPath(state.pathId);
      if (matchingDirection) state.direction = matchingDirection;
    }
    render();
  });
});

render();
