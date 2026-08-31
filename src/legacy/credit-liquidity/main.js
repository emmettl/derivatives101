import * as engine from "./engine";
import { attachHorizontalInspector } from "../../shared/svg-interaction";

(function () {
  "use strict";

  const presets = engine.presets;
  let state = Object.assign({}, presets.normal);
  const byId = (id) => document.getElementById(id);
  const controls = [
    {
      id: "contractualAmount",
      label: "Contractual amount due",
      min: 50,
      max: 150,
      step: 1,
      format: points,
    },
    {
      id: "remaining",
      label: "Time remaining",
      min: 0.25,
      max: 8,
      step: 0.25,
      format: (value) => `${value.toFixed(2)} years`,
    },
    { id: "rate", label: "Reference rate", min: -0.01, max: 0.08, step: 0.0025, format: percent },
    { id: "spread", label: "Issuer spread", min: 0, max: 0.12, step: 0.0025, format: basisPoints },
    { id: "exitCost", label: "Illustrative exit cost", min: 0, max: 8, step: 0.25, format: points },
    {
      id: "recoveryRate",
      label: "Recovery assumption",
      min: 0,
      max: 0.8,
      step: 0.05,
      format: percent,
    },
  ];
  let curveContext = null;

  const curveInspector = attachHorizontalInspector(byId("credit-curve"), () => {
    if (!curveContext) return null;
    return {
      width: 900,
      left: 64,
      right: 24,
      top: 24,
      bottom: 300,
      minimum: 0,
      maximum: 0.12,
      step: 0.0025,
      value: Math.min(0.12, Math.max(0, state.spread)),
      label: "Issuer spread selection",
      inspect(spread) {
        const selected = engine.value(Object.assign({}, state, { spread, defaulted: false }));
        return {
          title: `Issuer spread ${basisPoints(spread)}`,
          rows: [
            {
              label: "Issuer-adjusted value",
              value: selected.creditAdjusted.toFixed(2),
              color: "#2c5670",
            },
            {
              label: "Illustrative bid",
              value: selected.bid == null ? "No quote" : selected.bid.toFixed(2),
              color: "#b5443a",
            },
            { label: "Credit adjustment", value: signed(selected.creditAdjustment) },
            { label: "Exit deduction", value: state.exitCost.toFixed(2) },
          ],
          points: [
            { y: curveContext.y(selected.creditAdjusted), color: "#2c5670" },
            ...(selected.bid == null
              ? []
              : [{ y: curveContext.y(selected.bid), color: "#b5443a" }]),
          ],
        };
      },
      onSelect(spread) {
        state.spread = spread;
        state.defaulted = false;
        state.id = "custom";
        syncControls();
        render();
      },
    };
  });

  function points(value) {
    return `${value.toFixed(2)} points`;
  }
  function percent(value) {
    return `${(value * 100).toFixed(2)}%`;
  }
  function basisPoints(value) {
    return `${Math.round(value * 10000)} bp`;
  }
  function esc(value) {
    return String(value).replace(
      /[&<>"]/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  }
  function signed(value) {
    return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
  }
  function formatTick(value) {
    return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(1);
  }

  function createControls() {
    byId("credit-controls").innerHTML =
      `<div class="control-block">${controls.slice(0, 2).map(controlMarkup).join("")}</div><div class="control-block"><span class="control-title">Credit and exit inputs</span>${controls.slice(2).map(controlMarkup).join("")}<label class="quote-switch" for="credit-quoteAvailable"><input id="credit-quoteAvailable" type="checkbox" checked><span>Secondary quote available</span></label></div>`;
    controls.forEach((control) =>
      byId(`credit-${control.id}`).addEventListener("input", (event) => {
        state[control.id] = Number(event.target.value);
        state.id = "custom";
        render();
      }),
    );
    byId("credit-quoteAvailable").addEventListener("change", (event) => {
      state.quoteAvailable = event.target.checked;
      state.defaulted = false;
      state.id = "custom";
      render();
    });
  }

  function controlMarkup(control) {
    return `<label class="range-control" for="credit-${control.id}"><span>${esc(control.label)} <output id="credit-${control.id}-out"></output></span><input id="credit-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${state[control.id]}"></label>`;
  }

  function renderPresets() {
    byId("credit-presets").innerHTML = Object.values(presets)
      .map(
        (preset) =>
          `<button type="button" data-preset="${preset.id}" class="${preset.id === state.id ? "on" : ""}" aria-pressed="${preset.id === state.id}">${esc(preset.name)}</button>`,
      )
      .join("");
    byId("credit-presets")
      .querySelectorAll("[data-preset]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          state = Object.assign({}, presets[button.dataset.preset]);
          syncControls();
          render();
        }),
      );
  }

  function syncControls() {
    controls.forEach((control) => {
      byId(`credit-${control.id}`).value = state[control.id];
    });
    byId("credit-quoteAvailable").checked = state.quoteAvailable;
  }

  function renderControlOutputs() {
    controls.forEach((control) => {
      byId(`credit-${control.id}-out`).textContent = control.format(state[control.id]);
    });
  }

  function render() {
    const result = engine.value(state);
    renderPresets();
    renderControlOutputs();
    const status = state.defaulted
      ? "Issuer default · recovery process"
      : state.quoteAvailable
        ? "Performing issuer · quote available"
        : "Performing issuer · no secondary quote";
    byId("credit-headline").textContent = status;
    byId("credit-summary").textContent = state.defaulted
      ? `The original payoff timetable is interrupted. A ${percent(state.recoveryRate)} recovery assumption on 100 nominal produces an illustrative ${result.recoveryScenario.toFixed(2)}, with timing and actual recovery unresolved.`
      : `The issuer-adjusted model value is ${result.creditAdjusted.toFixed(2)}. ${result.bid == null ? "No executable exit price is assumed." : `After the selected exit cost, the illustrative bid is ${result.bid.toFixed(2)}.`}`;
    const stats = [
      [
        state.contractualAmount.toFixed(2),
        "Contractual amount",
        "Due at maturity only if the issuer performs",
      ],
      [
        state.defaulted ? "Interrupted" : result.creditAdjusted.toFixed(2),
        "Issuer-adjusted value",
        state.defaulted
          ? "A spread-based mark no longer describes settlement"
          : "Simplified present value including issuer spread",
      ],
      [
        result.bid == null ? "No quote" : result.bid.toFixed(2),
        "Cash exit today",
        result.bid == null
          ? "Valuation does not create a buyer"
          : "Illustrative bid after exit cost",
      ],
      [
        result.recoveryScenario.toFixed(2),
        "Recovery scenario",
        `Assumed ${percent(state.recoveryRate)} of 100 nominal claim basis`,
      ],
    ];
    byId("credit-stats").innerHTML = stats
      .map(
        (item) =>
          `<div><span>${esc(item[1])}</span><strong>${esc(item[0])}</strong><p>${esc(item[2])}</p></div>`,
      )
      .join("");
    const steps = [
      [
        "Default-free PV",
        result.defaultFree,
        "Discount the contractual amount at the reference rate",
      ],
      [
        "Issuer-adjusted value",
        result.creditAdjusted,
        `${signed(result.creditAdjustment)} from the selected issuer spread`,
      ],
      [
        "Illustrative bid",
        result.bid,
        result.bid == null
          ? "No secondary quote assumed"
          : `${signed(result.exitAdjustment)} exit adjustment`,
      ],
    ];
    const maximum = Math.max(
      state.contractualAmount,
      result.defaultFree,
      result.creditAdjusted,
      result.bid || 0,
      1,
    );
    byId("credit-waterfall").innerHTML = steps
      .map(
        (step, index) =>
          `<div class="credit-step ${step[1] == null ? "unavailable" : ""}"><span>${index + 1}</span><div><strong>${esc(step[0])}</strong><p>${esc(step[2])}</p></div><b>${step[1] == null ? "—" : step[1].toFixed(2)}</b><i style="width:${step[1] == null ? 0 : (step[1] / maximum) * 100}%"></i></div>`,
      )
      .join("");
    byId("credit-message").textContent = state.defaulted
      ? "Default is not another point on the spread slider. It changes the problem from valuing scheduled promises to resolving an unsecured claim."
      : result.bid == null
        ? "The note still has an analytical value, but the selected state assumes nobody is offering an executable bid."
        : "Holding to maturity, valuing the note and selling it today answer three different questions.";
    renderCurve();
    renderPaths(result);
    renderRules();
  }

  function renderCurve() {
    const svg = byId("credit-curve");
    const curve = engine.spreadCurve(Object.assign({}, state, { defaulted: false }), 0.12, 97);
    const width = 900,
      height = 350,
      left = 64,
      right = 24,
      top = 24,
      bottom = 50;
    const values = curve.flatMap((point) => [
      point.creditAdjusted,
      ...(point.bid == null ? [] : [point.bid]),
    ]);
    const yMin = Math.floor((Math.min(...values) - 5) / 10) * 10;
    const yMax = Math.ceil((Math.max(...values) + 5) / 10) * 10;
    const x = (spread) => left + (spread / 0.12) * (width - left - right);
    const y = (value) => top + ((yMax - value) / (yMax - yMin)) * (height - top - bottom);
    const path = (key) =>
      curve
        .filter((point) => point[key] != null)
        .map(
          (point, index) =>
            `${index ? "L" : "M"}${x(point.spread).toFixed(2)},${y(point[key]).toFixed(2)}`,
        )
        .join(" ");
    const xTicks = [0, 0.03, 0.06, 0.09, 0.12];
    const yTicks = Array.from({ length: 6 }, (_, index) => yMin + ((yMax - yMin) * index) / 5);
    const selectedSpread = Math.min(0.12, Math.max(0, state.spread));
    const selected = engine.value(
      Object.assign({}, state, { spread: selectedSpread, defaulted: false }),
    );
    svg.innerHTML = `<title>Value across issuer spreads</title><desc>Issuer-adjusted model value falls as spread widens. An indicative bid is shown only when a quote is assumed available.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${formatTick(tick)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 18}" text-anchor="middle">${Math.round(tick * 10000)} bp</text>`).join("")}<path class="credit-model-line" d="${path("creditAdjusted")}"></path>${state.quoteAvailable && !state.defaulted ? `<path class="credit-bid-line" d="${path("bid")}"></path>` : ""}<line class="credit-spread-guide" x1="${x(selectedSpread)}" x2="${x(selectedSpread)}" y1="${top}" y2="${height - bottom}"></line><circle class="credit-point model" cx="${x(selectedSpread)}" cy="${y(selected.creditAdjusted)}" r="5"></circle>${selected.bid == null || state.defaulted ? "" : `<circle class="credit-point bid" cx="${x(selectedSpread)}" cy="${y(selected.bid)}" r="5"></circle>`}<text class="axis credit-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Issuer spread</text><text class="axis credit-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Value per 100 nominal</text>`;
    curveContext = { y };
    curveInspector.refresh();
  }

  function renderPaths(result) {
    const sellState = state.defaulted
      ? ["Unavailable", "Default interrupts ordinary trading"]
      : result.bid == null
        ? ["No assumed route", "No executable secondary quote"]
        : [result.bid.toFixed(2), "Cash today at the illustrative bid"];
    const holdState = state.defaulted
      ? ["Interrupted", "Original maturity promise no longer controls timing"]
      : [
          state.contractualAmount.toFixed(2),
          `Cash in ${state.remaining.toFixed(2)} years if the issuer performs`,
        ];
    const recoveryState = [
      result.recoveryScenario.toFixed(2),
      `Scenario only: ${percent(state.recoveryRate)} of a 100 nominal claim basis; timing unresolved`,
    ];
    const paths = [
      [
        "Sell before maturity",
        "A firm quote exists",
        sellState[0],
        sellState[1],
        result.bid != null && !state.defaulted ? "available" : "unavailable",
      ],
      [
        "Hold to scheduled maturity",
        "Issuer continues to perform",
        holdState[0],
        holdState[1],
        state.defaulted ? "unavailable" : "performing",
      ],
      [
        "Issuer defaults",
        "Claim enters resolution",
        recoveryState[0],
        recoveryState[1],
        state.defaulted ? "defaulted" : "contingent",
      ],
    ];
    byId("credit-paths").innerHTML = paths
      .map(
        (path) =>
          `<article class="credit-path ${path[4]}"><span>${esc(path[1])}</span><h3>${esc(path[0])}</h3><strong>${esc(path[2])}</strong><p>${esc(path[3])}</p></article>`,
      )
      .join("");
  }

  function renderRules() {
    const rows = [
      [
        "Contractual amount",
        "What the legal payoff terms schedule if the issuer performs",
        "Cash already secured or available today",
      ],
      [
        "Default-free present value",
        "What that future amount is worth using only the reference rate",
        "A tradable market price",
      ],
      [
        "Issuer-adjusted model value",
        "How the simplified mark changes after adding issuer spread",
        "A default probability, recovery forecast or firm bid",
      ],
      [
        "Indicative bid",
        "What a willing dealer might pay under the selected exit-cost assumption",
        "Guaranteed liquidity or an obligation to transact",
      ],
      [
        "Recovery scenario",
        "A sensitivity using an assumed percentage of a simplified claim basis",
        "The actual allowed claim, ranking, payment date or realised recovery",
      ],
    ];
    byId("credit-rules").innerHTML = rows
      .map(
        (row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`,
      )
      .join("");
  }

  byId("credit-reset").addEventListener("click", () => {
    state = Object.assign({}, presets.normal);
    syncControls();
    render();
  });
  createControls();
  render();
})();
