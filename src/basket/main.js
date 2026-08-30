"use strict";

import * as BasketEngine from "./engine.ts";

const $ = (id) => document.getElementById(id),
  colors = {
    ink: "#0b1e2d",
    deep: "#123b54",
    steel: "#2c5670",
    amber: "#d99124",
    jade: "#3e8e7e",
    brick: "#b5443a",
    muted: "#64798a",
    line: "#d3dbe2",
  };
const config = {
  defaults: {
    basis: "worst",
    coupon: 10,
    couponLevel: 70,
    autocall: true,
    callLevel: 100,
    barrier: 60,
    settlement: "physical",
    tenor: 3,
    frequency: 4,
    vol: 30,
    correlation: 45,
  },
  scenarios: [
    ["random", "Random"],
    ["rally", "Together rally"],
    ["break", "One name breaks"],
    ["diverge", "Diverge"],
    ["selloff", "Joint sell-off"],
  ],
  controls: [
    {
      key: "basis",
      type: "select",
      label: "Contractual reference",
      options: [
        ["worst", "Worst-performing underlying"],
        ["average", "Equal-weight average"],
      ],
    },
    {
      key: "coupon",
      type: "range",
      label: "Conditional coupon",
      min: 0,
      max: 24,
      step: 0.5,
      format: (v) => v.toFixed(1) + "% p.a.",
    },
    {
      key: "couponLevel",
      type: "range",
      label: "Coupon trigger",
      min: 40,
      max: 100,
      step: 1,
      format: (v) => v.toFixed(0) + "%",
    },
    {
      key: "autocall",
      type: "radio",
      boolean: true,
      label: "Early redemption",
      options: [
        [false, "No autocall"],
        [true, "Autocall"],
      ],
    },
    {
      key: "callLevel",
      type: "range",
      label: "Autocall trigger",
      min: 80,
      max: 130,
      step: 1,
      format: (v) => v.toFixed(0) + "%",
      show: (p) => p.autocall,
    },
    {
      key: "barrier",
      type: "range",
      label: "Maturity barrier",
      min: 30,
      max: 90,
      step: 1,
      format: (v) => v.toFixed(0) + "%",
    },
    {
      key: "settlement",
      type: "radio",
      label: "Worst-of downside settlement",
      options: [
        ["cash", "Cash amount"],
        ["physical", "Worst name units"],
      ],
      show: (p) => p.basis === "worst",
      help: "The equal-weight basket is cash-settled in this lab. Physical worst-of delivery uses 100 nominal ÷ initial level 100 = 1.000 unit.",
    },
    {
      key: "tenor",
      type: "range",
      label: "Scheduled tenor",
      min: 1,
      max: 5,
      step: 1,
      format: (v) => v.toFixed(0) + " years",
    },
    {
      key: "frequency",
      type: "select",
      numeric: true,
      label: "Observation frequency",
      options: [
        [4, "Quarterly"],
        [12, "Monthly"],
      ],
    },
    {
      key: "vol",
      type: "range",
      label: "Volatility per underlying",
      min: 10,
      max: 70,
      step: 1,
      format: (v) => v.toFixed(0) + "% p.a.",
    },
    {
      key: "correlation",
      type: "range",
      label: "Pairwise correlation",
      min: 0,
      max: 95,
      step: 5,
      format: (v) => v.toFixed(0) + "%",
      help: "One common correlation is applied to every pair. It changes random paths and the statistical view; teaching presets keep their intended shape.",
    },
  ],
};
const state = { params: { ...config.defaults }, scenario: "random", seed: 904271 };
function svgEl(name, attrs = {}, text = "") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text) node.textContent = text;
  return node;
}
function money(value) {
  return (value >= 0 ? "" : "−") + Math.abs(value).toFixed(1);
}
function pct(value) {
  return (value * 100).toFixed(0) + "%";
}
function year(day) {
  const value = day / BasketEngine.DAYS;
  return value < 1 ? `Month ${Math.round(value * 12)}` : `Year ${value.toFixed(value % 1 ? 2 : 0)}`;
}

