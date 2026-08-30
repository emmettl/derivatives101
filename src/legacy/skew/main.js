import * as engine from "./engine";

(function () {
  "use strict";

  const presets = engine.presets;
  const byId = (id) => document.getElementById(id);
  const controls = [
    {
      id: "atmVolatility",
      label: "ATM implied volatility",
      min: 0.08,
      max: 0.5,
      step: 0.01,
      format: percent,
    },
    {
      id: "skew",
      label: "Skew slope",
      min: -0.4,
      max: 0.4,
      step: 0.01,
      format: (value) =>
        `${value >= 0 ? "+" : "−"}${Math.abs(value * 10).toFixed(1)} vol pts / +10% strike`,
    },
    {
      id: "curvature",
      label: "Smile curvature",
      min: 0,
      max: 0.9,
      step: 0.01,
      format: (value) => value.toFixed(2),
    },
    {
      id: "tenor",
      label: "Option tenor",
      min: 0.25,
      max: 5,
      step: 0.25,
      format: (value) => `${value.toFixed(2)} years`,
    },
    { id: "putStrike", label: "Downside put strike", min: 60, max: 100, step: 1, format: strike },
    { id: "callStrike", label: "Upside call strike", min: 100, max: 140, step: 1, format: strike },
  ];
  let state = defaults();
  let framePending = false;

  function defaults() {
    return {
      presetId: "equity",
      spot: 100,
      atmVolatility: 0.2,
      skew: presets.equity.skew,
      curvature: presets.equity.curvature,
      tenor: 2,
      rate: 0.03,
      dividend: 0.02,
      putStrike: 70,
      callStrike: 110,
      optionBudget: 10,
    };
  }
  function percent(value) {
    return `${(value * 100).toFixed(1)}%`;
  }
  function strike(value) {
    return `${value.toFixed(0)}% of spot`;
  }
  function signed(value, digits) {
    return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits == null ? 2 : digits)}`;
  }
  function esc(value) {
    return String(value).replace(
      /[&<>"]/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  }

  function createControls() {
    byId("skew-controls").innerHTML =
      `<div class="control-block"><span class="control-title">Curve</span>${controls.slice(0, 4).map(controlMarkup).join("")}</div><div class="control-block"><span class="control-title">Product strikes</span>${controls.slice(4).map(controlMarkup).join("")}</div>`;
    controls.forEach((control) =>
      byId(`skew-${control.id}`).addEventListener("input", (event) => {
        state[control.id] = Number(event.target.value);
        state.presetId = "custom";
        scheduleRender();
      }),
    );
  }

  function controlMarkup(control) {
    return `<label class="range-control" for="skew-${control.id}"><span>${esc(control.label)} <output id="skew-${control.id}-out"></output></span><input id="skew-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${state[control.id]}"></label>`;
  }

  function renderPresets() {
    byId("skew-presets").innerHTML = Object.values(presets)
      .map(
        (preset) =>
          `<button type="button" data-preset="${preset.id}" class="${preset.id === state.presetId ? "on" : ""}" aria-pressed="${preset.id === state.presetId}">${esc(preset.name)}</button>`,
      )
      .join("");
    byId("skew-presets")
      .querySelectorAll("[data-preset]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const preset = presets[button.dataset.preset];
          state.presetId = preset.id;
          state.skew = preset.skew;
          state.curvature = preset.curvature;
          syncControls();
          render();
        }),
      );
  }

  function syncControls() {
    controls.forEach((control) => {
      byId(`skew-${control.id}`).value = state[control.id];
    });
  }
  function renderOutputs() {
    controls.forEach((control) => {
      byId(`skew-${control.id}-out`).textContent = control.format(state[control.id]);
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

  function renderCurve(curve, terms) {
    const svg = byId("skew-curve-chart");
    const width = 900,
      height = 350,
      left = 66,
      right = 24,
      top = 24,
      bottom = 50;
    const vols = curve.flatMap((point) => [point.localVolatility, state.atmVolatility]);
    const minimum = Math.max(0, Math.floor((Math.min(...vols) - 0.02) * 20) / 20);
    const maximum = Math.ceil((Math.max(...vols) + 0.02) * 20) / 20;
    const x = (strikeValue) => left + ((strikeValue - 60) / 80) * (width - left - right);
    const y = (volatility) =>
      top + ((maximum - volatility) / (maximum - minimum)) * (height - top - bottom);
    const line = curve
      .map(
        (point, index) =>
          `${index ? "L" : "M"}${x(point.strike).toFixed(2)},${y(point.localVolatility).toFixed(2)}`,
      )
      .join(" ");
    const xTicks = [60, 80, 100, 120, 140];
    const yTicks = Array.from(
      { length: 6 },
      (_, index) => minimum + ((maximum - minimum) * index) / 5,
    );
    svg.innerHTML = `<title>Implied volatility across strikes</title><desc>The flat line uses one volatility at every strike. The shaped curve applies the selected skew and curvature.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${percent(tick)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 18}" text-anchor="middle">${tick}</text>`).join("")}<line class="skew-flat-line" x1="${left}" x2="${width - right}" y1="${y(state.atmVolatility)}" y2="${y(state.atmVolatility)}"></line><path class="skew-surface-line" d="${line}"></path><line class="skew-selected-guide put" x1="${x(state.putStrike)}" x2="${x(state.putStrike)}" y1="${top}" y2="${height - bottom}"></line><line class="skew-selected-guide call" x1="${x(state.callStrike)}" x2="${x(state.callStrike)}" y1="${top}" y2="${height - bottom}"></line><circle class="skew-point put" cx="${x(state.putStrike)}" cy="${y(terms.putPoint.localVolatility)}" r="5"></circle><circle class="skew-point call" cx="${x(state.callStrike)}" cy="${y(terms.callPoint.localVolatility)}" r="5"></circle><text class="axis skew-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Strike (% of spot)</text><text class="axis skew-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Implied volatility</text>`;
  }

  function renderOptionFacet(id, points, key, title, selectedStrike) {
    const svg = byId(id);
    const width = 420,
      height = 300,
      left = 58,
      right = 14,
      top = 34,
      bottom = 46;
    const strikes = points.map((point) => point.strike);
    const values = points.flatMap((point) => [point.flat[key], point.surface[key]]);
    const minimumStrike = Math.min(...strikes),
      maximumStrike = Math.max(...strikes);
    const maximumValue = Math.ceil((Math.max(...values) + 1) / 2) * 2;
    const x = (strikeValue) =>
      left +
      ((strikeValue - minimumStrike) / (maximumStrike - minimumStrike)) * (width - left - right);
    const y = (value) => top + ((maximumValue - value) / maximumValue) * (height - top - bottom);
    const path = (source) =>
      points
        .map(
          (point, index) =>
            `${index ? "L" : "M"}${x(point.strike).toFixed(2)},${y(point[source][key]).toFixed(2)}`,
        )
        .join(" ");
    const xTicks = [minimumStrike, (minimumStrike + maximumStrike) / 2, maximumStrike];
    const yTicks = Array.from({ length: 5 }, (_, index) => (maximumValue * index) / 4);
    const selected = engine.point(state, selectedStrike);
    svg.innerHTML = `<title>${esc(title)}</title><desc>Option values under flat ATM volatility and strike-specific volatility.</desc><text class="skew-price-title" x="${left}" y="18">${esc(title)}</text>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 7}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(1)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 17}" text-anchor="middle">${tick.toFixed(0)}</text>`).join("")}<path class="skew-price-flat-line" d="${path("flat")}"></path><path class="skew-price-surface-line" d="${path("surface")}"></path><line class="skew-price-guide" x1="${x(selectedStrike)}" x2="${x(selectedStrike)}" y1="${top}" y2="${height - bottom}"></line><circle class="skew-price-point flat" cx="${x(selectedStrike)}" cy="${y(selected.flat[key])}" r="4"></circle><circle class="skew-price-point surface" cx="${x(selectedStrike)}" cy="${y(selected.surface[key])}" r="4"></circle><text class="axis skew-price-axis" x="${(left + width - right) / 2}" y="${height - 6}" text-anchor="middle">Strike</text><text class="axis skew-price-axis" x="12" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(top + height - bottom) / 2})">Option value</text>`;
  }

  function renderPriceCharts(curve) {
    renderOptionFacet(
      "skew-put-chart",
      curve.filter((point) => point.strike <= 100),
      "put",
      "Downside put values",
      state.putStrike,
    );
    renderOptionFacet(
      "skew-call-chart",
      curve.filter((point) => point.strike >= 100),
      "call",
      "Upside call values",
      state.callStrike,
    );
  }

  function renderProducts(terms) {
    const products = [
      {
        name: "Reverse convertible",
        label: `Short ${state.putStrike.toFixed(0)} put`,
        flatLabel: "Flat-vol coupon equivalent",
        flatValue: percent(terms.flatCoupon),
        curveLabel: "Curve coupon equivalent",
        curveValue: percent(terms.surfaceCoupon),
        copy: `The scaled put liability costs ${terms.flatPutCost.toFixed(2)} under flat volatility and ${terms.surfacePutCost.toFixed(2)} on the curve.`,
      },
      {
        name: "Capital-protected note",
        label: `Long ${state.callStrike.toFixed(0)} call`,
        flatLabel: "Flat-vol participation",
        flatValue: percent(terms.flatParticipation),
        curveLabel: "Curve participation",
        curveValue: percent(terms.surfaceParticipation),
        copy: `A fixed ${state.optionBudget.toFixed(0)}-point option budget buys different participation because the call costs ${terms.callPoint.flat.call.toFixed(2)} versus ${terms.callPoint.surface.call.toFixed(2)}.`,
      },
    ];
    byId("skew-products").innerHTML = products
      .map(
        (product) =>
          `<article><span>${esc(product.label)}</span><h3>${esc(product.name)}</h3><div class="skew-term-compare"><div><small>${esc(product.flatLabel)}</small><strong>${esc(product.flatValue)}</strong></div><div><small>${esc(product.curveLabel)}</small><strong>${esc(product.curveValue)}</strong></div></div><p>${esc(product.copy)}</p></article>`,
      )
      .join("");
    const putChange = terms.surfacePutCost - terms.flatPutCost;
    const participationChange = (terms.surfaceParticipation - terms.flatParticipation) * 100;
    byId("skew-product-note").textContent =
      `With the selected curve, the downside put budget changes by ${signed(putChange)} points and the upside participation changes by ${signed(participationChange, 1)} percentage points versus flat ATM volatility.`;
  }

  function renderSheet() {
    const strikes = [60, 70, 80, 90, 100, 110, 120, 130, 140];
    byId("skew-sheet").innerHTML = strikes
      .map((strikeValue) => {
        const point = engine.point(state, strikeValue);
        const key = strikeValue < state.spot ? "put" : "call";
        const label =
          strikeValue === state.spot ? "ATM call" : key === "put" ? "OTM put" : "OTM call";
        const change = point.surface[key] - point.flat[key];
        const selected = strikeValue === state.putStrike || strikeValue === state.callStrike;
        return `<tr class="${selected ? "selected-row" : ""}"><td>${strikeValue}</td><td>${label}</td><td>${percent(point.localVolatility)}</td><td>${point.flat[key].toFixed(3)}</td><td>${point.surface[key].toFixed(3)}</td><td class="${change < 0 ? "event-negative" : change > 0 ? "event-positive" : "event-neutral"}">${signed(change, 3)}</td></tr>`;
      })
      .join("");
  }

  function renderRules() {
    const rows = [
      [
        "Quote convention",
        "Is volatility mapped by strike, moneyness, forward moneyness or delta?",
        "The same numeric quote can identify a different option",
      ],
      [
        "Market side",
        "Use bid, mid, offer or a calibrated executable level?",
        "A product buys some options and sells others",
      ],
      [
        "Interpolation",
        "How are unquoted strikes and expiries filled between observations?",
        "Product strikes rarely land exactly on liquid quotes",
      ],
      [
        "Extrapolation",
        "What happens outside the quoted strike range?",
        "Deep barriers and tails can depend on sparse data",
      ],
      [
        "Dynamics",
        "When spot moves, is the surface sticky by strike, moneyness, delta or a model rule?",
        "Revaluation and hedging require tomorrow’s surface, not only today’s",
      ],
      [
        "Calibration controls",
        "Which arbitrage, smoothness and stale-quote checks apply?",
        "A visually smooth curve can still imply inconsistent option prices",
      ],
      [
        "Fallbacks",
        "What source, timestamp and hierarchy apply when quotes are missing or markets are disrupted?",
        "“Use market volatility” does not define an operational result",
      ],
    ];
    byId("skew-rules").innerHTML = rows
      .map(
        (row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`,
      )
      .join("");
  }

  function render() {
    const curve = engine.curve(state, 60, 140, 97);
    const terms = engine.productTerms(state);
    renderPresets();
    renderOutputs();
    const preset = presets[state.presetId];
    byId("skew-headline").textContent = preset ? preset.name : "Custom volatility curve";
    byId("skew-summary").textContent =
      `The ${state.putStrike.toFixed(0)} put uses ${percent(terms.putPoint.localVolatility)} rather than ${percent(state.atmVolatility)}; the ${state.callStrike.toFixed(0)} call uses ${percent(terms.callPoint.localVolatility)}. Strike selection and volatility selection are therefore one pricing decision, not two independent inputs.`;
    const stats = [
      [percent(state.atmVolatility), "ATM volatility", "The anchor, not the whole curve"],
      [
        percent(terms.putPoint.localVolatility),
        `${state.putStrike.toFixed(0)} put volatility`,
        `${signed((terms.putPoint.localVolatility - state.atmVolatility) * 100, 1)} points versus ATM`,
      ],
      [
        percent(terms.callPoint.localVolatility),
        `${state.callStrike.toFixed(0)} call volatility`,
        `${signed((terms.callPoint.localVolatility - state.atmVolatility) * 100, 1)} points versus ATM`,
      ],
      [
        `${((terms.putPoint.localVolatility - terms.callPoint.localVolatility) * 100).toFixed(1)} vol pts`,
        "Put–call vol gap",
        "Selected downside minus upside volatility",
      ],
    ];
    byId("skew-stats").innerHTML = stats
      .map(
        (stat) =>
          `<div><span>${esc(stat[1])}</span><strong>${esc(stat[0])}</strong><p>${esc(stat[2])}</p></div>`,
      )
      .join("");
    renderCurve(curve, terms);
    renderPriceCharts(curve);
    renderProducts(terms);
    renderSheet();
    renderRules();
  }

  byId("skew-reset").addEventListener("click", () => {
    state = defaults();
    syncControls();
    render();
  });
  createControls();
  render();
})();
