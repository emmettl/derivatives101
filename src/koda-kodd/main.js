"use strict";

import * as KodaKoddEngine from "./engine.ts";
import { attachHorizontalInspector } from "../shared/svg-interaction";

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
const productDefaults = {
  koda: { strike: 90, knockOut: 105 },
  kodd: { strike: 114, knockOut: 95 },
};
const config = {
  defaults: {
    kind: "koda",
    strike: 90,
    knockOut: 105,
    baseUnits: 10,
    gearing: 2,
    tenor: 1,
    frequency: 12,
    guaranteed: 0,
    vol: 28,
    volModel: "flat",
  },
  scenarios: [
    ["random", "Random"],
    ["knockout", "KO early"],
    ["recover", "Gear, then recover"],
    ["geared", "Gear to maturity"],
    ["range", "Hover near strike"],
  ],
  controls: [
    {
      key: "kind",
      type: "radio",
      label: "Contract",
      options: [
        ["koda", "KODA · buy"],
        ["kodd", "KODD · sell"],
      ],
    },
    {
      key: "strike",
      type: "range",
      label: "Forward price",
      min: (p) => (p.kind === "koda" ? 75 : 101),
      max: (p) => (p.kind === "koda" ? 99 : 130),
      step: 1,
      format: (v) => v.toFixed(0),
    },
    {
      key: "knockOut",
      type: "range",
      label: "Knock-out price",
      min: (p) => (p.kind === "koda" ? 101 : 70),
      max: (p) => (p.kind === "koda" ? 125 : 99),
      step: 1,
      format: (v) => v.toFixed(0),
    },
    {
      key: "baseUnits",
      type: "range",
      label: "Base units per fixing",
      min: 1,
      max: 25,
      step: 1,
      format: (v) => v.toFixed(0),
    },
    {
      key: "gearing",
      type: "range",
      label: "Bad-side gearing",
      min: 1,
      max: 4,
      step: 0.5,
      format: (v) => v.toFixed(1) + "×",
    },
    {
      key: "tenor",
      type: "range",
      label: "Scheduled tenor",
      min: 0.5,
      max: 2,
      step: 0.5,
      format: (v) => v.toFixed(1) + " years",
    },
    {
      key: "frequency",
      type: "select",
      numeric: true,
      label: "Fixing frequency",
      options: [
        [12, "Monthly"],
        [52, "Weekly"],
      ],
      help: "Real contracts are often daily. Monthly and weekly views keep the rule sequence legible.",
    },
    {
      key: "guaranteed",
      type: "select",
      numeric: true,
      label: "Guaranteed opening observations",
      options: [
        [0, "None"],
        [1, "First observation"],
        [2, "First two observations"],
        [3, "First three observations"],
      ],
      help: "If a knock-out occurs inside this simplified opening window, base-size trades continue through the guaranteed observations.",
    },
    {
      key: "vol",
      type: "range",
      label: "Illustrative volatility",
      min: 10,
      max: 70,
      step: 1,
      format: (v) => v.toFixed(0) + "% p.a.",
    },
    {
      key: "volModel",
      type: "radio",
      label: "Path volatility model",
      options: [
        ["flat", "Flat volatility"],
        ["downside-skew", "Downside skew"],
      ],
      help: "Downside skew raises local volatility after a fall and lowers it after a rally. Both choices retain zero drift; the comparison reuses the same random draws.",
    },
  ],
};
const state = { params: { ...config.defaults }, scenario: "random", seed: 183047 };
let pathContext = null,
  histogramContext = null,
  selectedPathDay = null,
  selectedHistogramValue = null;

