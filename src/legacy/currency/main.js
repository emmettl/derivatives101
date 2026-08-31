import * as engine from "./engine";
import { attachHorizontalInspector, attachPlaneInspector } from "../../shared/svg-interaction";

(function () {
  "use strict";

  const presets = engine.presets;
  const byId = (id) => document.getElementById(id);
  const controls = [
    {
      id: "equityTerminal",
      label: "Foreign equity at maturity",
      min: 50,
      max: 160,
      step: 1,
      format: index,
    },
    { id: "fxTerminal", label: "FX index at maturity", min: 60, max: 140, step: 1, format: index },
    { id: "strike", label: "Option strike", min: 70, max: 130, step: 1, format: index },
    {
      id: "participation",
      label: "Option participation",
      min: 0.5,
      max: 1.5,
      step: 0.05,
      format: percent,
    },
  ];
  let state = defaults();
  let framePending = false;
  let mapContext = null,
    payoffContext = null;

  const mapInspector = attachPlaneInspector(byId("currency-map"), () => {
    if (!mapContext) return null;
    return {
      ...mapContext,
      xMinimum: 50,
      xMaximum: 160,
      yMinimum: 60,
      yMaximum: 140,
      xStep: 1,
      yStep: 1,
      xValue: state.equityTerminal,
      yValue: state.fxTerminal,
      label:
        "Home-currency return map. Hover to inspect; click or drag to set terminal equity and FX together.",
      inspect: (equityTerminal, fxTerminal) => {
        const result = engine.outcomes({ ...state, equityTerminal, fxTerminal });
        return {
          title: `Equity ${equityTerminal.toFixed(0)} · FX ${fxTerminal.toFixed(0)}`,
          rows: [
            { label: "Local equity", value: signedPercent(result.localReturn) },
            { label: "FX move", value: signedPercent(result.fxReturn) },
            {
              label: "Home return",
              value: signedPercent(result.directHomeReturn),
              color: result.directHomeReturn >= 0 ? "#3e8e7e" : "#b5443a",
            },
          ],
        };
      },
      onSelect: (equityTerminal, fxTerminal) => {
        state.equityTerminal = equityTerminal;
        state.fxTerminal = fxTerminal;
        state.id = "custom";
        syncControls();
        render();
      },
    };
  });
  const payoffInspector = attachHorizontalInspector(byId("currency-payoff-chart"), () => {
    if (!payoffContext) return null;
    const { y } = payoffContext;
    return {
      width: 900,
      left: 64,
      right: 24,
      top: 24,
      bottom: 300,
      minimum: 50,
      maximum: 160,
      step: 1,
      value: state.equityTerminal,
      label:
        "Quanto and terminal-FX redemption chart. Hover to compare; click or drag to set terminal equity.",
      inspect: (equityTerminal) => {
        const result = engine.outcomes({ ...state, equityTerminal });
        return {
          title: `Foreign equity ${equityTerminal.toFixed(0)}`,
          rows: [
            {
              label: "Quanto redemption",
              value: result.quantoRedemption.toFixed(2),
              color: "#2c5670",
            },
            {
              label: "Terminal-FX redemption",
              value: result.compoRedemption.toFixed(2),
              color: "#3e8e7e",
            },
            { label: "Selected FX", value: state.fxTerminal.toFixed(0) },
          ],
          points: [
            { y: y(result.quantoRedemption), color: "#2c5670" },
            { y: y(result.compoRedemption), color: "#3e8e7e" },
          ],
        };
      },
      onSelect: (equityTerminal) => {
        state.equityTerminal = equityTerminal;
        state.id = "custom";
        syncControls();
        render();
      },
    };
  });

  function defaults() {
    return { id: "upFlat", equityTerminal: 125, fxTerminal: 100, strike: 100, participation: 1 };
  }
  function index(value) {
    return `${value.toFixed(0)} (100 initially)`;
  }
  function percent(value) {
    return `${(value * 100).toFixed(0)}%`;
  }
  function signedPercent(value, digits) {
    return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(digits == null ? 1 : digits)}%`;
  }
  function esc(value) {
    return String(value).replace(
      /[&<>"]/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  }

  function createControls() {
    byId("currency-controls").innerHTML =
      `<div class="control-block"><span class="control-title">Observed at maturity</span>${controls.slice(0, 2).map(controlMarkup).join("")}</div><div class="control-block"><span class="control-title">Option example</span>${controls.slice(2).map(controlMarkup).join("")}</div>`;
    controls.forEach((control) =>
      byId(`currency-${control.id}`).addEventListener("input", (event) => {
        state[control.id] = Number(event.target.value);
        state.id = "custom";
        scheduleRender();
      }),
    );
  }

  function controlMarkup(control) {
    return `<label class="range-control" for="currency-${control.id}"><span>${esc(control.label)} <output id="currency-${control.id}-out"></output></span><input id="currency-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${state[control.id]}"></label>`;
  }

  function renderPresets() {
    byId("currency-presets").innerHTML = Object.values(presets)
      .map(
        (preset) =>
          `<button type="button" data-preset="${preset.id}" class="${preset.id === state.id ? "on" : ""}" aria-pressed="${preset.id === state.id}">${esc(preset.name)}</button>`,
      )
      .join("");
    byId("currency-presets")
      .querySelectorAll("[data-preset]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const preset = presets[button.dataset.preset];
          state.id = preset.id;
          state.equityTerminal = preset.equityTerminal;
          state.fxTerminal = preset.fxTerminal;
          syncControls();
          render();
        }),
      );
  }

  function syncControls() {
    controls.forEach((control) => {
      byId(`currency-${control.id}`).value = state[control.id];
    });
  }
  function renderOutputs() {
    controls.forEach((control) => {
      byId(`currency-${control.id}-out`).textContent = control.format(state[control.id]);
    });
  }
  function scheduleRender() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => {
      framePending = false;
      render();
    });
  }

  function renderMap() {
    const svg = byId("currency-map");
    const width = 900,
      height = 430,
      left = 72,
      right = 26,
      top = 24,
      bottom = 58;
    const equityLevels = [50, 68.333, 86.667, 105, 123.333, 141.667, 160];
    const fxLevels = [60, 80, 100, 120, 140];
    const points = engine.grid(state, 50, 160, equityLevels.length, 60, 140, fxLevels.length);
    const plotWidth = width - left - right,
      plotHeight = height - top - bottom;
    const cellWidth = plotWidth / equityLevels.length,
      cellHeight = plotHeight / fxLevels.length;
    const x = (value) => left + cellWidth / 2 + ((value - 50) / 110) * (plotWidth - cellWidth);
    const y = (value) => top + cellHeight / 2 + ((140 - value) / 80) * (plotHeight - cellHeight);
    const selectedX = x(state.equityTerminal);
    const selectedY = y(state.fxTerminal);
    const cells = points
      .map((point) => {
        const xCell = left + point.column * cellWidth;
        const yCell = top + (fxLevels.length - 1 - point.row) * cellHeight;
        const className =
          point.directHomeReturn > 0.005
            ? "gain"
            : point.directHomeReturn < -0.005
              ? "loss"
              : "flat";
        const opacity = Math.min(0.78, 0.12 + (Math.abs(point.directHomeReturn) / 0.65) * 0.66);
        return `<g><rect class="currency-cell ${className}" x="${xCell}" y="${yCell}" width="${cellWidth}" height="${cellHeight}" fill-opacity="${opacity.toFixed(2)}"></rect><text class="currency-cell-label" x="${xCell + cellWidth / 2}" y="${yCell + cellHeight / 2 + 4}" text-anchor="middle">${signedPercent(point.directHomeReturn, 0)}</text></g>`;
      })
      .join("");
    const zeroPoints = [];
    for (let equity = 72; equity <= 160; equity += 1) {
      const fx = 10000 / equity;
      if (fx >= 60 && fx <= 140) zeroPoints.push([x(equity), y(fx)]);
    }
    const zeroPath = zeroPoints
      .map(
        (point, indexValue) =>
          `${indexValue ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`,
      )
      .join(" ");
    svg.innerHTML = `<title>Home-currency return map</title><desc>The local equity factor is multiplied by the FX factor. Green cells are gains, red cells are losses, and the curved line shows combinations with zero home-currency return.</desc>${cells}<path class="currency-zero-line" d="${zeroPath}"></path>${equityLevels.map((tick) => `<text class="axis" x="${left + (equityLevels.indexOf(tick) + 0.5) * cellWidth}" y="${height - bottom + 20}" text-anchor="middle">${tick.toFixed(0)}</text>`).join("")}${fxLevels.map((tick) => `<text class="axis" x="${left - 10}" y="${top + (fxLevels.length - 1 - fxLevels.indexOf(tick) + 0.5) * cellHeight + 3}" text-anchor="end">${tick}</text>`).join("")}<line class="currency-selected-cross" x1="${selectedX}" x2="${selectedX}" y1="${Math.max(top, selectedY - 12)}" y2="${Math.min(height - bottom, selectedY + 12)}"></line><line class="currency-selected-cross" x1="${Math.max(left, selectedX - 12)}" x2="${Math.min(width - right, selectedX + 12)}" y1="${selectedY}" y2="${selectedY}"></line><circle class="currency-selected-point" cx="${selectedX}" cy="${selectedY}" r="6"></circle><text class="axis currency-axis-title" x="${(left + width - right) / 2}" y="${height - 9}" text-anchor="middle">Foreign equity terminal level</text><text class="axis currency-axis-title" x="16" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 16 ${(top + height - bottom) / 2})">FX index: home currency per foreign currency</text>`;
    mapContext = {
      width,
      height,
      left: left + cellWidth / 2,
      right: right + cellWidth / 2,
      top: top + cellHeight / 2,
      bottom: bottom + cellHeight / 2,
    };
    mapInspector.refresh();
  }

  function renderOptions(result) {
    const cards = [
      [
        result.intrinsicForeign.toFixed(2),
        "Foreign-currency intrinsic",
        `max(${state.equityTerminal.toFixed(0)} − ${state.strike.toFixed(0)}, 0) before ${percent(state.participation)} participation`,
      ],
      [
        result.quantoRedemption.toFixed(2),
        "Fixed-rate quanto redemption",
        `100 principal + ${result.quantoOption.toFixed(2)} home-currency option payoff`,
      ],
      [
        result.compoRedemption.toFixed(2),
        "Terminal-FX redemption",
        `100 principal + ${result.compoOption.toFixed(2)} after the ${result.fxFactor.toFixed(2)} FX multiplier`,
      ],
    ];
    byId("currency-options").innerHTML = cards
      .map(
        (card, indexValue) =>
          `<article class="${indexValue === 1 ? "quanto" : indexValue === 2 ? "compo" : "local"}"><span>${esc(card[1])}</span><strong>${esc(card[0])}</strong><p>${esc(card[2])}</p></article>`,
      )
      .join("");
    const difference = result.compoRedemption - result.quantoRedemption;
    byId("currency-option-note").textContent =
      result.intrinsicForeign === 0
        ? "The call is out of the money, so the conversion rule has no terminal payoff to convert. Both examples return the illustrative 100 principal."
        : `At this equity level, terminal FX conversion changes redemption by ${difference >= 0 ? "+" : "−"}${Math.abs(difference).toFixed(2)} versus the fixed-rate quanto example. This is payoff arithmetic, not the difference in fair value.`;
    renderPayoffChart();
  }

  function renderPayoffChart() {
    const svg = byId("currency-payoff-chart");
    const points = engine.payoffCurve(state, 50, 160, 111);
    const width = 900,
      height = 350,
      left = 64,
      right = 24,
      top = 24,
      bottom = 50;
    const yMaximum =
      Math.ceil(
        Math.max(
          ...points.flatMap((point) => [point.quantoRedemption, point.compoRedemption]),
          110,
        ) / 25,
      ) * 25;
    const yMinimum = 95;
    const x = (value) => left + ((value - 50) / 110) * (width - left - right);
    const y = (value) =>
      top + ((yMaximum - value) / (yMaximum - yMinimum)) * (height - top - bottom);
    const path = (key) =>
      points
        .map(
          (point, indexValue) =>
            `${indexValue ? "L" : "M"}${x(point.equityTerminal).toFixed(2)},${y(point[key]).toFixed(2)}`,
        )
        .join(" ");
    const xTicks = [50, 75, 100, 125, 150];
    const yTicks = Array.from(
      { length: 6 },
      (_, indexValue) => yMinimum + ((yMaximum - yMinimum) * indexValue) / 5,
    );
    const selected = engine.outcomes(state);
    svg.innerHTML = `<title>Quanto and terminally converted redemptions</title><desc>Both examples add a call payoff to 100 principal. The quanto line uses a fixed conversion factor of one. The other line uses the selected terminal FX factor.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 18}" text-anchor="middle">${tick}</text>`).join("")}<line class="currency-principal-line" x1="${left}" x2="${width - right}" y1="${y(100)}" y2="${y(100)}"></line><path class="currency-quanto-line" d="${path("quantoRedemption")}"></path><path class="currency-compo-line" d="${path("compoRedemption")}"></path><line class="currency-payoff-guide" x1="${x(state.equityTerminal)}" x2="${x(state.equityTerminal)}" y1="${top}" y2="${height - bottom}"></line><circle class="currency-payoff-point quanto" cx="${x(state.equityTerminal)}" cy="${y(selected.quantoRedemption)}" r="5"></circle><circle class="currency-payoff-point compo" cx="${x(state.equityTerminal)}" cy="${y(selected.compoRedemption)}" r="5"></circle><text class="axis currency-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Foreign equity terminal level</text><text class="axis currency-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Home-currency redemption</text>`;
    payoffContext = { y };
    payoffInspector.refresh();
  }

  function renderFlow(result) {
    const items = [
      [
        "01",
        "Observe foreign equity",
        `${state.equityTerminal.toFixed(0)} terminal level; ${signedPercent(result.localReturn)} locally`,
      ],
      [
        "02",
        "Calculate local intrinsic",
        `${result.intrinsicForeign.toFixed(2)} foreign-currency units before participation`,
      ],
      [
        "03A",
        "Quanto route",
        `Multiply by fixed 1.00 conversion → ${result.quantoOption.toFixed(2)} home-currency payoff`,
      ],
      [
        "03B",
        "Terminal-FX route",
        `Multiply by ${result.fxFactor.toFixed(2)} observed FX → ${result.compoOption.toFixed(2)} home-currency payoff`,
      ],
      [
        "04",
        "Settle in home currency",
        `Return principal plus the payoff from the specified route`,
      ],
    ];
    byId("currency-flow").innerHTML = items
      .map(
        (item) =>
          `<div><span>${esc(item[0])}</span><strong>${esc(item[1])}</strong><p>${esc(item[2])}</p></div>`,
      )
      .join("");
  }

  function renderLedger() {
    const rows = Object.values(presets).map((preset) => {
      const result = engine.outcomes(Object.assign({}, state, preset));
      return [
        preset.name,
        preset.equityTerminal.toFixed(0),
        preset.fxTerminal.toFixed(0),
        signedPercent(result.localReturn),
        signedPercent(result.directHomeReturn),
        result.quantoRedemption.toFixed(2),
        result.compoRedemption.toFixed(2),
        preset.id === state.id,
      ];
    });
    if (state.id === "custom") {
      const result = engine.outcomes(state);
      rows.unshift([
        "Custom selection",
        state.equityTerminal.toFixed(0),
        state.fxTerminal.toFixed(0),
        signedPercent(result.localReturn),
        signedPercent(result.directHomeReturn),
        result.quantoRedemption.toFixed(2),
        result.compoRedemption.toFixed(2),
        true,
      ]);
    }
    byId("currency-ledger").innerHTML = rows
      .map(
        (row) =>
          `<tr class="${row[7] ? "selected-row" : ""}">${row
            .slice(0, 7)
            .map((cell) => `<td>${esc(cell)}</td>`)
            .join("")}</tr>`,
      )
      .join("");
  }

  function renderRules() {
    const rows = [
      [
        "Currency roles",
        "Which currency defines the underlying, strike, payoff calculation, nominal and settlement?",
        "The same number can mean a foreign amount or home-currency cash.",
      ],
      [
        "Quote direction",
        "Is FX quoted as home per foreign unit or foreign per home unit?",
        "The reciprocal quote reverses the meaning of an FX increase.",
      ],
      [
        "Conversion rule",
        "Is the rate fixed at trade date, observed at maturity, averaged or absent?",
        "This determines whether terminal FX directly multiplies the payoff.",
      ],
      [
        "Observation source",
        "Which administrator, screen, fixing time, location and publication is authoritative?",
        "Two valid market observations need not be identical.",
      ],
      [
        "Date alignment",
        "What happens when the equity market and FX market have different holidays or disruptions?",
        "The two inputs may otherwise refer to different economic moments.",
      ],
      [
        "Disruption fallback",
        "What hierarchy applies if the equity close or FX fixing is unavailable?",
        "A formula needs a deterministic route through missing data.",
      ],
      [
        "Settlement",
        "Is delivery cash or physical, in which currency, on what date and with what rounding?",
        "Calculation is not complete until the holder's receivable is specified.",
      ],
      [
        "Pricing inputs",
        "Which domestic/foreign curves, equity vol, FX vol and equity–FX correlation feed valuation?",
        "These can affect fair value even when terminal FX is absent from a quanto payoff formula.",
      ],
    ];
    byId("currency-rules").innerHTML = rows
      .map(
        (row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`,
      )
      .join("");
  }

  function render() {
    const result = engine.outcomes(state);
    renderPresets();
    renderOutputs();
    const label = state.id === "custom" ? "Custom terminal scenario" : presets[state.id].name;
    byId("currency-headline").textContent = label;
    byId("currency-summary").textContent =
      `The foreign equity returns ${signedPercent(result.localReturn)} locally. After multiplying by the ${result.fxFactor.toFixed(2)} FX factor, a direct holding is worth ${result.directHomeValue.toFixed(2)} in the home currency: ${signedPercent(result.directHomeReturn)}.`;
    const stats = [
      [
        signedPercent(result.localReturn),
        "Local equity return",
        `${state.equityTerminal.toFixed(0)} versus 100 initially`,
      ],
      [
        signedPercent(result.fxReturn),
        "FX return",
        result.fxReturn >= 0 ? "Foreign currency strengthened" : "Foreign currency weakened",
      ],
      [
        result.directHomeValue.toFixed(2),
        "Home value of direct holding",
        "Equity factor × FX factor × 100",
      ],
      [
        signedPercent(result.directHomeReturn),
        "Home-currency return",
        "The return the home-currency holder experiences",
      ],
    ];
    byId("currency-stats").innerHTML = stats
      .map(
        (stat) =>
          `<div><span>${esc(stat[1])}</span><strong>${esc(stat[0])}</strong><p>${esc(stat[2])}</p></div>`,
      )
      .join("");
    renderMap();
    renderOptions(result);
    renderFlow(result);
    renderLedger();
    renderRules();
  }

  byId("currency-reset").addEventListener("click", () => {
    state = defaults();
    syncControls();
    render();
  });
  createControls();
  render();
})();
