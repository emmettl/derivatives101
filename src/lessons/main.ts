import {
  evaluate as evaluateBasket,
  generatePaths as generateBasketPaths,
  type BasketParams,
  type BasketScenario,
} from "../basket/engine";
import {
  evaluate as evaluateKoda,
  generatePath as generateKodaPath,
  type KodaParams,
  type KodaScenario,
} from "../koda-kodd/engine";
import { redemption, type ParticipationPayoffParams } from "../participation/engine";
import {
  evaluate as evaluateStructured,
  generatePath as generateStructuredPath,
  type ReverseConvertibleParams,
  type StructuredScenario,
} from "../structured/engine";
import { strategyCurve, vanillaPrice } from "../strategy/engine";
import type { Market, OptionLeg, Side } from "../strategy/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 760;
const HEIGHT = 340;
const MARGIN = { left: 56, right: 22, top: 22, bottom: 45 };
const colors = ["#3e8e7e", "#b87e24", "#2c5670"];

type Point = readonly [number, number];
type Series = { points: Point[]; className?: string; color?: string };
type Guide = { value: number; label: string; color?: string };

function byId<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing lesson element #${id}`);
  return element as unknown as T;
}

function value(id: string): number {
  return Number(byId<HTMLInputElement>(id).value);
}

function setText(id: string, content: string): void {
  byId(id).textContent = content;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  content?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, attribute]) =>
    element.setAttribute(key, String(attribute)),
  );
  if (content != null) element.textContent = content;
  return element;
}

function path(points: Point[], x: (n: number) => number, y: (n: number) => number): string {
  return points
    .map(([px, py], index) => `${index ? "L" : "M"}${x(px).toFixed(2)},${y(py).toFixed(2)}`)
    .join(" ");
}

function drawChart(
  series: Series[],
  options: {
    xRange: readonly [number, number];
    yRange?: readonly [number, number];
    xLabel: string;
    yLabel: string;
    guides?: Guide[];
    xFormat?: (n: number) => string;
    yFormat?: (n: number) => string;
  },
): void {
  const chart = byId<SVGSVGElement>("lesson-chart");
  chart.replaceChildren();
  const values = series.flatMap((entry) => entry.points.map((point) => point[1]));
  const rawMinimum = Math.min(...values, 0);
  const rawMaximum = Math.max(...values, 1);
  const padding = Math.max(1, (rawMaximum - rawMinimum) * 0.12);
  const yRange = options.yRange ?? ([rawMinimum - padding, rawMaximum + padding] as const);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (input: number) =>
    MARGIN.left +
    ((input - options.xRange[0]) / (options.xRange[1] - options.xRange[0])) * plotWidth;
  const y = (input: number) =>
    MARGIN.top + ((yRange[1] - input) / (yRange[1] - yRange[0])) * plotHeight;
  const xFormat = options.xFormat ?? ((input: number) => input.toFixed(0));
  const yFormat = options.yFormat ?? ((input: number) => input.toFixed(0));

  for (let index = 0; index <= 4; index += 1) {
    const yValue = yRange[0] + ((yRange[1] - yRange[0]) * index) / 4;
    chart.append(
      svgElement("line", {
        x1: MARGIN.left,
        x2: WIDTH - MARGIN.right,
        y1: y(yValue),
        y2: y(yValue),
        class: "chart-grid",
      }),
      svgElement(
        "text",
        { x: MARGIN.left - 9, y: y(yValue) + 4, "text-anchor": "end", class: "chart-axis" },
        yFormat(yValue),
      ),
    );
  }
  for (let index = 0; index <= 4; index += 1) {
    const xValue = options.xRange[0] + ((options.xRange[1] - options.xRange[0]) * index) / 4;
    chart.append(
      svgElement("line", {
        x1: x(xValue),
        x2: x(xValue),
        y1: MARGIN.top,
        y2: HEIGHT - MARGIN.bottom,
        class: "chart-grid",
      }),
      svgElement(
        "text",
        {
          x: x(xValue),
          y: HEIGHT - MARGIN.bottom + 19,
          "text-anchor": "middle",
          class: "chart-axis",
        },
        xFormat(xValue),
      ),
    );
  }

  options.guides?.forEach((guide) => {
    chart.append(
      svgElement("line", {
        x1: MARGIN.left,
        x2: WIDTH - MARGIN.right,
        y1: y(guide.value),
        y2: y(guide.value),
        class: "chart-guide",
        stroke: guide.color ?? "#b5443a",
      }),
      svgElement(
        "text",
        {
          x: WIDTH - MARGIN.right - 5,
          y: y(guide.value) - 7,
          "text-anchor": "end",
          class: "chart-label",
          fill: guide.color ?? "#b5443a",
        },
        guide.label,
      ),
    );
  });

  series.forEach((entry, index) =>
    chart.append(
      svgElement("path", {
        d: path(entry.points, x, y),
        class: `chart-line ${entry.className ?? ""}`,
        stroke: entry.color ?? colors[index % colors.length],
      }),
    ),
  );
  chart.append(
    svgElement(
      "text",
      {
        x: MARGIN.left + plotWidth / 2,
        y: HEIGHT - 7,
        "text-anchor": "middle",
        class: "chart-axis",
      },
      options.xLabel,
    ),
    svgElement(
      "text",
      {
        x: 14,
        y: MARGIN.top + plotHeight / 2,
        "text-anchor": "middle",
        class: "chart-axis",
        transform: `rotate(-90 14 ${MARGIN.top + plotHeight / 2})`,
      },
      options.yLabel,
    ),
  );
}