function renderControls() {
  const host = $("basket-controls");
  host.innerHTML = "";
  config.controls.forEach((control) => {
    const block = document.createElement("div");
    block.className = "control-block";
    block.dataset.control = control.key;
    if (control.type === "range") {
      const label = document.createElement("label");
      label.className = "range-control";
      label.htmlFor = `basket-${control.key}`;
      const head = document.createElement("span"),
        name = document.createElement("b"),
        output = document.createElement("output");
      name.textContent = control.label;
      output.id = `basket-output-${control.key}`;
      head.append(name, output);
      const input = document.createElement("input");
      input.type = "range";
      input.id = `basket-${control.key}`;
      input.min = control.min;
      input.max = control.max;
      input.step = control.step;
      input.value = state.params[control.key];
      input.addEventListener("input", () => {
        state.params[control.key] = Number(input.value);
        updateControlVisibility();
        scheduleRender();
      });
      label.append(head, input);
      block.append(label);
    } else if (control.type === "select") {
      const label = document.createElement("label");
      label.htmlFor = `basket-${control.key}`;
      label.textContent = control.label;
      const select = document.createElement("select");
      select.id = `basket-${control.key}`;
      control.options.forEach(([value, name]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = name;
        select.append(option);
      });
      select.value = String(state.params[control.key]);
      select.addEventListener("change", () => {
        state.params[control.key] = control.numeric ? Number(select.value) : select.value;
        updateControlVisibility();
        renderAll();
      });
      block.append(label, select);
    } else {
      const title = document.createElement("span");
      title.className = "control-title";
      title.textContent = control.label;
      const set = document.createElement("div");
      set.className = "radio-set";
      control.options.forEach(([raw, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        const value = control.boolean ? raw === true || raw === "true" : raw;
        button.textContent = label;
        const on = state.params[control.key] === value;
        button.classList.toggle("on", on);
        button.setAttribute("aria-pressed", String(on));
        button.addEventListener("click", () => {
          state.params[control.key] = value;
          set.querySelectorAll("button").forEach((x) => {
            const selected = x === button;
            x.classList.toggle("on", selected);
            x.setAttribute("aria-pressed", String(selected));
          });
          updateControlVisibility();
          renderAll();
        });
        set.append(button);
      });
      block.append(title, set);
    }
    if (control.help) {
      const help = document.createElement("p");
      help.className = "control-help";
      help.textContent = control.help;
      block.append(help);
    }
    host.append(block);
  });
  updateControlVisibility();
  updateOutputs();
}
function updateControlVisibility() {
  config.controls.forEach((control) => {
    const block = document.querySelector(`[data-control="${control.key}"]`);
    if (block) block.hidden = control.show ? !control.show(state.params) : false;
  });
  updateOutputs();
}
function updateOutputs() {
  config.controls
    .filter((control) => control.type === "range")
    .forEach((control) => {
      const output = $(`basket-output-${control.key}`);
      if (output) output.textContent = control.format(state.params[control.key]);
    });
}
function renderScenarios() {
  const host = $("basket-scenarios");
  host.innerHTML = "";
  config.scenarios.forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    const on = value === state.scenario;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    button.addEventListener("click", () => {
      state.scenario = value;
      renderScenarios();
      renderPath();
    });
    host.append(button);
  });
}
function updateBasis() {
  const worst = state.params.basis === "worst";
  $("basis-name").textContent = worst ? "Worst-of reference" : "Equal-weight basket";
  $("basis-description").textContent = worst
    ? "Coupon, autocall and barrier tests all use the weakest of the three normalised underlyings. Strength elsewhere is ignored."
    : "Coupon, autocall and barrier tests use the arithmetic average. Stronger constituents can offset a weaker one.";
}
function pathData() {
  const paths = BasketEngine.generatePaths({
    seed: state.seed,
    tenor: state.params.tenor,
    vol: state.params.vol,
    correlation: state.params.correlation,
    scenario: state.scenario,
  });
  return BasketEngine.evaluate(paths, state.params);
}
function pathD(values, start, end, X, Y) {
  const span = Math.max(1, end - start),
    step = Math.max(1, Math.floor(span / 420));
  let d = "";
  for (let day = start; day <= end; day += step)
    d += (d ? "L" : "M") + X(day).toFixed(1) + "," + Y(values[day]).toFixed(1);
  if ((end - start) % step) d += "L" + X(end).toFixed(1) + "," + Y(values[end]).toFixed(1);
  return d;
}
function drawPath(result) {
  const svg = $("basket-path-chart");
  svg.innerHTML = "";
  const end = result.paths[0].length - 1,
    referencePath = new Float64Array(end + 1);
  for (let day = 0; day <= end; day++)
    referencePath[day] = BasketEngine.reference(
      result.paths.map((path) => path[day]),
      state.params.basis,
    );
  const all = result.paths.flatMap((path) => Array.from(path)),
    refs = [
      state.params.barrier,
      state.params.couponLevel,
      ...(state.params.autocall ? [state.params.callLevel] : []),
    ],
    min = Math.max(0, Math.min(...all, ...refs) - 10),
    max = Math.max(...all, ...refs) + 10,
    m = { l: 54, r: 126, t: 24, b: 40 },
    w = 900,
    h = 380,
    X = (day) => m.l + (day / end) * (w - m.l - m.r),
    Y = (value) => m.t + ((max - value) / (max - min)) * (h - m.t - m.b);
  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4,
      y = Y(value);
    svg.append(
      svgEl("line", { x1: m.l, x2: w - m.r, y1: y, y2: y, class: "grid" }),
      svgEl(
        "text",
        { x: m.l - 8, y: y + 3, "text-anchor": "end", class: "axis" },
        value.toFixed(0) + "%",
      ),
    );
  }
  for (let yearIndex = 0; yearIndex <= state.params.tenor; yearIndex++) {
    const day = Math.round(yearIndex * BasketEngine.DAYS),
      x = X(day);
    svg.append(
      svgEl("line", { x1: x, x2: x, y1: m.t, y2: h - m.b, class: "grid" }),
      svgEl(
        "text",
        { x, y: h - 15, "text-anchor": "middle", class: "axis" },
        yearIndex ? `Y${yearIndex}` : "Start",
      ),
    );
  }
  const referenceLevels = [
    [state.params.barrier, "barrier", colors.brick, "5 4"],
    [state.params.couponLevel, "coupon", colors.amber, "6 4"],
  ];
  if (state.params.autocall)
    referenceLevels.push([state.params.callLevel, "autocall", colors.jade, "6 4"]);
  referenceLevels
    .sort((a, b) => a[0] - b[0])
    .forEach(([level, label, color, dash]) => {
      const y = Y(level);
      svg.append(
        svgEl("line", {
          x1: m.l,
          x2: w - m.r,
          y1: y,
          y2: y,
          stroke: color,
          "stroke-width": 1.1,
          "stroke-dasharray": dash,
        }),
        svgEl(
          "text",
          { x: w - m.r + 7, y: y + 3, fill: color, class: "level-label" },
          `${label} ${level}`,
        ),
      );
    });
  result.events.forEach((event) =>
    svg.append(
      svgEl("line", {
        x1: X(event.day),
        x2: X(event.day),
        y1: m.t,
        y2: h - m.b,
        stroke: colors.line,
        "stroke-width": 0.8,
        "stroke-opacity": 0.38,
      }),
    ),
  );
  const classes = ["basket-line-a", "basket-line-b", "basket-line-c"];
  result.paths.forEach((path, index) => {
    svg.append(
      svgEl("path", { d: pathD(path, 0, result.terminationDay, X, Y), class: classes[index] }),
    );
    if (result.terminationDay < end)
      svg.append(
        svgEl("path", {
          d: pathD(path, result.terminationDay, end, X, Y),
          class: `${classes[index]} basket-after`,
        }),
      );
  });
  svg.append(
    svgEl("path", {
      d: pathD(referencePath, 0, result.terminationDay, X, Y),
      class: "basket-reference",
    }),
  );
  if (result.terminationDay < end)
    svg.append(
      svgEl("path", {
        d: pathD(referencePath, result.terminationDay, end, X, Y),
        class: "basket-reference basket-after",
      }),
    );
  result.events.forEach((event) => {
    const important = event.state !== "Alive" || event.couponTest === "Miss";
    svg.append(
      svgEl("circle", {
        cx: X(event.day),
        cy: Y(event.reference),
        r: important ? 4.5 : 3,
        class: important ? "event-dot" : "observation",
        fill:
          event.state === "Redeemed early"
            ? colors.jade
            : event.couponTest === "Miss"
              ? colors.brick
              : colors.ink,
      }),
    );
  });
  const labels = [
      ...result.endLevels.map((level, index) => ({
        text: `${BasketEngine.NAMES[index]} ${level.toFixed(1)}`,
        level,
        color: [colors.amber, colors.jade, colors.brick][index],
      })),
      {
        text: `${state.params.basis === "worst" ? "Worst" : "Average"} ${result.endReference.toFixed(1)}`,
        level: result.endReference,
        color: colors.ink,
        bold: true,
      },
    ].sort((a, b) => b.level - a.level),
    positions = labels.map((label) => Y(label.level));
  for (let i = 1; i < positions.length; i++)
    positions[i] = Math.max(positions[i], positions[i - 1] + 13);
  const overflow = Math.max(0, positions.at(-1) - (h - m.b));
  if (overflow) for (let i = 0; i < positions.length; i++) positions[i] -= overflow;
  labels.forEach((label, index) =>
    svg.append(
      svgEl(
        "text",
        {
          x: w - m.r + 7,
          y: positions[index] + 3,
          fill: label.color,
          class: label.bold ? "basket-direct-label reference-label" : "basket-direct-label",
        },
        label.text,
      ),
    ),
  );
  svg.append(
    svgEl(
      "text",
      { x: (m.l + w - m.r) / 2, y: h - 2, "text-anchor": "middle", class: "axis" },
      "Time from issue",
    ),
  );
  svg.setAttribute(
    "aria-label",
    `Three underlying paths ending at ${result.endLevels.map((value) => value.toFixed(1)).join(", ")}; ${state.params.basis === "worst" ? "worst-of" : "average"} reference ${result.endReference.toFixed(1)}`,
  );
}
function renderRanking(result) {
  const host = $("terminal-ranking");
  host.innerHTML = "";
  result.ranking.forEach((item, index) => {
    const row = document.createElement("div"),
      rank = document.createElement("span"),
      name = document.createElement("b"),
      value = document.createElement("strong");
    row.className = `rank-asset rank-asset-${item.index}`;
    rank.textContent = String(index + 1);
    name.textContent = item.name;
    value.textContent = item.level.toFixed(1);
    row.append(rank, name, value);
    host.append(row);
  });
}
function outcomeText(result) {
  const referenceName =
    state.params.basis === "worst"
      ? `${result.endWorstName}, the weakest name`
      : `the equal-weight average`;
  if (result.called)
    return `The ${state.params.basis === "worst" ? "weakest underlying" : "basket average"} reached the autocall level after ${result.life.toFixed(2)} years. The investor receives cash principal 100 plus ${result.coupons.toFixed(1)} of cash coupons.`;
  if (result.barrierBreached) {
    const redemption = result.physicalDelivery
      ? `1.000 unit of ${result.worstName}, worth ${result.deliveryValue.toFixed(1)} at settlement`
      : `cash principal ${result.cashPrincipal.toFixed(1)}`;
    return `${referenceName} ended at ${result.terminalReference.toFixed(1)}, below the ${state.params.barrier.toFixed(0)} barrier. The investor receives ${redemption} plus ${result.coupons.toFixed(1)} of cash coupons.`;
  }
  return `${referenceName} ended at ${result.terminalReference.toFixed(1)}, at or above the ${state.params.barrier.toFixed(0)} barrier. The investor receives cash principal 100 plus ${result.coupons.toFixed(1)} of cash coupons.`;
}
function renderSettlement(result) {
  const host = $("basket-settlement"),
    cash = result.cashPrincipal + result.coupons,
    packageValue = cash + result.deliveryValue,
    items = [
      [
        "Cash received",
        cash.toFixed(1),
        `Coupons ${result.coupons.toFixed(2)} + cash principal ${result.cashPrincipal.toFixed(1)}`,
      ],
      [
        "Assets delivered",
        result.physicalDelivery
          ? `${result.deliveredUnits.toFixed(3)} ${result.worstName}`
          : "None",
        result.physicalDelivery
          ? `Worst name value ${result.deliveryValue.toFixed(1)} at settlement`
          : state.params.basis === "average"
            ? "Average basket is cash-settled"
            : "Physical downside delivery was not triggered",
      ],
      ["Package value", packageValue.toFixed(1), "Cash plus delivered assets per 100 nominal"],
    ];
  host.innerHTML = "";
  items.forEach(([label, value, detail]) => {
    const item = document.createElement("div"),
      span = document.createElement("span"),
      strong = document.createElement("strong"),
      p = document.createElement("p");
    span.textContent = label;
    strong.textContent = value;
    p.textContent = detail;
    item.append(span, strong, p);
    host.append(item);
  });
  host.setAttribute(
    "aria-label",
    `Settlement package value ${packageValue.toFixed(1)} per 100 nominal`,
  );
}
function renderLedger(result) {
  const body = $("basket-ledger-body"),
    total = $("basket-ledger-total");
  body.innerHTML = "";
  total.innerHTML = "";
  result.events.forEach((event) => {
    const row = document.createElement("tr"),
      values = [
        year(event.day),
        ...event.levels.map((level) => level.toFixed(1)),
        event.reference.toFixed(1),
        event.coupon.toFixed(2),
        event.state === "Alive" ? `${event.couponTest} · ${event.decision}` : event.state,
      ];
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (/Miss/.test(value)) cell.className = "event-negative";
      if (/Pass|Redeemed/.test(value)) cell.className = "event-positive";
      if (index === 0) cell.className = "event-neutral";
      row.append(cell);
    });
    body.append(row);
  });
  const first = document.createElement("th");
  first.scope = "row";
  first.textContent = "Totals";
  total.append(first);
  const values = [
    ...result.endLevels.map((level) => level.toFixed(1)),
    `${state.params.basis === "worst" ? "Worst" : "Average"} ${result.endReference.toFixed(1)}`,
    result.coupons.toFixed(2),
    result.physicalDelivery
      ? `Deliver 1.000 ${result.worstName}`
      : result.called
        ? "Autocalled"
        : `Cash principal ${result.cashPrincipal.toFixed(1)}`,
  ];
  values.forEach((value) => {
    const cell = document.createElement("td");
    cell.textContent = value;
    total.append(cell);
  });
}
function renderRules() {
  const steps = [
    "Observe all three",
    state.params.basis === "worst" ? "Select weakest" : "Calculate average",
    "Test coupon",
    "Test autocall",
    "Determine maturity payoff",
    state.params.basis === "worst" ? "Settle cash / worst name" : "Settle cash",
  ];
  const host = $("basket-rule-strip");
  host.innerHTML = "<b>Illustrative order</b>";
  steps.forEach((step) => {
    const arrow = document.createElement("i"),
      span = document.createElement("span");
    arrow.textContent = "→";
    span.textContent = step;
    host.append(arrow, span);
  });
}
function renderPath() {
  updateBasis();
  updateOutputs();
  const result = pathData();
  drawPath(result);
  renderRanking(result);
  $("basket-outcome").textContent = outcomeText(result);
  renderSettlement(result);
  renderLedger(result);
  renderRules();
  scheduleSimulation();
}

