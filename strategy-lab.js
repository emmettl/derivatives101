(function () {
  "use strict";

  const engine = window.StrategyEngine;
  const byId = (id) => document.getElementById(id);
  const legColors = ["leg-0", "leg-1", "leg-2"];
  const marketControls = [
    { key: "spot", label: "Initial spot", min: 60, max: 140, step: 1, format: value => value.toFixed(0) },
    { key: "volatility", label: "Volatility", min: 0.05, max: 0.8, step: 0.01, format: value => `${(value * 100).toFixed(0)}%` },
    { key: "tenor", label: "Time to expiry", min: 0.1, max: 3, step: 0.1, format: value => `${value.toFixed(1)}y` },
    { key: "rate", label: "Interest rate", min: -0.02, max: 0.12, step: 0.0025, format: value => `${(value * 100).toFixed(2)}%` },
    { key: "dividend", label: "Dividend yield", min: 0, max: 0.1, step: 0.0025, format: value => `${(value * 100).toFixed(2)}%` },
    { key: "observedLow", label: "Observed path low", min: 40, max: 100, step: 1, format: value => value.toFixed(0) },
    { key: "observedHigh", label: "Observed path high", min: 100, max: 160, step: 1, format: value => value.toFixed(0) },
    { key: "terminal", label: "Selected expiry level", min: 40, max: 160, step: 1, format: value => value.toFixed(0) }
  ];
  let state = { presetId: "butterfly", spot: 100, volatility: 0.25, tenor: 1, rate: 0.03, dividend: 0.01, observedLow: 88, observedHigh: 114, terminal: 100, legs: [] };
  let framePending = false;

  function esc(value) { return String(value).replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char])); }
  function market() { return { spot: state.spot, volatility: state.volatility, tenor: state.tenor, rate: state.rate, dividend: state.dividend }; }
  function applyPreset(id) { const preset = engine.clonePreset(engine.presets[id], state.spot); state.presetId = id; state.legs = preset.legs; render(); }

  function renderPresets() {
    byId("strategy-presets").innerHTML = Object.values(engine.presets).map(preset => `<button type="button" data-preset="${preset.id}" class="${state.presetId === preset.id ? "on" : ""}" aria-pressed="${state.presetId === preset.id}">${esc(preset.name)}</button>`).join("");
    byId("strategy-presets").querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
  }

  function createMarketControls() {
    byId("market-controls").innerHTML = `<div class="control-block"><span class="control-title">Pricing inputs</span>${marketControls.slice(0, 5).map(controlMarkup).join("")}</div><div class="control-block"><span class="control-title">Path &amp; outcome</span>${marketControls.slice(5).map(controlMarkup).join("")}<p class="control-help">The observed low and high record barrier touches before expiry. The selected terminal level is added to that path history.</p></div>`;
    marketControls.forEach(control => byId(`strategy-${control.key}`).addEventListener("input", event => {
      const previousSpot = state.spot;
      state[control.key] = Number(event.target.value);
      if (control.key === "spot" && previousSpot !== state.spot) {
        const scale = state.spot / previousSpot;
        state.legs.forEach(item => { item.strike *= scale; if (item.barrier) item.barrier *= scale; });
        state.observedLow *= scale;
        state.observedHigh *= scale;
        state.terminal *= scale;
      }
      state.presetId = "custom";
      scheduleRender();
    }));
  }

  function syncMarketControls() {
    byId("strategy-observedLow").min = state.spot * 0.4;
    byId("strategy-observedLow").max = state.spot;
    byId("strategy-observedHigh").min = state.spot;
    byId("strategy-observedHigh").max = state.spot * 1.6;
    byId("strategy-terminal").min = state.spot * 0.4;
    byId("strategy-terminal").max = state.spot * 1.6;
    marketControls.forEach(control => { byId(`strategy-${control.key}`).value = state[control.key]; });
  }

  function controlMarkup(control) { return `<label class="range-control" for="strategy-${control.key}"><span>${esc(control.label)} <output id="strategy-${control.key}-out"></output></span><input id="strategy-${control.key}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${state[control.key]}"></label>`; }

  function renderLegs() {
    byId("leg-builder").innerHTML = state.legs.map((item, index) => `<article class="leg-card ${item.enabled ? "" : "disabled"}" data-leg="${index}"><header><span>Leg ${index + 1}</span><label><input type="checkbox" data-field="enabled" ${item.enabled ? "checked" : ""}> Active</label></header><div class="leg-fields"><label class="leg-field"><span>Position</span><select data-field="side"><option value="long"${item.side === "long" ? " selected" : ""}>Long</option><option value="short"${item.side === "short" ? " selected" : ""}>Short</option></select></label><label class="leg-field"><span>Option</span><select data-field="type"><option value="call"${item.type === "call" ? " selected" : ""}>Call</option><option value="put"${item.type === "put" ? " selected" : ""}>Put</option></select></label><label class="leg-field"><span>Quantity</span><input type="number" min="0.5" max="3" step="0.5" value="${item.quantity}" data-field="quantity"></label><label class="leg-field"><span>Strike</span><input type="number" min="20" max="220" step="1" value="${item.strike.toFixed(0)}" data-field="strike"></label><label class="leg-field wide"><span>Barrier style</span><select data-field="barrierType"><option value="none"${item.barrierType === "none" ? " selected" : ""}>Vanilla · no barrier</option><option value="down-in"${item.barrierType === "down-in" ? " selected" : ""}>Down-and-in</option><option value="down-out"${item.barrierType === "down-out" ? " selected" : ""}>Down-and-out</option><option value="up-in"${item.barrierType === "up-in" ? " selected" : ""}>Up-and-in</option><option value="up-out"${item.barrierType === "up-out" ? " selected" : ""}>Up-and-out</option></select></label><label class="leg-field wide barrier-field ${item.barrierType === "none" ? "hidden" : ""}"><span>Barrier level</span><input type="number" min="20" max="220" step="1" value="${item.barrier.toFixed(0)}" data-field="barrier"></label></div></article>`).join("");
    byId("leg-builder").querySelectorAll("[data-leg]").forEach(card => card.querySelectorAll("[data-field]").forEach(input => input.addEventListener("change", () => {
      const item = state.legs[Number(card.dataset.leg)];
      item[input.dataset.field] = input.type === "checkbox" ? input.checked : ["quantity", "strike", "barrier"].includes(input.dataset.field) ? Number(input.value) : input.value;
      if (input.dataset.field === "barrierType" && item.barrierType.startsWith("down") && item.barrier >= state.spot) item.barrier = state.spot * 0.75;
      if (input.dataset.field === "barrierType" && item.barrierType.startsWith("up") && item.barrier <= state.spot) item.barrier = state.spot * 1.25;
      state.presetId = "custom";
      render();
    })));
  }

  function renderChart(metrics) {
    const svg = byId("strategy-chart");
    const width = 900, height = 440, left = 68, right = 25, top = 28, bottom = 55;
    const points = metrics.curve;
    const allValues = points.flatMap(point => [point.pnl].concat(point.legs.map(result => result.pnl)));
    let yMin = Math.min(...allValues, 0), yMax = Math.max(...allValues, 0);
    const padding = Math.max(4, (yMax - yMin) * 0.12); yMin -= padding; yMax += padding;
    const x = value => left + (value - points[0].terminalSpot) / (points.at(-1).terminalSpot - points[0].terminalSpot) * (width - left - right);
    const y = value => top + (yMax - value) / (yMax - yMin) * (height - top - bottom);
    const path = accessor => points.map((point, index) => `${index ? "L" : "M"}${x(point.terminalSpot).toFixed(2)},${y(accessor(point)).toFixed(2)}`).join(" ");
    const xTicks = [40, 60, 80, 100, 120, 140, 160].map(percent => state.spot * percent / 100);
    const yTicks = Array.from({ length: 6 }, (_, index) => yMin + (yMax - yMin) * index / 5);
    svg.innerHTML = `<title>${esc(byId("strategy-name").textContent)} expiry profit or loss</title><desc>The thick line is the combined strategy after premium. Thin lines show the profit or loss contribution from each active option leg.</desc>${yTicks.map(tick => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${xTicks.map(tick => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 19}" text-anchor="middle">${tick.toFixed(0)}</text>`).join("")}<line class="strategy-zero" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"></line><line class="strategy-spot" x1="${x(state.spot)}" x2="${x(state.spot)}" y1="${top}" y2="${height - bottom}"></line>${state.legs.map((item, index) => item.enabled ? `<path class="strategy-leg strategy-leg-${index}" d="${path(point => point.legs[index].pnl)}"></path>` : "").join("")}<path class="strategy-total" d="${path(point => point.pnl)}"></path>${metrics.breakEvens.map(value => `<circle class="strategy-breakeven" cx="${x(value)}" cy="${y(0)}" r="4"></circle>`).join("")}<line class="strategy-selected" x1="${x(state.terminal)}" x2="${x(state.terminal)}" y1="${top}" y2="${height - bottom}"></line><circle class="strategy-selected-point" cx="${x(state.terminal)}" cy="${y(metrics.selected.pnl)}" r="6"></circle><text class="axis strategy-axis-title" x="${(left + width - right) / 2}" y="${height - 9}" text-anchor="middle">Underlying at expiry</text><text class="axis strategy-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Profit / loss after premium</text>`;
  }

  function renderSummary(metrics) {
    const preset = engine.presets[state.presetId];
    const active = state.legs.filter(item => item.enabled);
    byId("strategy-name").textContent = preset ? preset.name : "Custom three-leg strategy";
    byId("strategy-summary").textContent = preset ? preset.description : `${active.length} active leg${active.length === 1 ? "" : "s"}; the combined payoff and premium update directly from the recipe below.`;
    byId("leg-count").textContent = `${active.length} of 3 legs active`;
    const debit = metrics.netPremium;
    byId("strategy-stats").innerHTML = [[`${debit >= 0 ? "Debit " : "Credit "}${Math.abs(debit).toFixed(2)}`, "Net premium", "Long premium minus short premium"], [metrics.breakEvens.length ? metrics.breakEvens.map(value => value.toFixed(1)).join(" / ") : "None in range", "Break-even level(s)", "Across 40%–160% of initial spot"], [metrics.minimumPnl.toFixed(2), "Lowest P/L shown", "Within the displayed range"], [metrics.maximumPnl.toFixed(2), "Highest P/L shown", "Within the displayed range"]].map(item => `<div><span>${esc(item[1])}</span><strong>${esc(item[0])}</strong><p>${esc(item[2])}</p></div>`).join("");
    byId("strategy-legend").innerHTML = `<span><i class="total"></i>Combined strategy</span>${state.legs.map((item, index) => item.enabled ? `<span><i class="${legColors[index]}"></i>Leg ${index + 1}: ${item.side} ${item.quantity} ${item.type}</span>` : "").join("")}`;
    const barrierEvents = metrics.selected.legs.map((result, index) => state.legs[index].enabled && state.legs[index].barrierType !== "none" ? `Leg ${index + 1} ${result.hit ? "touched" : "did not touch"} its ${state.legs[index].barrierType} barrier and is ${result.active ? "active" : "inactive"}` : "").filter(Boolean);
    byId("selected-outcome").textContent = `At expiry ${state.terminal.toFixed(0)}, the strategy payoff before premium is ${metrics.selected.payoff.toFixed(2)} and profit/loss after premium is ${metrics.selected.pnl.toFixed(2)}.${barrierEvents.length ? ` ${barrierEvents.join("; ")}.` : ""}`;
  }

  function renderAnatomy(metrics) {
    const activeResults = metrics.selected.legs.map((result, index) => ({ result, item: state.legs[index], index })).filter(entry => entry.item.enabled);
    const maximum = Math.max(1, ...activeResults.map(entry => Math.abs(entry.result.pnl)));
    byId("contribution-bars").innerHTML = activeResults.map(entry => {
      const width = Math.abs(entry.result.pnl) / maximum * 50;
      return `<div class="contribution-row"><span>Leg ${entry.index + 1} · ${esc(entry.item.side)} ${esc(entry.item.type)}</span><div class="contribution-track"><i class="contribution-bar ${entry.result.pnl >= 0 ? "positive" : "negative"}" style="width:${width.toFixed(2)}%"></i></div><strong>${entry.result.pnl >= 0 ? "+" : "−"}${Math.abs(entry.result.pnl).toFixed(2)}</strong></div>`;
    }).join("") || `<p class="barrier-note">Activate at least one leg to see its contribution.</p>`;
    byId("leg-ledger").innerHTML = state.legs.map((item, index) => {
      const result = metrics.selected.legs[index];
      if (!item.enabled) return `<tr class="inactive"><td>Leg ${index + 1}</td><td>Inactive</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>Not evaluated</td></tr>`;
      const pricing = result.pricing;
      const contract = `${item.side === "long" ? "Long" : "Short"} ${item.quantity} ${item.type}`;
      const barrier = item.barrierType === "none" ? "Vanilla" : `${item.barrierType} @ ${item.barrier.toFixed(0)}`;
      const stateText = item.barrierType === "none" ? "Always active" : `${result.hit ? "Touched" : "Not touched"} · ${result.active ? "active" : "inactive"}`;
      const signedPremium = result.signedQuantity * pricing.premium;
      const signedPayoff = result.signedQuantity * result.payoff;
      return `<tr><td>Leg ${index + 1}</td><td>${esc(contract)}</td><td>${item.strike.toFixed(2)}</td><td>${esc(barrier)}</td><td>${signedPremium >= 0 ? "+" : "−"}${Math.abs(signedPremium).toFixed(2)}</td><td>${signedPayoff >= 0 ? "+" : "−"}${Math.abs(signedPayoff).toFixed(2)}</td><td class="${result.pnl >= 0 ? "event-positive" : "event-negative"}">${result.pnl >= 0 ? "+" : "−"}${Math.abs(result.pnl).toFixed(2)}</td><td>${esc(stateText)}</td></tr>`;
    }).join("");
    const activeCount = state.legs.filter(item => item.enabled).length;
    byId("leg-totals").innerHTML = `<tr><th colspan="4">Strategy total</th><td>${metrics.netPremium.toFixed(2)}</td><td>${metrics.selected.payoff.toFixed(2)}</td><td>${metrics.selected.pnl >= 0 ? "+" : "−"}${Math.abs(metrics.selected.pnl).toFixed(2)}</td><td>${activeCount} active leg${activeCount === 1 ? "" : "s"}</td></tr>`;
  }

  function renderBarrierStates(metrics) {
    const minimum = state.spot * 0.4, maximum = state.spot * 1.6;
    const position = value => Math.max(0, Math.min(100, (value - minimum) / (maximum - minimum) * 100));
    const pathLow = Math.min(state.observedLow, state.terminal, state.spot), pathHigh = Math.max(state.observedHigh, state.terminal, state.spot);
    byId("barrier-states").innerHTML = state.legs.map((item, index) => {
      const result = metrics.selected.legs[index];
      if (!item.enabled) return `<article class="barrier-state inactive"><span>Leg ${index + 1}</span><strong>Inactive leg</strong><p>No contract or barrier event is evaluated.</p></article>`;
      if (item.barrierType === "none") return `<article class="barrier-state active"><span>Leg ${index + 1}</span><strong>Vanilla ${esc(item.type)}</strong><p>No barrier state. The option is active at expiry and depends only on strike and terminal spot.</p><div class="barrier-track"><i class="barrier-range" style="left:${position(pathLow)}%;width:${Math.max(1, position(pathHigh) - position(pathLow))}%"></i><i class="barrier-terminal" style="left:${position(state.terminal)}%"></i></div><div class="barrier-labels"><span>${minimum.toFixed(0)}</span><span>Path ${pathLow.toFixed(0)}–${pathHigh.toFixed(0)}</span><span>${maximum.toFixed(0)}</span></div></article>`;
      const probability = result.pricing.hitProbability;
      return `<article class="barrier-state ${result.active ? "active" : "inactive"}"><span>Leg ${index + 1} · ${esc(item.barrierType)}</span><strong>${result.hit ? "Barrier touched" : "Barrier untouched"} · ${result.active ? "active" : "inactive"}</strong><p>Illustrative touch probability at inception: ${(probability * 100).toFixed(1)}%. Selected path range: ${pathLow.toFixed(0)}–${pathHigh.toFixed(0)}.</p><div class="barrier-track"><i class="barrier-range" style="left:${position(pathLow)}%;width:${Math.max(1, position(pathHigh) - position(pathLow))}%"></i><i class="barrier-marker" style="left:${position(item.barrier)}%"></i><i class="barrier-terminal" style="left:${position(state.terminal)}%"></i></div><div class="barrier-labels"><span>${minimum.toFixed(0)}</span><span>Barrier ${item.barrier.toFixed(0)}</span><span>${maximum.toFixed(0)}</span></div></article>`;
    }).join("");
    const barrierCount = state.legs.filter(item => item.enabled && item.barrierType !== "none").length;
    byId("barrier-note").textContent = barrierCount ? "The displayed premium scales vanilla value by an estimated touch or survival probability. That is intentionally transparent and fast, but it is not a barrier-option valuation formula." : "All active legs are vanilla, so the observed path range does not change their expiry payoff.";
  }

  function renderCatalogue() {
    const rows = [
      ["Long call", "+1 call K", "Flat loss below K; rising upside above K", "Premium paid for convex upside"],
      ["Bull call spread", "+1 lower call; −1 higher call", "Limited loss, rising middle, capped gain", "Lower premium in exchange for capped upside"],
      ["Bear put spread", "+1 higher put; −1 lower put", "Capped gain below; limited loss above", "Cheaper protection with the deepest tail sold"],
      ["Straddle", "+1 put K; +1 call K", "V-shaped around one strike", "Two premiums; needs a large move either way"],
      ["Strangle", "+1 lower put; +1 higher call", "Flat loss between strikes; gains in both tails", "Cheaper than straddle; wider move required"],
      ["Call butterfly", "+1 low call; −2 middle; +1 high call", "Peak at middle strike; limited wings", "Precise expiry view with limited gain and loss"],
      ["Risk reversal", "−1 lower put; +1 higher call", "Downside obligation funds upside", "Directional exposure; short-put tail risk"],
      ["Seagull", "−1 put; +1 low call; −1 high call", "Downside obligation; rising then capped upside", "Extra funding in exchange for two sold regions"],
      ["Barrier wings", "+1 down-in put; +1 up-in call", "Tail payoff only after the relevant touch", "Lower illustrative premium; path dependence"]
    ];
    byId("strategy-catalogue").innerHTML = rows.map((row, index) => {
      const presetId = Object.keys(engine.presets)[index];
      return `<tr class="${state.presetId === presetId ? "selected-row" : ""}"><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td><td>${esc(row[3])}</td></tr>`;
    }).join("");
  }

  function renderRules() {
    const rows = [
      ["Contract identity", "Do all legs share the same underlying, currency, multiplier and expiry?", "A payoff recipe does not prevent mismatched contracts."],
      ["Side and ratio", "Is each leg bought or sold, and in what signed quantity?", "A butterfly needs a 1:−2:1 ratio, not merely three strikes."],
      ["Exercise style", "European, American or Bermudan—and can short legs be assigned early?", "One early assignment can dismantle the intended combined exposure."],
      ["Strike ordering", "Are lower, body and upper strikes strictly ordered and equally spaced where required?", "Changing wing widths creates a broken-wing payoff rather than a symmetric butterfly."],
      ["Premium convention", "Market price, model value or agreed premium; per unit or per contract; which currency?", "Break-even and P/L depend on initial cash, not payoff alone."],
      ["Barrier direction", "Down or up; knock-in or knock-out; inclusive or strict touch?", "The same path can activate one contract and extinguish another."],
      ["Barrier monitoring", "Continuous or discrete; which timestamps, source, calendar and disruption fallback?", "A path between observations may or may not count as a touch."],
      ["Barrier extras", "Is there a rebate, delayed activation, window, double barrier or reset?", "The four labels in this lab cover only the simplest barrier state."],
      ["Settlement", "Cash or physical; automatic exercise threshold; rounding and payment timing?", "Legs can create different funding or delivery obligations at expiry."],
      ["Lifecycle handling", "Can legs be closed, exercised or assigned separately?", "The displayed terminal package may not survive intact until expiry."],
      ["Risk aggregation", "Are Greeks, margin and stress calculated per leg and for the net strategy?", "Net delta can hide gross gamma, vega, gap or assignment exposure."]
    ];
    byId("strategy-rules").innerHTML = rows.map(row => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`).join("");
  }

  function renderOutputs() { marketControls.forEach(control => { byId(`strategy-${control.key}-out`).textContent = control.format(state[control.key]); }); }
  function scheduleRender() { if (framePending) return; framePending = true; requestAnimationFrame(() => { framePending = false; render(); }); }
  function render() { renderPresets(); syncMarketControls(); renderLegs(); renderOutputs(); const result = engine.metrics(market(), state.legs, state.observedLow, state.observedHigh, state.terminal); renderSummary(result); renderChart(result); renderAnatomy(result); renderBarrierStates(result); renderCatalogue(); renderRules(); }

  byId("strategy-reset").addEventListener("click", () => { state = { presetId: "butterfly", spot: 100, volatility: 0.25, tenor: 1, rate: 0.03, dividend: 0.01, observedLow: 88, observedHigh: 114, terminal: 100, legs: [] }; applyPreset("butterfly"); });
  createMarketControls();
  applyPreset("butterfly");
}());
