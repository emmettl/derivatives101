(function () {
  "use strict";

  const engine = window.RiskEngine;
  const products = engine.designProducts();
  let state = { productId: "protected", lifeFraction: 0.5, spot: 100, volatility: products.protected.issueVolatility, rate: 0.03, issuerSpread: 0.015, dividend: 0.02 };
  const byId = (id) => document.getElementById(id);
  const controls = [
    { id: "lifeFraction", label: "Term remaining", min: 0.1, max: 1, step: 0.05, format: (value, note) => `${(value * note.tenor).toFixed(2)} years` },
    { id: "spot", label: "Underlying level", min: 40, max: 160, step: 1, format: (value) => value.toFixed(0) },
    { id: "volatility", label: "Implied volatility", min: 0.05, max: 0.6, step: 0.01, format: (value) => `${(value * 100).toFixed(0)}%` },
    { id: "rate", label: "Reference rate", min: -0.01, max: 0.08, step: 0.0025, format: percent },
    { id: "issuerSpread", label: "Issuer spread", min: 0.0025, max: 0.08, step: 0.0025, format: percent },
    { id: "dividend", label: "Dividend yield", min: 0, max: 0.06, step: 0.0025, format: percent }
  ];

  function percent(value) { return `${(value * 100).toFixed(2)}%`; }
  function esc(value) { return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char])); }
  function signed(value, digits) { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits == null ? 3 : digits)}`; }
  function note() { return products[state.productId]; }
  function market() { return { spot: state.spot, remaining: state.lifeFraction * note().tenor, volatility: state.volatility, rate: state.rate, issuerSpread: state.issuerSpread, dividend: state.dividend }; }

  function createControls() {
    byId("risk-controls").innerHTML = `<div class="control-block">${controls.slice(0, 2).map(controlMarkup).join("")}</div><div class="control-block"><span class="control-title">Market inputs</span>${controls.slice(2).map(controlMarkup).join("")}</div>`;
    controls.forEach((control) => {
      byId(`risk-${control.id}`).addEventListener("input", (event) => {
        state[control.id] = Number(event.target.value);
        render();
      });
    });
  }

  function controlMarkup(control) {
    return `<label class="range-control" for="risk-${control.id}"><span>${esc(control.label)} <output id="risk-${control.id}-out"></output></span><input id="risk-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${state[control.id]}"></label>`;
  }

  function renderProducts() {
    byId("risk-products").innerHTML = Object.values(products).map((product) => `<button type="button" data-product="${product.id}" class="${product.id === state.productId ? "on" : ""}" aria-pressed="${product.id === state.productId}">${esc(product.name)}</button>`).join("");
    byId("risk-products").querySelectorAll("[data-product]").forEach((button) => {
      button.addEventListener("click", () => {
        state.productId = button.dataset.product;
        state.lifeFraction = 0.5;
        state.volatility = note().issueVolatility;
        syncControls();
        render();
      });
    });
  }

  function syncControls() {
    controls.forEach((control) => { byId(`risk-${control.id}`).value = state[control.id]; });
  }

  function renderControlOutputs() {
    controls.forEach((control) => { byId(`risk-${control.id}-out`).textContent = control.format(state[control.id], note()); });
  }

  function renderSummary(risk) {
    const protectedProduct = note().id === "protected";
    byId("risk-headline").textContent = protectedProduct ? "Long call · positive curvature" : "Short put · negative curvature";
    const signText = protectedProduct ? "positive gamma and vega" : "negative gamma and vega";
    byId("risk-summary").textContent = `${note().name} model value ${risk.value.toFixed(2)} at spot ${state.spot.toFixed(0)}. Its ${note().description.toLowerCase()} construction produces ${signText} near the selected point.`;
  }

  function renderStats(risk) {
    const stats = [
      [risk.delta.toFixed(3), "Delta", "Value change for a very small +1 spot move"],
      [signed(risk.gamma, 4), "Gamma", "Approximate change in delta for +1 spot"],
      [signed(risk.vegaOnePoint, 3), "Vega · +1 vol point", "Value change for volatility +1 percentage point"],
      [signed(risk.oneMonthCarry, 3), "One-month carry", "Value change if only one month passes"]
    ];
    byId("risk-stats").innerHTML = stats.map((item) => `<div><span>${esc(item[1])}</span><strong class="${item[0].startsWith("−") ? "event-negative" : ""}">${esc(item[0])}</strong><p>${esc(item[2])}</p></div>`).join("");
    if (note().id === "protected") {
      byId("risk-interpretation").textContent = "The long call makes value convex: delta tends to rise as spot rises. Higher implied volatility generally increases the option component.";
    } else {
      byId("risk-interpretation").textContent = "The investor is short the put: value still rises with spot, but delta tends to fall as spot rises. Higher implied volatility makes the embedded liability more expensive.";
    }
  }

  function renderValueChart(curve, currentRisk) {
    const svg = byId("risk-value-chart");
    const width = 900, height = 360, left = 62, right = 24, top = 24, bottom = 48;
    const allValues = curve.flatMap((point) => [point.value, point.maturityPayoff]);
    const yMin = Math.floor((Math.min(...allValues) - 7) / 10) * 10;
    const yMax = Math.ceil((Math.max(...allValues) + 7) / 10) * 10;
    const x = (spot) => left + (spot - 40) / 120 * (width - left - right);
    const y = (value) => top + (yMax - value) / (yMax - yMin) * (height - top - bottom);
    const path = (key) => curve.map((point, index) => `${index ? "L" : "M"}${x(point.spot).toFixed(2)},${y(point[key]).toFixed(2)}`).join(" ");
    const xTicks = [40, 70, 100, 130, 160];
    const yTicks = Array.from({ length: 6 }, (_, index) => yMin + (yMax - yMin) * index / 5);
    const payoff = engine.maturityPayoff(note(), state.spot);
    svg.innerHTML = `<title>Current value and maturity redemption</title><desc>The current value curve is smooth because time remains. The maturity redemption has a kink at the strike.</desc>${gridMarkup(xTicks, yTicks, x, y, width, height, left, right, top, bottom)}<path class="risk-payoff-line" d="${path("maturityPayoff")}"></path><path class="risk-value-line" d="${path("value")}"></path><line class="risk-spot-guide" x1="${x(state.spot)}" x2="${x(state.spot)}" y1="${top}" y2="${height - bottom}"></line><circle class="risk-point value" cx="${x(state.spot)}" cy="${y(currentRisk.value)}" r="5"></circle><circle class="risk-point payoff" cx="${x(state.spot)}" cy="${y(payoff)}" r="5"></circle><text class="axis risk-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Underlying level</text><text class="axis risk-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Value per 100 nominal</text>`;
  }

  function gridMarkup(xTicks, yTicks, x, y, width, height, left, right, top, bottom) {
    return `${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${formatTick(tick)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 18}" text-anchor="middle">${tick}</text>`).join("")}`;
  }

  function formatTick(value) {
    const magnitude = Math.abs(value);
    if (magnitude >= 10) return value.toFixed(0);
    if (magnitude >= 1) return value.toFixed(1);
    return value.toFixed(3);
  }

  function renderFacet(id, curve, key, title, unit, currentRisk) {
    const svg = byId(id);
    const width = 360, height = 250, left = 52, right = 12, top = 30, bottom = 38;
    const values = curve.map((point) => point[key]).concat([0]);
    let minimum = Math.min(...values), maximum = Math.max(...values);
    const pad = Math.max((maximum - minimum) * 0.12, 0.0001);
    minimum -= pad; maximum += pad;
    const x = (spot) => left + (spot - 40) / 120 * (width - left - right);
    const y = (value) => top + (maximum - value) / (maximum - minimum) * (height - top - bottom);
    const path = curve.map((point, index) => `${index ? "L" : "M"}${x(point.spot).toFixed(2)},${y(point[key]).toFixed(2)}`).join(" ");
    const xTicks = [40, 100, 160];
    const yTicks = Array.from({ length: 4 }, (_, index) => minimum + (maximum - minimum) * index / 3);
    svg.innerHTML = `<title>${esc(title)} across underlying levels</title><desc>${esc(unit)} for the selected product and remaining tenor.</desc><text class="risk-facet-title" x="${left}" y="17">${esc(title)}</text>${gridMarkup(xTicks, yTicks, x, y, width, height, left, right, top, bottom)}<line class="risk-zero-line" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"></line><path class="risk-facet-line" d="${path}"></path><line class="risk-facet-guide" x1="${x(state.spot)}" x2="${x(state.spot)}" y1="${top}" y2="${height - bottom}"></line><circle class="risk-facet-point" cx="${x(state.spot)}" cy="${y(currentRisk[key])}" r="4"></circle><text class="axis risk-facet-axis" x="${(left + width - right) / 2}" y="${height - 6}" text-anchor="middle">Underlying</text><text class="axis risk-facet-axis" x="12" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(top + height - bottom) / 2})">${esc(unit)}</text>`;
  }

  function renderComponents(marked) {
    const entries = [
      ["Issuer bond", marked.components.bond],
      ...(Math.abs(marked.components.coupons) > 0.0001 ? [["Remaining coupons", marked.components.coupons]] : []),
      [note().id === "protected" ? "Long call" : "Short put", marked.components.option]
    ];
    const maximum = Math.max(...entries.map((item) => Math.abs(item[1])), 0.01);
    byId("risk-components").innerHTML = entries.map((entry) => {
      const width = Math.abs(entry[1]) / maximum * 48;
      return `<div><span>${esc(entry[0])}</span><div class="component-track"><i class="component-bar ${entry[1] >= 0 ? "positive" : "negative"}" style="width:${width}%;${entry[1] >= 0 ? "left:50%" : "right:50%"}"></i></div><strong class="${entry[1] < 0 ? "event-negative" : "event-positive"}">${signed(entry[1], 2)}</strong></div>`;
    }).join("");
    byId("component-total").innerHTML = `Component total <strong>${marked.value.toFixed(2)}</strong>. At issue the illustrative estimated value was 98.00.`;
    if (note().id === "protected") {
      byId("risk-build-copy").textContent = `The debt component creates the floor. A ${(note().participation * 100).toFixed(1)}% long call creates positive gamma and vega.`;
    } else {
      byId("risk-build-copy").textContent = `The ${(note().couponRate * 100).toFixed(2)}% continuous-equivalent coupon helps fund a short put. That liability creates negative gamma and vega.`;
    }
  }

  function renderShocks(base) {
    const m = market();
    const oneMonth = Math.max(0, m.remaining - Math.min(1 / 12, m.remaining));
    const shocks = [
      ["Underlying +10", Object.assign({}, m, { spot: m.spot + 10 })],
      ["Underlying −10", Object.assign({}, m, { spot: Math.max(0.01, m.spot - 10) })],
      ["Volatility +5 points", Object.assign({}, m, { volatility: m.volatility + 0.05 })],
      ["Reference rate +100 bp", Object.assign({}, m, { rate: m.rate + 0.01 })],
      ["Issuer spread +100 bp", Object.assign({}, m, { issuerSpread: m.issuerSpread + 0.01 })],
      ["One month passes", Object.assign({}, m, { remaining: oneMonth })]
    ];
    byId("risk-shocks").innerHTML = shocks.map((shock) => {
      const shocked = engine.value(note(), shock[1]).value;
      const change = shocked - base.value;
      return `<tr><td>${esc(shock[0])}</td><td>${shocked.toFixed(2)}</td><td class="${change < 0 ? "event-negative" : change > 0 ? "event-positive" : "event-neutral"}">${signed(change, 2)}</td></tr>`;
    }).join("");
  }

  function renderRules() {
    const rows = [
      ["Delta", "Central change in model value for a very small change in spot", "It is not the maturity participation rate and is not constant"],
      ["Gamma", "Central change in delta per one spot unit", "A large move contains gamma; delta alone will not predict it"],
      ["Vega", "Model-value change for implied volatility +1 percentage point", "It is not the effect of a 1% relative volatility change"],
      ["One-month carry", "Revalue with one month less remaining and all market inputs unchanged", "Real markets and accrued cash flows rarely stay unchanged"],
      ["Finite shock", "Fully revalue after the stated change", "Shock results can include several interacting sensitivities"],
      ["Model scope", "European option decomposition with one volatility and one issuer spread", "Barriers, autocalls, skew, liquidity and default recovery require richer models"]
    ];
    byId("risk-rules").innerHTML = rows.map((row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`).join("");
  }

  function render() {
    const m = market();
    const marked = engine.value(note(), m);
    const risk = engine.sensitivities(note(), m);
    const riskCurve = engine.curve(note(), m, 40, 160, 97);
    renderProducts();
    renderControlOutputs();
    renderSummary(risk);
    renderStats(risk);
    renderValueChart(riskCurve, risk);
    renderFacet("risk-delta", riskCurve, "delta", "Delta", "value / spot", risk);
    renderFacet("risk-gamma", riskCurve, "gamma", "Gamma", "Δ delta / spot", risk);
    renderFacet("risk-vega", riskCurve, "vegaOnePoint", "Vega · +1 vol point", "value points", risk);
    renderFacet("risk-carry", riskCurve, "oneMonthCarry", "One-month carry", "value points", risk);
    renderComponents(marked);
    renderShocks(marked);
    renderRules();
  }

  byId("risk-reset").addEventListener("click", () => {
    const productId = state.productId;
    state = { productId, lifeFraction: 0.5, spot: 100, volatility: products[productId].issueVolatility, rate: 0.03, issuerSpread: 0.015, dividend: 0.02 };
    syncControls();
    render();
  });
  createControls();
  render();
}());