const pathInspector = attachHorizontalInspector($("koda-path-chart"), () => {
  if (!pathContext) return null;
  const { result, end, Y, Q } = pathContext;
  return {
    width: 900,
    left: 58,
    right: 132,
    top: 22,
    bottom: 432,
    minimum: 0,
    maximum: end,
    step: 1,
    value: Math.min(end, selectedPathDay ?? result.terminationDay),
    label: "KODA or KODD path day selection",
    inspect(day) {
      const spot = result.path[day],
        event = latestKodaEvent(result, day),
        exact = event?.day === day,
        cash = result.events
          .filter((item) => item.day <= day)
          .reduce((total, item) => total + item.cash, 0),
        units = event?.cumulativeUnits ?? 0,
        valuationSpot = result.path[Math.min(day, result.terminationDay)],
        mark = units * valuationSpot,
        pnl = state.params.kind === "koda" ? mark - cash : cash - mark;
      return {
        title: `${pathTime(day)} · day ${day}`,
        rows: [
          { label: "Underlying", value: spot.toFixed(1), color: colors.steel },
          {
            label: "Fixing state",
            value:
              day > result.terminationDay
                ? result.knockedOut
                  ? "Contract ended · knocked out"
                  : "Contract ended"
                : exact
                  ? event.status
                  : "Between fixings",
          },
          { label: "Quantity", value: exact ? event.quantity.toFixed(0) : "—" },
          { label: "Cumulative units", value: units.toFixed(0) },
          { label: "Mark-to-date P&L", value: signed(pnl, 0) },
        ],
        points: [
          { y: Y(spot), color: colors.steel },
          ...(exact && event.quantity
            ? [{ y: Q(event.quantity), color: event.geared ? colors.brick : colors.amber }]
            : []),
        ],
      };
    },
    onSelect(day) {
      selectedPathDay = day;
      updateKodaLinkedState(day);
    },
    onInspect(day) {
      updateKodaLinkedState(day);
    },
    onHide() {
      updateKodaLinkedState(selectedPathDay ?? result.terminationDay);
    },
  };
});

const histogramInspector = attachHorizontalInspector($("koda-histogram"), () => {
  if (!histogramContext) return null;
  const { lo, hi, binWidth, counts, total, Y } = histogramContext,
    minimum = lo + binWidth / 2,
    maximum = hi - binWidth / 2,
    value = Math.max(minimum, Math.min(maximum, selectedHistogramValue ?? 0));
  return {
    width: 900,
    left: 55,
    right: 20,
    top: 18,
    bottom: 170,
    minimum,
    maximum,
    plotMinimum: lo,
    plotMaximum: hi,
    step: binWidth,
    value,
    label: "KODA or KODD P&L distribution selection",
    inspect(returnValue) {
      const index = Math.max(
          0,
          Math.min(counts.length - 1, Math.round((returnValue - minimum) / binWidth)),
        ),
        count = counts[index],
        lower = lo + index * binWidth,
        upper = lower + binWidth;
      return {
        title: `P&L ${signed(returnValue, 1)}%`,
        rows: [
          { label: "Range", value: `${signed(lower, 1)}% to ${signed(upper, 1)}%` },
          { label: "Paths", value: count.toLocaleString() },
          { label: "Share", value: `${((count / total) * 100).toFixed(1)}%` },
        ],
        points: [{ y: Y(count), color: returnValue < 0 ? colors.brick : colors.jade }],
      };
    },
    onSelect(returnValue) {
      selectedHistogramValue = returnValue;
    },
  };
});

function pathTime(day) {
  if (day === 0) return "Today";
  return `${(day / KodaKoddEngine.DAYS).toFixed(2)} years`;
}
function latestKodaEvent(result, day) {
  return result.events.findLast((event) => event.day <= day) ?? null;
}
function updateKodaLinkedState(day) {
  if (!pathContext) return;
  const bounded = Math.max(0, Math.min(pathContext.end, day)),
    event = latestKodaEvent(pathContext.result, bounded);
  $("koda-ledger-body")
    ?.querySelectorAll("tr[data-event-day]")
    .forEach((row) =>
      row.classList.toggle(
        "selected-observation",
        event != null && Number(row.dataset.eventDay) === event.day,
      ),
    );
}
function svgEl(name, attrs = {}, text = "") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text) node.textContent = text;
  return node;
}
function signed(value, digits = 0) {
  return (value > 0 ? "+" : value < 0 ? "−" : "") + Math.abs(value).toFixed(digits);
}
function pct(value) {
  return (value * 100).toFixed(0) + "%";
}
function fixingLabel(index) {
  const number = index + 1;
  return `${state.params.frequency === 52 ? "Week" : "Month"} ${number}`;
}