function onInputs(ids: string[], render: () => void): void {
  ids.forEach((id) => {
    const element = byId<HTMLInputElement | HTMLSelectElement>(id);
    element.addEventListener(element instanceof HTMLSelectElement ? "change" : "input", render);
  });
}

function initFoundations(): void {
  const render = () => {
    const mode = byId<HTMLSelectElement>("foundation-position").value;
    const strike = value("foundation-strike");
    const volatility = value("foundation-volatility") / 100;
    const market: Market = { spot: 100, volatility, tenor: 1, rate: 0.03, dividend: 0.01 };
    const side: Side = mode === "long-call" ? "long" : "short";
    const leg: OptionLeg = {
      id: 1,
      enabled: true,
      side,
      quantity: 1,
      type: mode === "long-call" ? "call" : "put",
      strike,
      barrierType: "none",
      barrier: 0,
    };
    const curve = strategyCurve(market, [leg], 0, 200, 40, 160, 121);
    const premium = Math.abs(curve[0].netPremium);
    drawChart([{ points: curve.map((point) => [point.terminalSpot, point.pnl] as const) }], {
      xRange: [40, 160],
      xLabel: "Underlying at expiry",
      yLabel: "Profit / loss",
      guides: [{ value: 0, label: "break-even" }],
    });
    setText("foundation-strike-value", strike.toFixed(0));
    setText("foundation-volatility-value", `${(volatility * 100).toFixed(0)}%`);
    setText("stat-1", premium.toFixed(2));
    setText("stat-2", mode === "long-call" ? "Right to buy" : "Obligation to buy");
    setText("stat-3", mode === "long-call" ? "Unlimited" : "Premium only");
    setText("stat-4", mode === "long-call" ? "Premium paid" : "Strike less premium");
  };
  onInputs(["foundation-position", "foundation-strike", "foundation-volatility"], render);
  render();
}

function initKoda(): void {
  const render = () => {
    const scenario = byId<HTMLSelectElement>("koda-scenario").value as KodaScenario;
    const params: KodaParams = {
      kind: "koda",
      strike: value("koda-strike"),
      knockOut: 105,
      baseUnits: 10,
      gearing: value("koda-gearing"),
      tenor: 0.5,
      frequency: 1,
      guaranteed: 0,
      vol: 30,
    };
    const pathValues = generateKodaPath({ ...params, scenario, seed: 5197 });
    const result = evaluateKoda(pathValues, params);
    const step = Math.max(1, Math.round(pathValues.length / 180));
    const points: Point[] = [];
    for (let day = 0; day < pathValues.length; day += step) points.push([day, pathValues[day]]);
    points.push([pathValues.length - 1, pathValues.at(-1) ?? 0]);
    drawChart([{ points }], {
      xRange: [0, pathValues.length - 1],
      yRange: [45, 115],
      xLabel: "Trading day",
      yLabel: "Underlying (% of initial)",
      guides: [
        { value: params.strike, label: "gearing starts", color: "#b87e24" },
        { value: params.knockOut, label: "knock-out", color: "#3e8e7e" },
      ],
    });
    setText("koda-strike-value", params.strike.toFixed(0));
    setText("koda-gearing-value", `${params.gearing.toFixed(1)}×`);
    setText("stat-1", result.knockedOut ? `Day ${result.knockOutDay}` : "No");
    setText("stat-2", result.executedFixings.toFixed(0));
    setText("stat-3", result.totalUnits.toLocaleString());
    setText("stat-4", `${result.pnlPercent.toFixed(1)}%`);
  };
  onInputs(["koda-scenario", "koda-strike", "koda-gearing"], render);
  render();
}

