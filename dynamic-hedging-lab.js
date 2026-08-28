(function () {
  "use strict";

  const engine = window.HedgingEngine;
  const byId = (id) => document.getElementById(id);
  const paths = [
    { id: "random", name: "Random bridge" },
    { id: "selloff", name: "Early selloff & recovery" },
    { id: "late", name: "Late volatility" }
  ];
  const frequencies = [
    { value: 1, name: "Daily" },
    { value: 5, name: "Weekly" },
    { value: 21, name: "Monthly" },
    { value: 0, name: "Unhedged" }
  ];
  const controls = [
    { id: "endSpot", label: "Terminal spot", min: 70, max: 140, step: 1, format: (value) => value.toFixed(0) },
    { id: "impliedVolatility", label: "Implied volatility paid", min: 0.08, max: 0.5, step: 0.01, format: percent },
    { id: "realizedVolatility", label: "Path realised volatility", min: 0.05, max: 0.6, step: 0.01, format: percent },
    { id: "costBps", label: "Cost per share trade", min: 0, max: 20, step: 1, format: (value) => `${value.toFixed(0)} bp` }
  ];
  let state = defaults();
  let framePending = false;

  function defaults() { return { pathId: "random", seed: 42, startSpot: 100, endSpot: 110, strike: 100, tenor: 1, rate: 0.02, dividend: 0, impliedVolatility: 0.22, realizedVolatility: 0.28, hedgeEvery: 5, costBps: 2, steps: 252 }; }
  function percent(value) { return `${(value * 100).toFixed(0)}%`; }
  function signed(value) { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`; }
  function esc(value) { return String(value).replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char])); }
  function pathName() { return paths.find((path) => path.id === state.pathId).name; }
  function frequencyName() { return frequencies.find((frequency) => frequency.value === state.hedgeEvery).name; }

  function createControls() {
    byId("hedge-controls").innerHTML = `<div class="control-block"><span class="control-title">Option and path</span>${controls.map(controlMarkup).join("")}</div>`;
    controls.forEach((control) => byId(`hedge-${control.id}`).addEventListener("input", (event) => { state[control.id] = Number(event.target.value); scheduleRender(); }));
  }

  function controlMarkup(control) {
    return `<label class="range-control" for="hedge-${control.id}"><span>${esc(control.label)} <output id="hedge-${control.id}-out"></output></span><input id="hedge-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${state[control.id]}"></label>`;
  }

  function renderChoices() {
    byId("hedge-paths").innerHTML = paths.map((path) => `<button type="button" data-path="${path.id}" class="${path.id === state.pathId ? "on" : ""}" aria-pressed="${path.id === state.pathId}">${esc(path.name)}</button>`).join("");
    byId("hedge-paths").querySelectorAll("[data-path]").forEach((button) => button.addEventListener("click", () => { state.pathId = button.dataset.path; render(); }));
    byId("hedge-frequency").innerHTML = frequencies.map((frequency) => `<button type="button" data-frequency="${frequency.value}" class="${frequency.value === state.hedgeEvery ? "on" : ""}" aria-pressed="${frequency.value === state.hedgeEvery}">${esc(frequency.name)}</button>`).join("");
    byId("hedge-frequency").querySelectorAll("[data-frequency]").forEach((button) => button.addEventListener("click", () => { state.hedgeEvery = Number(button.dataset.frequency); render(); }));
  }

  function syncControls() { controls.forEach((control) => { byId(`hedge-${control.id}`).value = state[control.id]; }); }
  function renderOutputs() { controls.forEach((control) => { byId(`hedge-${control.id}-out`).textContent = control.format(state[control.id]); }); }
  function scheduleRender() { if (framePending) return; framePending = true; requestAnimationFrame(() => { framePending = false; render(); }); }

  function grid(xTicks, yTicks, x, y, width, height, left, right, top, bottom, xFormat) {
    return `${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${Math.abs(tick) < 2 ? tick.toFixed(2) : tick.toFixed(0)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 18}" text-anchor="middle">${xFormat(tick)}</text>`).join("")}`;
  }

  function renderPathChart(result) {
    const svg = byId("hedge-path-chart");
    const width = 900, height = 350, left = 62, right = 24, top = 24, bottom = 48;
    const values = result.records.map((record) => record.spot).concat([state.strike]);
    const minimum = Math.floor((Math.min(...values) - 5) / 10) * 10;
    const maximum = Math.ceil((Math.max(...values) + 5) / 10) * 10;
    const x = (day) => left + day / state.steps * (width - left - right);
    const y = (value) => top + (maximum - value) / (maximum - minimum) * (height - top - bottom);
    const path = result.records.map((record, index) => `${index ? "L" : "M"}${x(record.day).toFixed(2)},${y(record.spot).toFixed(2)}`).join(" ");
    const xTicks = [0, 63, 126, 189, 252];
    const yTicks = Array.from({ length: 6 }, (_, index) => minimum + (maximum - minimum) * index / 5);
    svg.innerHTML = `<title>Underlying path</title><desc>The underlying begins at 100 and reaches the selected terminal spot after 252 trading days.</desc>${grid(xTicks, yTicks, x, y, width, height, left, right, top, bottom, (day) => day === 0 ? "Start" : day === 252 ? "Maturity" : `Day ${day}`)}<line class="hedge-strike-line" x1="${left}" x2="${width - right}" y1="${y(state.strike)}" y2="${y(state.strike)}"></line><path class="hedge-spot-line" d="${path}"></path><circle class="hedge-end-point" cx="${x(state.steps)}" cy="${y(state.endSpot)}" r="5"></circle><text class="axis hedge-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Underlying level</text>`;
  }

  function renderRatioChart(result) {
    const svg = byId("hedge-ratio-chart");
    const width = 900, height = 280, left = 62, right = 24, top = 24, bottom = 48;
    const x = (day) => left + day / state.steps * (width - left - right);
    const y = (value) => top + (0.05 - value) / 1.1 * (height - top - bottom);
    const hedgePath = result.records.map((record, index) => `${index ? "L" : "M"}${x(record.day).toFixed(2)},${y(record.hedge).toFixed(2)}`).join(" ");
    const deltaPath = result.records.map((record, index) => `${index ? "L" : "M"}${x(record.day).toFixed(2)},${y(-record.delta).toFixed(2)}`).join(" ");
    const xTicks = [0, 63, 126, 189, 252], yTicks = [-1, -0.75, -0.5, -0.25, 0];
    svg.innerHTML = `<title>Option delta and discrete share hedge</title><desc>The negative option delta moves continuously in the model. The share position only changes at the selected rebalance dates.</desc>${grid(xTicks, yTicks, x, y, width, height, left, right, top, bottom, (day) => day === 0 ? "Start" : day === 252 ? "Maturity" : `Day ${day}`)}<path class="hedge-delta-line" d="${deltaPath}"></path><path class="hedge-share-line" d="${hedgePath}"></path><text class="axis hedge-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Shares per call</text>`;
  }

  function renderAttribution(result) {
    const comparison = state.realizedVolatility > state.impliedVolatility + 0.005 ? "above" : state.realizedVolatility < state.impliedVolatility - 0.005 ? "below" : "close to";
    byId("hedge-pnl-copy").textContent = `Path realised volatility is ${percent(result.realizedVolatility)}, ${comparison} the ${percent(state.impliedVolatility)} used to pay for the call. This is one discrete path, so that comparison is context—not a guarantee of the P&L sign.`;
    const rows = [
      ["Before transaction costs", result.frictionlessPnl],
      ["Transaction-cost drag", result.costDrag],
      ["After transaction costs", result.finalPnl]
    ];
    const maximum = Math.max(...rows.map((row) => Math.abs(row[1])), 0.01);
    byId("hedge-pnl-preview").innerHTML = rows.map((row) => { const width = Math.abs(row[1]) / maximum * 48; return `<div><span>${esc(row[0])}</span><div class="hedge-pnl-track"><i class="hedge-pnl-bar ${row[1] >= 0 ? "positive" : "negative"}" style="width:${width}%;${row[1] >= 0 ? "left:50%" : "right:50%"}"></i></div><strong class="${row[1] < 0 ? "event-negative" : "event-positive"}">${signed(row[1])}</strong></div>`; }).join("");
    const activities = [
      [result.trades.toFixed(0), "Share trades", "Includes opening and final close"],
      [result.turnover.toFixed(2), "Share turnover", "Gross traded value per call"],
      [result.totalCosts.toFixed(3), "Costs paid", "At each illustrated trade time"],
      [result.realizedVolatility ? percent(result.realizedVolatility) : "0%", "Realised volatility", "Annualised standard deviation of daily log returns"]
    ];
    byId("hedge-activity").innerHTML = activities.map((item) => `<div><strong>${esc(item[0])}</strong><span>${esc(item[1])}</span><p>${esc(item[2])}</p></div>`).join("");
  }

  function renderComparison() {
    const names = { random: "Random bridge", selloff: "Early selloff & recovery", late: "Late volatility" };
    byId("hedge-comparison").innerHTML = engine.compare(state).map((item) => {
      const spots = item.result.records.map((record) => record.spot);
      return `<tr class="${item.pathId === state.pathId ? "selected-row" : ""}"><td>${esc(names[item.pathId])}</td><td>${Math.min(...spots).toFixed(1)}–${Math.max(...spots).toFixed(1)}</td><td>${percent(item.result.realizedVolatility)}</td><td>${item.result.payoff.toFixed(2)}</td><td class="${item.result.finalPnl < 0 ? "event-negative" : "event-positive"}">${signed(item.result.finalPnl)}</td><td class="event-negative">${signed(item.result.costDrag)}</td></tr>`;
    }).join("");
  }

  function sampleLedger(records) {
    if (!state.hedgeEvery) return [0, 63, 126, 189, 252].map((day) => records[day]);
    const events = records.filter((record, index) => index === 0 || index === records.length - 1 || Math.abs(record.trade) > 1e-12);
    const count = Math.min(9, events.length);
    const selected = [];
    for (let index = 0; index < count; index += 1) selected.push(events[Math.round(index * (events.length - 1) / Math.max(1, count - 1))]);
    return selected.filter((record, index) => index === 0 || record.day !== selected[index - 1].day);
  }

  function renderLedger(result) {
    byId("hedge-ledger").innerHTML = sampleLedger(result.records).map((record) => `<tr><td>${record.day === 0 ? "Start" : record.day === state.steps ? "Maturity" : record.day}</td><td>${record.spot.toFixed(2)}</td><td>${record.delta.toFixed(3)}</td><td>${record.hedge.toFixed(3)}</td><td class="${record.trade < 0 ? "event-negative" : record.trade > 0 ? "event-positive" : "event-neutral"}">${Math.abs(record.trade) < 1e-12 ? "—" : signed(record.trade)}</td><td class="${record.portfolio < 0 ? "event-negative" : "event-positive"}">${signed(record.portfolio)}</td></tr>`).join("");
  }

  function renderRules() {
    const rows = [
      ["Position", "Buy one European call; short its Black–Scholes delta in shares", "Contract multiplier, hedge instrument, dividends and borrow availability"],
      ["Rebalance", "Trade at the close every selected number of 252 trading days", "Calendar, market hours, trigger rules, holidays and disrupted markets"],
      ["Cash", "All purchases, sale proceeds and option premium enter one cash account accruing at 2%", "Funding curve, collateral, margin, stock-borrow fees and currency"],
      ["Execution", `Every share trade occurs at the path spot plus ${state.costBps.toFixed(0)} bp cost`, "Bid/offer, slippage, market impact, minimum lots and partial fills"],
      ["Expiry", "Cash-settle the call and close the remaining share hedge at day 252", "Exercise convention, settlement price, timing and residual positions"],
      ["Volatility", "One constant implied volatility and a constructed realised path", "Smile, skew, jumps, stochastic volatility and recalibration"]
    ];
    byId("hedge-rules").innerHTML = rows.map((row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`).join("");
  }

  function render() {
    const result = engine.simulate(state);
    renderChoices();
    renderOutputs();
    byId("hedge-headline").textContent = `${frequencyName()} hedge · ${pathName().toLowerCase()}`;
    byId("hedge-summary").textContent = `The call finishes at ${state.endSpot.toFixed(0)} and pays ${result.payoff.toFixed(2)}. The selected journey produces ${signed(result.finalPnl)} hedge portfolio P&L after ${Math.abs(result.costDrag).toFixed(2)} of transaction-cost drag.`;
    const stats = [
      [result.initialPremium.toFixed(2), "Initial call premium", `${percent(state.impliedVolatility)} implied volatility`],
      [result.payoff.toFixed(2), "Option payoff", `Same for every path ending at ${state.endSpot.toFixed(0)}`],
      [signed(result.finalPnl), "Hedged portfolio P&L", frequencyName() === "Unhedged" ? "Long call financed to maturity" : `${result.trades} share trades including open and close`],
      [signed(result.costDrag), "Transaction-cost drag", `${state.costBps.toFixed(0)} bp per share trade`]
    ];
    byId("hedge-stats").innerHTML = stats.map((stat) => `<div><span>${esc(stat[1])}</span><strong class="${stat[0].startsWith("−") ? "event-negative" : ""}">${esc(stat[0])}</strong><p>${esc(stat[2])}</p></div>`).join("");
    renderPathChart(result);
    renderRatioChart(result);
    renderAttribution(result);
    renderComparison();
    renderLedger(result);
    renderRules();
  }

  byId("hedge-resample").addEventListener("click", () => { state.seed += 1; state.pathId = "random"; render(); });
  byId("hedge-reset").addEventListener("click", () => { state = defaults(); syncControls(); render(); });
  createControls();
  render();
}());