function drawHistogram(returns) {
  const svg = $("basket-histogram");
  svg.innerHTML = "";
  const n = 36,
    lo = returns[0],
    hi = returns.at(-1),
    span = Math.max(1, hi - lo),
    counts = Array.from({ length: n }, () => 0);
  returns.forEach((value) => counts[Math.min(n - 1, Math.floor(((value - lo) / span) * n))]++);
  const max = Math.max(...counts),
    m = { l: 50, r: 20, t: 18, b: 38 },
    w = 900,
    h = 210,
    X = (value) => m.l + ((value - lo) / span) * (w - m.l - m.r),
    Y = (count) => m.t + ((max - count) / max) * (h - m.t - m.b),
    barW = (w - m.l - m.r) / n;
  [0, 0.5, 1].forEach((t) => {
    const y = Y(max * t);
    svg.append(svgEl("line", { x1: m.l, x2: w - m.r, y1: y, y2: y, class: "grid" }));
  });
  counts.forEach((count, index) => {
    const midpoint = lo + ((index + 0.5) / n) * span;
    svg.append(
      svgEl("rect", {
        x: m.l + index * barW + 0.7,
        y: Y(count),
        width: Math.max(1, barW - 1.4),
        height: h - m.b - Y(count),
        fill: midpoint < 0 ? colors.brick : colors.jade,
        opacity: 0.7,
      }),
    );
  });
  if (lo < 0 && hi > 0)
    svg.append(
      svgEl("line", {
        x1: X(0),
        x2: X(0),
        y1: m.t,
        y2: h - m.b,
        stroke: colors.ink,
        "stroke-width": 1.3,
      }),
    );
  for (let i = 0; i <= 4; i++) {
    const value = lo + (span * i) / 4,
      x = X(value);
    svg.append(
      svgEl("text", { x, y: h - 16, "text-anchor": "middle", class: "axis" }, money(value)),
    );
  }
  svg.append(
    svgEl(
      "text",
      { x: (m.l + w - m.r) / 2, y: h - 2, "text-anchor": "middle", class: "axis" },
      "Total return per 100 invested",
    ),
  );
}
let simulationTimer,
  simulationVersion = 0,
  worker = null,
  renderFrame = 0;