function initReverseConvertible(): void {
  const render = () => {
    const scenario = byId<HTMLSelectElement>("rc-scenario").value as StructuredScenario;
    const params: ReverseConvertibleParams = {
      variant: "barrier",
      coupon: value("rc-coupon"),
      barrier: value("rc-barrier"),
      barrierObservation: "daily",
      settlement: "cash",
      tenor: 3,
      frequency: 4,
      vol: 30,
    };
    const pathValues = generateStructuredPath({ scenario, tenor: params.tenor, vol: params.vol });
    const result = evaluateStructured("rc", pathValues, params);
    const step = Math.max(1, Math.round(pathValues.length / 180));
    const points: Point[] = [];
    for (let day = 0; day < pathValues.length; day += step) points.push([day, pathValues[day]]);
    points.push([pathValues.length - 1, pathValues.at(-1) ?? 0]);
    drawChart([{ points }], {
      xRange: [0, pathValues.length - 1],
      yRange: [40, 145],
      xLabel: "Trading day",
      yLabel: "Underlying (% of initial)",
      guides: [{ value: params.barrier ?? 0, label: "knock-in barrier" }],
    });
    setText("rc-barrier-value", `${params.barrier}%`);
    setText("rc-coupon-value", `${params.coupon}%`);
    setText("stat-1", result.barrierBreached ? "Breached" : "Intact");
    setText("stat-2", result.principal.toFixed(1));
    setText("stat-3", result.coupons.toFixed(1));
    setText("stat-4", `${result.totalReturn.toFixed(1)}%`);
  };
  onInputs(["rc-scenario", "rc-barrier", "rc-coupon"], render);
  render();
}

function initBasket(): void {
  let seed = 8431;
  const render = () => {
    const scenario = byId<HTMLSelectElement>("basket-scenario").value as BasketScenario;
    const correlation = value("basket-correlation");
    const params: BasketParams = {
      basis: "worst",
      coupon: 12,
      couponLevel: 0,
      autocall: false,
      callLevel: 100,
      barrier: value("basket-barrier"),
      settlement: "physical",
      tenor: 0.5,
      frequency: 12,
      vol: 34,
      correlation,
    };
    const paths = generateBasketPaths({
      scenario,
      correlation,
      tenor: params.tenor,
      vol: params.vol,
      seed,
    });
    const result = evaluateBasket(paths, params);
    const step = Math.max(1, Math.round(paths[0].length / 180));
    const series = paths.map((assetPath, index) => {
      const points: Point[] = [];
      for (let day = 0; day < assetPath.length; day += step) points.push([day, assetPath[day]]);
      points.push([assetPath.length - 1, assetPath.at(-1) ?? 0]);
      return { points, color: colors[index] };
    });
    drawChart(series, {
      xRange: [0, paths[0].length - 1],
      yRange: [35, 155],
      xLabel: "Trading day",
      yLabel: "Basket constituents (% of initial)",
      guides: [{ value: params.barrier, label: "principal barrier" }],
    });
    setText("basket-correlation-value", `${correlation}%`);
    setText("basket-barrier-value", `${params.barrier}%`);
    setText("stat-1", result.worstName);
    setText("stat-2", result.terminalReference.toFixed(1));
    setText("stat-3", result.coupons.toFixed(1));
    setText("stat-4", `${result.totalReturn.toFixed(1)}%`);
  };
  onInputs(["basket-scenario", "basket-correlation", "basket-barrier"], render);
  const resample = document.getElementById("basket-resample");
  resample?.addEventListener("click", () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    render();
  });
  render();
}

function initParticipation(): void {
  const render = () => {
    const product = byId<HTMLSelectElement>("participation-product")
      .value as ParticipationPayoffParams["product"];
    const params: ParticipationPayoffParams = {
      product,
      participation: value("participation-rate") / 100,
      bonus: value("participation-bonus"),
    };
    const levels = Array.from({ length: 141 }, (_, index) => 30 + index);
    const intact = levels.map((level) => [level, redemption(level, false, params)] as const);
    const breached = levels.map((level) => [level, redemption(level, true, params)] as const);
    drawChart(
      [
        { points: intact, color: "#3e8e7e" },
        { points: breached, color: "#b5443a" },
      ],
      {
        xRange: [30, 170],
        yRange: [30, 190],
        xLabel: "Underlying at maturity",
        yLabel: "Redemption",
        guides: [{ value: 100, label: "initial level", color: "#64798a" }],
      },
    );
    const sample = 85;
    setText("participation-rate-value", `${(params.participation * 100).toFixed(0)}%`);
    setText("participation-bonus-value", params.bonus.toFixed(0));
    setText("stat-1", redemption(sample, false, params).toFixed(1));
    setText("stat-2", redemption(sample, true, params).toFixed(1));
    setText("stat-3", product === "outperformance" ? "None" : params.bonus.toFixed(0));
    setText("stat-4", product === "bonus" ? "1.00×" : `${params.participation.toFixed(2)}×`);
  };
  onInputs(["participation-product", "participation-rate", "participation-bonus"], render);
  render();
}