function renderControls() {
  const host = $("koda-controls");
  host.innerHTML = "";
  config.controls.forEach((control) => {
    const block = document.createElement("div");
    block.className = "control-block";
    block.dataset.control = control.key;
    if (control.type === "range") {
      const label = document.createElement("label");
      label.className = "range-control";
      label.htmlFor = `koda-${control.key}`;
      const head = document.createElement("span"),
        name = document.createElement("b"),
        output = document.createElement("output");
      name.textContent = control.label;
      output.id = `koda-output-${control.key}`;
      head.append(name, output);
      const input = document.createElement("input");
      input.type = "range";
      input.id = `koda-${control.key}`;
      input.min = typeof control.min === "function" ? control.min(state.params) : control.min;
      input.max = typeof control.max === "function" ? control.max(state.params) : control.max;
      input.step = control.step;
      input.value = state.params[control.key];
      input.addEventListener("input", () => {
        state.params[control.key] = Number(input.value);
        updateOutputs();
        scheduleRender();
      });
      label.append(head, input);
      block.append(label);
    } else if (control.type === "select") {
      const label = document.createElement("label");
      label.htmlFor = `koda-${control.key}`;
      label.textContent = control.label;
      const select = document.createElement("select");
      select.id = `koda-${control.key}`;
      control.options.forEach(([value, name]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = name;
        select.append(option);
      });
      select.value = String(state.params[control.key]);
      select.addEventListener("change", () => {
        state.params[control.key] = control.numeric ? Number(select.value) : select.value;
        renderAll();
      });
      block.append(label, select);
    } else {
      const title = document.createElement("span");
      title.className = "control-title";
      title.textContent = control.label;
      const set = document.createElement("div");
      set.className = "radio-set";
      control.options.forEach(([value, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        const on = state.params[control.key] === value;
        button.classList.toggle("on", on);
        button.setAttribute("aria-pressed", String(on));
        button.addEventListener("click", () => {
          if (state.params[control.key] === value) return;
          state.params[control.key] = value;
          if (control.key === "kind") Object.assign(state.params, productDefaults[value]);
          renderControls();
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
  updateOutputs();
}
function updateOutputs() {
  config.controls
    .filter((control) => control.type === "range")
    .forEach((control) => {
      const output = $(`koda-output-${control.key}`);
      if (output) output.textContent = control.format(state.params[control.key]);
    });
}
function renderScenarios() {
  const host = $("koda-scenarios");
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
function updateProductCopy() {
  const koda = state.params.kind === "koda";
  $("product-name").textContent = koda
    ? "KODA · discount accumulator"
    : "KODD · discount decumulator";
  $("product-description").textContent = koda
    ? `The investor buys ${state.params.baseUnits} units at ${state.params.strike} on a normal active fixing, and ${state.params.gearing.toFixed(1)}× that quantity when spot is below the forward price. A close at or above ${state.params.knockOut} stops future accumulation.`
    : `The investor sells ${state.params.baseUnits} units at ${state.params.strike} on a normal active fixing, and ${state.params.gearing.toFixed(1)}× that quantity when spot is above the forward price. A close at or below ${state.params.knockOut} stops future decumulation.`;
}
function pathData() {
  const path = KodaKoddEngine.generatePath({
    ...state.params,
    seed: state.seed,
    scenario: state.scenario,
  });
  return KodaKoddEngine.evaluate(path, state.params);
}
function pathD(values, start, end, X, Y) {
  const step = Math.max(1, Math.floor(Math.max(1, end - start) / 420));
  let d = "";
  for (let day = start; day <= end; day += step)
    d += (d ? "L" : "M") + X(day).toFixed(1) + "," + Y(values[day]).toFixed(1);
  if ((end - start) % step) d += "L" + X(end).toFixed(1) + "," + Y(values[end]).toFixed(1);
  return d;
}

function drawPath(result) {
  const svg = $("koda-path-chart");
  svg.innerHTML = "";
  const end = result.path.length - 1,
    all = Array.from(result.path),
    min = Math.max(0, Math.min(...all, state.params.strike, state.params.knockOut) - 9),
    max = Math.max(...all, state.params.strike, state.params.knockOut) + 9,
    m = { l: 58, r: 132, t: 22 },
    w = 900,
    priceBottom = 305,
    quantityTop = 345,
    quantityBottom = 432,
    h = 470,
    X = (day) => m.l + (day / end) * (w - m.l - m.r),
    Y = (value) => m.t + ((max - value) / (max - min)) * (priceBottom - m.t),
    Q = (quantity) =>
      quantityBottom -
      (quantity / (state.params.baseUnits * state.params.gearing)) * (quantityBottom - quantityTop);
  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4,
      y = Y(value);
    svg.append(
      svgEl("line", { x1: m.l, x2: w - m.r, y1: y, y2: y, class: "grid" }),
      svgEl(
        "text",
        { x: m.l - 8, y: y + 3, "text-anchor": "end", class: "axis" },
        value.toFixed(0),
      ),
    );
  }
  [0, 0.5, 1].forEach((fraction) => {
    const day = Math.round(end * fraction),
      x = X(day);
    svg.append(
      svgEl("line", { x1: x, x2: x, y1: m.t, y2: quantityBottom, class: "grid" }),
      svgEl(
        "text",
        { x, y: h - 13, "text-anchor": "middle", class: "axis" },
        fraction === 0
          ? "Start"
          : fraction === 1
            ? `${state.params.tenor.toFixed(1)}Y`
            : `${(state.params.tenor * fraction).toFixed(1)}Y`,
      ),
    );
  });
  [
    [state.params.strike, "forward", colors.amber, "6 4"],
    [state.params.knockOut, "knock-out", colors.jade, "5 4"],
  ].forEach(([level, label, color, dash]) => {
    const y = Y(level);
    svg.append(
      svgEl("line", {
        x1: m.l,
        x2: w - m.r,
        y1: y,
        y2: y,
        stroke: color,
        "stroke-width": 1.2,
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
        y2: quantityBottom,
        stroke: colors.line,
        "stroke-width": 0.7,
        "stroke-opacity": 0.38,
      }),
    ),
  );
  svg.append(
    svgEl("path", { d: pathD(result.path, 0, result.terminationDay, X, Y), class: "path-main" }),
  );
  if (result.terminationDay < end)
    svg.append(
      svgEl("path", {
        d: pathD(result.path, result.terminationDay, end, X, Y),
        class: "path-after",
      }),
    );
  result.events.forEach((event) => {
    const fill =
      event.knockOutTest === "Hit" ? colors.jade : event.geared ? colors.brick : colors.ink;
    svg.append(
      svgEl("circle", {
        cx: X(event.day),
        cy: Y(event.spot),
        r: event.knockOutTest === "Hit" ? 5 : 3.2,
        class: event.knockOutTest === "Hit" ? "event-dot" : "observation",
        fill,
      }),
    );
    if (event.quantity) {
      const y = Q(event.quantity),
        bar = svgEl("rect", {
          x: X(event.day) - Math.max(1.5, 240 / result.observations.length),
          y,
          width: Math.max(3, 480 / result.observations.length),
          height: quantityBottom - y,
          class: event.geared
            ? "quantity-geared"
            : event.status.includes("Guaranteed") || event.status.includes("guarantee")
              ? "quantity-guaranteed"
              : "quantity-base",
        });
      bar.append(
        svgEl(
          "title",
          {},
          `${fixingLabel(event.index)}: ${event.quantity.toFixed(0)} units at ${event.spot.toFixed(1)}`,
        ),
      );
      svg.append(bar);
    }
  });
  svg.append(
    svgEl("line", {
      x1: m.l,
      x2: w - m.r,
      y1: quantityBottom,
      y2: quantityBottom,
      class: "quantity-axis",
    }),
    svgEl("text", { x: m.l - 8, y: quantityBottom + 3, "text-anchor": "end", class: "axis" }, "0"),
    svgEl(
      "text",
      { x: m.l - 8, y: Q(state.params.baseUnits) + 3, "text-anchor": "end", class: "axis" },
      state.params.baseUnits.toFixed(0),
    ),
    svgEl(
      "text",
      {
        x: m.l - 8,
        y: Q(state.params.baseUnits * state.params.gearing) + 3,
        "text-anchor": "end",
        class: "axis",
      },
      (state.params.baseUnits * state.params.gearing).toFixed(0),
    ),
    svgEl(
      "text",
      { x: m.l, y: quantityTop - 10, class: "quantity-heading" },
      state.params.kind === "koda" ? "Units bought per fixing" : "Units sold per fixing",
    ),
  );
  if (result.knockedOut) {
    const x = X(result.knockOutDay),
      event = result.events.find((item) => item.day === result.knockOutDay);
    svg.append(
      svgEl("line", {
        x1: x,
        x2: x,
        y1: m.t,
        y2: quantityBottom,
        stroke: colors.jade,
        "stroke-width": 1.4,
        "stroke-dasharray": "3 3",
      }),
      svgEl(
        "text",
        {
          x: x + 6,
          y: Math.max(m.t + 12, Y(event.spot) - 10),
          fill: colors.jade,
          class: "event-label",
        },
        "Knock-out",
      ),
    );
  }
  const endY = Y(result.path[result.terminationDay]);
  svg.append(
    svgEl(
      "text",
      { x: w - m.r + 7, y: endY + 3, fill: colors.deep, class: "direct-label" },
      `stop ${result.valuationSpot.toFixed(1)}`,
    ),
  );
  svg.setAttribute(
    "aria-label",
    `${state.params.kind.toUpperCase()} path stops at ${result.valuationSpot.toFixed(1)} after ${result.life.toFixed(2)} years; ${result.totalUnits.toFixed(0)} units traded across ${result.executedFixings} fixings, including ${result.gearedFixings} geared fixings.`,
  );
  selectedPathDay = Math.min(end, selectedPathDay ?? result.terminationDay);
  pathContext = { result, end, Y, Q };
  pathInspector.refresh();
}

function outcomeText(result) {
  const koda = state.params.kind === "koda",
    action = koda ? "acquired" : "delivered",
    cashAction = koda ? "paid" : "received",
    stop = result.knockedOut
      ? `The knock-out was hit at ${result.path[result.knockOutDay].toFixed(1)} after ${fixingLabel(result.knockOutIndex)}.`
      : "The contract ran to its scheduled final fixing.";
  const guarantee =
    result.knockedOut && state.params.guaranteed > result.knockOutIndex
      ? ` Guaranteed base-size trades continued through the opening window, so valuation occurs at ${result.valuationSpot.toFixed(1)}.`
      : result.knockedOut
        ? " No trade occurred at the non-guaranteed knock-out fixing."
        : "";
  return `${stop}${guarantee} The investor ${action} ${result.totalUnits.toFixed(0)} units and ${cashAction} ${result.totalCash.toFixed(0)} at the fixed forward price. Relative to the stop-date market value, the illustrative economic P&L is ${signed(result.pnl, 0)}.`;
}
function renderBreakdown(result) {
  const koda = state.params.kind === "koda",
    items = [
      [
        koda ? "Cash paid" : "Cash received",
        result.totalCash.toFixed(0),
        `${result.executedFixings} executed fixings at ${state.params.strike}`,
      ],
      [
        koda ? "Units acquired" : "Units delivered",
        result.totalUnits.toFixed(0),
        `${result.gearedFixings} geared fixings; maximum ${result.maxUnits.toFixed(0)}`,
      ],
      [
        "Market value at stop",
        result.marketValue.toFixed(0),
        `${result.totalUnits.toFixed(0)} units × spot ${result.valuationSpot.toFixed(1)}`,
      ],
      [
        "Economic P&L",
        signed(result.pnl, 0),
        `${signed(result.pnlPercent, 1)}% of base scheduled notional`,
      ],
    ],
    host = $("koda-breakdown");
  host.innerHTML = "";
  items.forEach(([label, value, detail], index) => {
    const item = document.createElement("div"),
      span = document.createElement("span"),
      strong = document.createElement("strong"),
      p = document.createElement("p");
    span.textContent = label;
    strong.textContent = value;
    if (index === 3)
      strong.className = result.pnl < 0 ? "event-negative" : result.pnl > 0 ? "event-positive" : "";
    p.textContent = detail;
    item.append(span, strong, p);
    host.append(item);
  });
}
function renderLedger(result) {
  const body = $("koda-ledger-body"),
    total = $("koda-ledger-total"),
    koda = state.params.kind === "koda";
  body.innerHTML = "";
  total.innerHTML = "";
  result.events.forEach((event) => {
    const row = document.createElement("tr"),
      clientCash = koda ? -event.cash : event.cash,
      values = [
        fixingLabel(event.index),
        event.spot.toFixed(1),
        event.knockOutTest,
        event.sizeTest,
        event.quantity.toFixed(0),
        signed(clientCash, 0),
        event.cumulativeUnits.toFixed(0),
        event.status,
      ];
    row.dataset.eventDay = event.day;
    values.forEach((value, index) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      if (index === 0) cell.className = "event-neutral";
      if (index === 2 && value === "Hit") cell.className = "event-positive";
      if (index === 3 && value.includes("geared")) cell.className = "event-negative";
      if (index === 7 && value.includes("Geared")) cell.className = "event-negative";
      if (index === 7 && value.includes("Knocked")) cell.className = "event-positive";
      row.append(cell);
    });
    body.append(row);
  });
  const heading = document.createElement("th");
  heading.scope = "row";
  heading.textContent = "Totals";
  total.append(heading);
  [
    result.valuationSpot.toFixed(1),
    result.knockedOut ? "KO hit" : "No KO",
    `${result.gearedFixings} geared`,
    result.totalUnits.toFixed(0),
    signed(koda ? -result.totalCash : result.totalCash, 0),
    result.totalUnits.toFixed(0),
    signed(result.pnl, 0) + " P&L",
  ].forEach((value) => {
    const cell = document.createElement("td");
    cell.textContent = value;
    total.append(cell);
  });
}
function renderRules() {
  const steps = [
      "Observe close",
      "Test knock-out",
      state.params.guaranteed ? "Apply any guarantee" : "Stop if knocked out",
      "Test forward price",
      "Choose base / geared units",
      state.params.kind === "koda" ? "Buy at forward" : "Sell at forward",
      "Update cash and units",
    ],
    host = $("koda-rule-strip");
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
  updateProductCopy();
  updateOutputs();
  const result = pathData();
  drawPath(result);
  $("koda-outcome").textContent = outcomeText(result);
  renderBreakdown(result);
  renderLedger(result);
  updateKodaLinkedState(selectedPathDay ?? result.terminationDay);
  renderRules();
  scheduleSimulation();
}

function drawHistogram(returns) {
  const svg = $("koda-histogram");
  svg.innerHTML = "";
  const bins = 38,
    lo = returns[0],
    hi = returns.at(-1),
    span = Math.max(1, hi - lo),
    counts = Array.from({ length: bins }, () => 0);
  returns.forEach(
    (value) => counts[Math.min(bins - 1, Math.floor(((value - lo) / span) * bins))]++,
  );
  const max = Math.max(...counts),
    m = { l: 55, r: 20, t: 18, b: 40 },
    w = 900,
    h = 210,
    X = (value) => m.l + ((value - lo) / span) * (w - m.l - m.r),
    Y = (count) => m.t + ((max - count) / max) * (h - m.t - m.b),
    barW = (w - m.l - m.r) / bins;
  [0, 0.5, 1].forEach((fraction) => {
    const y = Y(max * fraction);
    svg.append(svgEl("line", { x1: m.l, x2: w - m.r, y1: y, y2: y, class: "grid" }));
  });
  counts.forEach((count, index) => {
    const midpoint = lo + ((index + 0.5) / bins) * span;
    svg.append(
      svgEl("rect", {
        class: "interactive-histogram-bar",
        x: m.l + index * barW + 0.7,
        y: Y(count),
        width: Math.max(1, barW - 1.4),
        height: h - m.b - Y(count),
        fill: midpoint < 0 ? colors.brick : colors.jade,
        opacity: 0.72,
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
      svgEl(
        "text",
        { x, y: h - 17, "text-anchor": "middle", class: "axis" },
        signed(value, 0) + "%",
      ),
    );
  }
  svg.append(
    svgEl(
      "text",
      { x: (m.l + w - m.r) / 2, y: h - 2, "text-anchor": "middle", class: "axis" },
      "Economic P&L, % of base scheduled notional",
    ),
  );
  const binWidth = span / bins;
  histogramContext = { lo, hi: lo + span, binWidth, counts, total: returns.length, Y };
  histogramInspector.refresh();
}
let simulationTimer,
  simulationVersion = 0,
  worker = null,
  workerBusy = false,
  pendingPayload = null,
  renderFrame = 0;
function renderSimulation(message) {
  if (message.id !== simulationVersion) return;
  const definitions = [
      ["Knocked out", pct(message.stats.knockOutRate)],
      ["Ever geared", pct(message.stats.gearedRate)],
      ["Average units", message.stats.averageUnits.toFixed(0)],
      ["Average P&L", signed(message.stats.averagePnl, 1) + "%"],
    ],
    host = $("koda-stats");
  host.innerHTML = "";
  definitions.forEach(([label, value]) => {
    const item = document.createElement("div"),
      span = document.createElement("span"),
      strong = document.createElement("strong");
    item.className = "stat";
    span.textContent = label;
    strong.textContent = value;
    item.append(span, strong);
    host.append(item);
  });
  drawHistogram(Array.from(message.returns));
  const modelLabel =
    state.params.volModel === "downside-skew" ? "downside local vol" : "flat volatility";
  $("koda-simulation-status").textContent =
    `Current · ${message.count.toLocaleString()} paths · average life ${message.stats.averageLife.toFixed(2)} years · zero drift · ${modelLabel}${kodaComparisonSummary(message)} · no valuation adjustment`;
}
function kodaComparisonSummary(message) {
  const flat = message.comparisonStats;
  if (!flat) return "";
  const pp = (value, baseline) => {
    const difference = (value - baseline) * 100;
    return `${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(1)} pp`;
  };
  return ` · versus flat: knock-out ${pp(message.stats.knockOutRate, flat.knockOutRate)}, gearing ${pp(message.stats.gearedRate, flat.gearedRate)}`;
}
function postPayload(payload) {
  if (typeof Worker === "undefined") {
    setTimeout(
      () =>
        renderSimulation({
          id: payload.id,
          ...KodaKoddEngine.simulate(payload.params, payload.seed, payload.count),
          comparisonStats:
            payload.params.volModel === "downside-skew"
              ? KodaKoddEngine.simulate(
                  { ...payload.params, volModel: "flat" },
                  payload.seed,
                  payload.count,
                ).stats
              : null,
        }),
      0,
    );
    return;
  }
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      workerBusy = false;
      renderSimulation(event.data);
      if (pendingPayload) {
        const next = pendingPayload;
        pendingPayload = null;
        postPayload(next);
      }
    };
  }
  if (workerBusy) {
    pendingPayload = payload;
    return;
  }
  workerBusy = true;
  worker.postMessage(payload);
}
function scheduleSimulation() {
  const id = ++simulationVersion;
  clearTimeout(simulationTimer);
  $("koda-simulation-status").textContent = "Updating simulated paths…";
  simulationTimer = setTimeout(
    () => postPayload({ id, params: { ...state.params }, seed: state.seed, count: 2000 }),
    140,
  );
}
function renderAll() {
  renderPath();
}
function scheduleRender() {
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(renderAll);
}
function newSeed() {
  const buffer = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(buffer);
  return buffer[0] || (state.seed * 1664525 + 1013904223) >>> 0 || 1;
}
$("koda-resample").addEventListener("click", () => {
  state.seed = newSeed();
  state.scenario = "random";
  renderScenarios();
  renderPath();
});
$("reset").addEventListener("click", () => {
  state.params = { ...config.defaults };
  state.scenario = "random";
  state.seed = 183047;
  renderControls();
  renderScenarios();
  renderAll();
});
renderControls();
renderScenarios();
renderAll();