function finishSimulation(message) {
  if (message.id !== simulationVersion) return;
  const definitions = [
      ["Autocalled", pct(message.stats.called)],
      ["Lost money", pct(message.stats.loss)],
      ["Average coupons", message.stats.averageCoupons.toFixed(1)],
      ["Average return", money(message.stats.averageReturn)],
    ],
    host = $("basket-stats");
  host.innerHTML = "";
  definitions.forEach(([label, value]) => {
    const card = document.createElement("div"),
      span = document.createElement("span"),
      strong = document.createElement("strong");
    card.className = "stat";
    span.textContent = label;
    strong.textContent = value;
    card.append(span, strong);
    host.append(card);
  });
  drawHistogram(Array.from(message.returns));
  $("basket-simulation-status").textContent =
    `Current · ${message.count.toLocaleString()} baskets · ${state.params.correlation.toFixed(0)}% pairwise correlation · zero-drift illustration`;
}
function scheduleSimulation() {
  const id = ++simulationVersion;
  clearTimeout(simulationTimer);
  $("basket-simulation-status").textContent = "Updating simulated baskets…";
  simulationTimer = setTimeout(() => {
    const payload = { id, params: { ...state.params }, seed: state.seed, count: 2000 };
    if (typeof Worker !== "undefined") {
      if (worker) worker.terminate();
      worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event) => finishSimulation(event.data);
      worker.postMessage(payload);
    } else
      setTimeout(
        () =>
          finishSimulation({
            id,
            ...BasketEngine.simulate(payload.params, payload.seed, payload.count),
          }),
        0,
      );
  }, 140);
}
function renderAll() {
  renderPath();
}
function scheduleRender() {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(renderAll);
}
$("basket-resample").addEventListener("click", () => {
  const buffer = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(buffer);
  state.seed = buffer[0] || (state.seed * 1664525 + 1013904223) >>> 0 || 1;
  state.scenario = "random";
  renderScenarios();
  renderPath();
});
$("reset").addEventListener("click", () => {
  state.params = { ...config.defaults };
  state.scenario = "random";
  state.seed = 904271;
  renderControls();
  renderScenarios();
  renderAll();
});
renderControls();
renderScenarios();
renderAll();
