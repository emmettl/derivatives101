(function () {
  "use strict";

  const engine = window.ForwardEngine;
  const presets = engine.presets;
  const byId = (id) => document.getElementById(id);
  const controls = [
    { id: "spot", label: "Spot level", min: 50, max: 150, step: 1, format: number },
    { id: "rate", label: "Financing rate", min: -0.01, max: 0.1, step: 0.0025, format: percent },
    { id: "dividendYield", label: "Dividend yield", min: 0, max: 0.1, step: 0.0025, format: percent },
    { id: "tenor", label: "Tenor", min: 0.25, max: 5, step: 0.25, format: years },
    { id: "strike", label: "Option strike", min: 60, max: 140, step: 1, format: number },
    { id: "volatility", label: "Implied volatility", min: 0.1, max: 0.6, step: 0.01, format: percent },
    { id: "optionBudget", label: "Call option budget", min: 2, max: 20, step: 0.5, format: points }
  ];
  let state = Object.assign({}, presets.financing);
  let framePending = false;

  function number(value) { return value.toFixed(2); }
  function percent(value) { return `${(value * 100).toFixed(2)}%`; }
  function years(value) { return `${value.toFixed(2)} years`; }
  function points(value) { return `${value.toFixed(2)} points`; }
  function signed(value, digits) { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits == null ? 2 : digits)}`; }
  function esc(value) { return String(value).replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char])); }

  function createControls() {
    byId("forward-controls").innerHTML = `<div class="control-block"><span class="control-title">Market &amp; term</span>${controls.slice(0, 4).map(controlMarkup).join("")}</div><div class="control-block"><span class="control-title">Option example</span>${controls.slice(4).map(controlMarkup).join("")}</div>`;
    controls.forEach((control) => byId(`forward-${control.id}`).addEventListener("input", (event) => { state[control.id] = Number(event.target.value); state.id = "custom"; scheduleRender(); }));
  }

  function controlMarkup(control) { return `<label class="range-control" for="forward-${control.id}"><span>${esc(control.label)} <output id="forward-${control.id}-out"></output></span><input id="forward-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${state[control.id]}"></label>`; }

  function renderPresets() {
    byId("forward-presets").innerHTML = Object.values(presets).map((preset) => `<button type="button" data-preset="${preset.id}" class="${preset.id === state.id ? "on" : ""}" aria-pressed="${preset.id === state.id}">${esc(preset.name)}</button>`).join("");
    byId("forward-presets").querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => { state = Object.assign({}, presets[button.dataset.preset]); syncControls(); render(); }));
  }

  function syncControls() { controls.forEach((control) => { byId(`forward-${control.id}`).value = state[control.id]; }); }
  function renderOutputs() { controls.forEach((control) => { byId(`forward-${control.id}-out`).textContent = control.format(state[control.id]); }); }
  function scheduleRender() { if (framePending) return; framePending = true; requestAnimationFrame(() => { framePending = false; render(); }); }

  function renderBridge(result) {
    const steps = [
      ["01", "Spot today", state.spot, "Current cash-market level", "spot"],
      ["02", "Dividend adjustment", result.dividendAdjustment, "Value removed for dividends before expiry", result.dividendAdjustment >= 0 ? "positive" : "negative"],
      ["03", "Prepaid forward", result.prepaidForward, "Pay today for delivery at expiry", "prepaid"],
      ["04", "Financing adjustment", result.financingAdjustment, "Carry the prepaid amount to expiry", result.financingAdjustment >= 0 ? "positive" : "negative"],
      ["05", "Forward delivery price", result.forward, "Amount exchanged at the future date", "forward"]
    ];
    byId("forward-bridge").innerHTML = steps.map((step) => `<div class="${step[4]}"><span>${step[0]}</span><strong>${esc(step[1])}</strong><b>${step[2] >= 0 && (step[4] === "positive" || step[4] === "negative") ? "+" : step[2] < 0 ? "−" : ""}${Math.abs(step[2]).toFixed(2)}</b><p>${esc(step[3])}</p></div>`).join("");
  }

  function renderCurve() {
    const svg = byId("forward-curve-chart");
    const maximumTenor = 5;
    const curve = engine.forwardCurve(state, maximumTenor, 101);
    const width = 900, height = 360, left = 64, right = 24, top = 24, bottom = 50;
    const values = curve.flatMap((point) => [point.forward, point.financingOnly, point.dividendOnly, point.spot]);
    const yMinimum = Math.floor((Math.min(...values) - 3) / 5) * 5;
    const yMaximum = Math.ceil((Math.max(...values) + 3) / 5) * 5;
    const x = (tenor) => left + tenor / maximumTenor * (width - left - right);
    const y = (value) => top + (yMaximum - value) / (yMaximum - yMinimum) * (height - top - bottom);
    const path = (key) => curve.map((point, indexValue) => `${indexValue ? "L" : "M"}${x(point.tenor).toFixed(2)},${y(point[key]).toFixed(2)}`).join(" ");
    const xTicks = [0, 1, 2, 3, 4, 5];
    const yTicks = Array.from({ length: 6 }, (_, indexValue) => yMinimum + (yMaximum - yMinimum) * indexValue / 5);
    const selected = engine.metrics(state);
    svg.innerHTML = `<title>Forward level across tenor</title><desc>The financing-only curve rises with positive rates, the dividend-only curve falls with positive dividend yield, and the net forward combines both effects.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 18}" text-anchor="middle">${tick}</text>`).join("")}<path class="forward-spot-line" d="${path("spot")}"></path><path class="forward-finance-line" d="${path("financingOnly")}"></path><path class="forward-dividend-line" d="${path("dividendOnly")}"></path><path class="forward-net-line" d="${path("forward")}"></path><line class="forward-selected-guide" x1="${x(state.tenor)}" x2="${x(state.tenor)}" y1="${top}" y2="${height - bottom}"></line><circle class="forward-selected-point" cx="${x(state.tenor)}" cy="${y(selected.forward)}" r="5"></circle><text class="axis forward-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Tenor (years)</text><text class="axis forward-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Level</text>`;
  }

  function renderOptions(result) {
    const cards = [
      [`${(result.forwardMoneyness * 100).toFixed(1)}%`, "Strike / forward", result.forwardMoneyness < 0.995 ? "Call is in the money versus forward" : result.forwardMoneyness > 1.005 ? "Call is out of the money versus forward" : "Call is approximately ATM-forward"],
      [result.prices.call.toFixed(2), "Call value with carry", `${result.prices.put.toFixed(2)} corresponding put value`],
      [`${(result.participation * 100).toFixed(1)}%`, "Budget-implied participation", `${state.optionBudget.toFixed(2)} budget ÷ ${result.prices.call.toFixed(2)} call cost`]
    ];
    byId("forward-options").innerHTML = cards.map((card, indexValue) => `<article class="option-${indexValue}"><span>${esc(card[1])}</span><strong>${esc(card[0])}</strong><p>${esc(card[2])}</p></article>`).join("");
    const participationChange = result.participation - result.spotForwardParticipation;
    byId("forward-option-note").textContent = `If forward were incorrectly set equal to spot, the call would be ${result.spotForwardPrices.call.toFixed(2)} and the same budget would imply ${(result.spotForwardParticipation * 100).toFixed(1)}% participation. Carry therefore changes this illustrative participation by ${participationChange >= 0 ? "+" : "−"}${Math.abs(participationChange * 100).toFixed(1)} percentage points.`;
    renderOptionChart(result);
  }

  function renderOptionChart(result) {
    const svg = byId("forward-option-chart");
    const pointsList = engine.optionStrip(state, 60, 140, 81);
    const width = 900, height = 350, left = 62, right = 24, top = 24, bottom = 50;
    const values = pointsList.flatMap((point) => [point.carried.call, point.spotForward.call]);
    const yMaximum = Math.ceil((Math.max(...values) + 2) / 5) * 5;
    const x = (strikeValue) => left + (strikeValue - 60) / 80 * (width - left - right);
    const y = (value) => top + (yMaximum - value) / yMaximum * (height - top - bottom);
    const path = (key) => pointsList.map((point, indexValue) => `${indexValue ? "L" : "M"}${x(point.strike).toFixed(2)},${y(point[key].call).toFixed(2)}`).join(" ");
    const xTicks = [60, 80, 100, 120, 140];
    const yTicks = Array.from({ length: 6 }, (_, indexValue) => yMaximum * indexValue / 5);
    svg.innerHTML = `<title>Call value across strikes</title><desc>The carried-forward line uses the selected financing and dividend assumptions. The comparison holds the forward equal to spot while keeping discounting and volatility unchanged.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 18}" text-anchor="middle">${tick}</text>`).join("")}<path class="forward-spot-call-line" d="${path("spotForward")}"></path><path class="forward-carried-call-line" d="${path("carried")}"></path><line class="forward-option-guide" x1="${x(state.strike)}" x2="${x(state.strike)}" y1="${top}" y2="${height - bottom}"></line><circle class="forward-option-point carried" cx="${x(state.strike)}" cy="${y(result.prices.call)}" r="5"></circle><circle class="forward-option-point spot" cx="${x(state.strike)}" cy="${y(result.spotForwardPrices.call)}" r="5"></circle><text class="axis forward-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Strike</text><text class="axis forward-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">European call value</text>`;
  }

  function renderParity(result) {
    const difference = result.parityLeft - result.parityRight;
    const items = [
      ["Call minus put", result.parityLeft, `${result.prices.call.toFixed(4)} − ${result.prices.put.toFixed(4)}`],
      ["Dividend-adjusted spot", state.spot * result.dividendDiscount, `${state.spot.toFixed(2)} × e^(−qT)`],
      ["Discounted strike", state.strike * result.rateDiscount, `${state.strike.toFixed(2)} × e^(−rT)`],
      ["Parity residual", difference, "Left side minus right side"]
    ];
    byId("forward-parity").innerHTML = `<div class="forward-parity-equation"><strong>C − P</strong><i>=</i><strong>S e<sup>−qT</sup> − K e<sup>−rT</sup></strong></div><div class="forward-parity-values">${items.map((item, indexValue) => `<div class="${indexValue === 3 ? "residual" : ""}"><span>${esc(item[0])}</span><strong>${Math.abs(item[1]) < 0.00005 ? "0.0000" : signed(item[1], 4)}</strong><p>${esc(item[2])}</p></div>`).join("")}</div>`;
  }

  function renderScenarios() {
    byId("forward-scenarios").innerHTML = Object.values(presets).map((preset) => {
      const result = engine.metrics(preset);
      return `<tr class="${preset.id === state.id ? "selected-row" : ""}"><td>${esc(preset.name)}</td><td>${percent(preset.rate)}</td><td>${percent(preset.dividendYield)}</td><td>${preset.tenor.toFixed(2)}y</td><td>${result.forward.toFixed(2)}</td><td>${signed(result.basis)}</td><td>${result.prices.call.toFixed(2)}</td><td>${(result.participation * 100).toFixed(1)}%</td></tr>`;
    }).join("");
  }

  function renderRules() {
    const rows = [
      ["Spot source", "Which market, close, timestamp, currency and adjustment state defines spot?", "A stale or differently adjusted spot creates a different basis."],
      ["Financing curve", "Which curve, collateral basis, compounding, day count and interpolation apply at the option date?", "One flat risk-free rate is only a teaching approximation."],
      ["Dividend model", "Are dividends represented as dated cash amounts, a continuous yield or an implied dividend curve?", "Timing and amounts matter, especially around discrete ex-dates."],
      ["Borrow and repo", "Does stock lending value, hard-to-borrow cost or an implied repo input affect the forward?", "Single-stock forwards can depart from a cash-and-carry calculation that ignores borrow."],
      ["Tenor dates", "From which settlement date to which expiry or delivery date is carry accrued?", "Trade date, spot date, option expiry and payment date are not interchangeable."],
      ["Moneyness convention", "Does ATM mean spot, forward, delta-neutral or another market convention?", "The selected strike can be ATM under one definition and not another."],
      ["Corporate actions", "How are ordinary dividends, special dividends, splits, rights and mergers treated?", "Forecast inputs and legal option adjustments are separate decisions."],
      ["Currency and quanto", "Are spot, dividends, curves, strike and payout in one currency?", "Cross-currency discounting or fixed conversion adds another carry layer."],
      ["Consistency tests", "Must put–call parity, forward curves and option values reconcile within a stated tolerance?", "A residual can expose mixed timestamps, curves or dividend assumptions."]
    ];
    byId("forward-rules").innerHTML = rows.map((row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`).join("");
  }

  function render() {
    const result = engine.metrics(state);
    renderPresets();
    renderOutputs();
    const label = state.id === "custom" ? "Custom carry assumptions" : presets[state.id].name;
    byId("forward-headline").textContent = label;
    byId("forward-summary").textContent = `At ${percent(state.rate)} financing and ${percent(state.dividendYield)} dividend yield, net carry is ${percent(result.netCarry)}. Over ${state.tenor.toFixed(2)} years, spot ${state.spot.toFixed(2)} becomes a ${result.forward.toFixed(2)} forward—not a forecast, but a no-arbitrage delivery level under these assumptions.`;
    const stats = [
      [percent(result.netCarry), "Net annual carry", "Financing rate minus dividend yield"],
      [result.forward.toFixed(2), "Forward level", `For delivery in ${state.tenor.toFixed(2)} years`],
      [signed(result.basis), "Forward basis", "Forward minus spot"],
      [`${(result.forwardMoneyness * 100).toFixed(1)}%`, "Strike / forward", state.strike === state.spot ? "ATM spot does not imply ATM forward" : `${state.strike.toFixed(0)} strike versus ${result.forward.toFixed(2)} forward`]
    ];
    byId("forward-stats").innerHTML = stats.map((stat) => `<div><span>${esc(stat[1])}</span><strong>${esc(stat[0])}</strong><p>${esc(stat[2])}</p></div>`).join("");
    renderBridge(result);
    renderCurve();
    renderOptions(result);
    renderParity(result);
    renderScenarios();
    renderRules();
  }

  byId("forward-reset").addEventListener("click", () => { state = Object.assign({}, presets.financing); syncControls(); render(); });
  createControls();
  render();
}());