function capitalProtectedTerms(rate: number, protection: number, fee: number) {
  const tenor = 5;
  const market: Market = {
    spot: 100,
    volatility: 0.2,
    tenor,
    rate: Math.log(1 + rate),
    dividend: 0.02,
  };
  const floor = protection / Math.pow(1 + rate, tenor);
  const budget = 100 - floor - fee;
  const call = vanillaPrice(market, "call", 100);
  return { floor, budget, call, participation: Math.max(0, budget / call) };
}

function initProtection(): void {
  const render = () => {
    const rate = value("protection-rate") / 100;
    const protection = value("protection-level");
    const fee = value("protection-fee");
    const points: Point[] = [];
    for (let percent = 0; percent <= 8; percent += 0.1) {
      points.push([percent, capitalProtectedTerms(percent / 100, protection, fee).participation]);
    }
    const terms = capitalProtectedTerms(rate, protection, fee);
    drawChart([{ points }], {
      xRange: [0, 8],
      yRange: [0, Math.max(2.5, ...points.map((point) => point[1]))],
      xLabel: "Issuer funding rate",
      yLabel: "Equity participation",
      xFormat: (input) => `${input.toFixed(0)}%`,
      yFormat: (input) => `${input.toFixed(1)}×`,
      guides: [{ value: 1, label: "1-for-1 participation", color: "#64798a" }],
    });
    setText("protection-rate-value", `${(rate * 100).toFixed(1)}%`);
    setText("protection-level-value", `${protection}%`);
    setText("protection-fee-value", fee.toFixed(1));
    setText("stat-1", terms.floor.toFixed(1));
    setText("stat-2", terms.budget.toFixed(1));
    setText("stat-3", terms.call.toFixed(1));
    setText("stat-4", `${terms.participation.toFixed(2)}×`);
  };
  onInputs(["protection-rate", "protection-level", "protection-fee"], render);
  render();
}

function initQuizzes(): void {
  document.querySelectorAll<HTMLElement>(".quiz").forEach((quiz) => {
    const feedback = quiz.querySelector<HTMLElement>(".quiz-feedback");
    quiz.querySelectorAll<HTMLButtonElement>(".quiz-options button").forEach((button) => {
      button.addEventListener("click", () => {
        quiz.querySelectorAll<HTMLButtonElement>(".quiz-options button").forEach((option) => {
          option.classList.remove("correct", "incorrect");
          option.removeAttribute("aria-pressed");
        });
        const correct = button.dataset.correct === "true";
        button.classList.add(correct ? "correct" : "incorrect");
        button.setAttribute("aria-pressed", "true");
        if (feedback)
          feedback.textContent = correct
            ? (button.dataset.feedback ?? "Correct.")
            : (button.dataset.feedback ?? "Not quite. Try the chart, then choose again.");
      });
    });
  });
}

function initGlossary(): void {
  const input = document.getElementById("glossary-search") as HTMLInputElement | null;
  if (!input) return;
  const entries = [...document.querySelectorAll<HTMLElement>(".glossary-entry")];
  const count = byId("glossary-count");
  const render = () => {
    const query = input.value.trim().toLocaleLowerCase();
    let visible = 0;
    entries.forEach((entry) => {
      const match = !query || (entry.textContent ?? "").toLocaleLowerCase().includes(query);
      entry.hidden = !match;
      if (match) visible += 1;
    });
    count.textContent = `${visible} ${visible === 1 ? "term" : "terms"}`;
  };
  input.addEventListener("input", render);
  render();
}

initQuizzes();
initGlossary();

switch (document.body.dataset.lesson) {
  case "foundations":
    initFoundations();
    break;
  case "koda":
    initKoda();
    break;
  case "reverse-convertibles":
    initReverseConvertible();
    break;
  case "fcn":
    initBasket();
    break;
  case "discount-bonus":
    initParticipation();
    break;
  case "protection-leverage":
    initProtection();
    break;
}
