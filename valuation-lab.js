(function () {
  "use strict";

  const engine = window.ValuationEngine;
  const terms = {
    nominal: 100,
    issuePrice: 100,
    upfrontCost: 2,
    initialSpot: 100,
    strike: 100,
    tenor: 5,
    rate: 0.03,
    issuerSpread: 0.015,
    volatility: 0.18,
    dividend: 0.02
  };
  const note = engine.designNote(terms);
  const defaults = { elapsed: 1, spot: 100, rate: 0.03, issuerSpread: 0.025, volatility: 0.15, dividend: 0.02, exitCost: 1.2 };
  const scenarios = [
    { id: "unchanged", label: "Unchanged spot", values: defaults },
    { id: "issue", label: "Issue conditions", values: { elapsed: 0, spot: 100, rate: 0.03, issuerSpread: 0.015, volatility: 0.18, dividend: 0.02, exitCost: 1 } },
    { id: "rally", label: "Equity rally", values: { elapsed: 2, spot: 125, rate: 0.04, issuerSpread: 0.015, volatility: 0.22, dividend: 0.02, exitCost: 1 } },
    { id: "credit", label: "Credit stress", values: { elapsed: 2, spot: 100, rate: 0.03, issuerSpread: 0.06, volatility: 0.25, dividend: 0.02, exitCost: 3 } }
  ];
  const controls = [
    { group: "Contract clock", id: "elapsed", label: "Time elapsed", min: 0, max: 4.75, step: 0.25, format: (value) => `${value.toFixed(2).replace(/\.00$/, "")} years` },
    { group: "Contract clock", id: "spot", label: "Underlying level", min: 50, max: 160, step: 1, format: (value) => value.toFixed(0) },
    { group: "Market inputs", id: "rate", label: "Reference rate", min: -0.01, max: 0.08, step: 0.0025, format: percent },
    { group: "Market inputs", id: "issuerSpread", label: "Issuer spread", min: 0.0025, max: 0.08, step: 0.0025, format: percent },
    { group: "Market inputs", id: "volatility", label: "Implied volatility", min: 0.05, max: 0.6, step: 0.01, format: percent0 },
    { group: "Market inputs", id: "dividend", label: "Dividend yield", min: 0, max: 0.06, step: 0.0025, format: percent },
    { group: "Potential exit", id: "exitCost", label: "Bid / unwind deduction", min: 0, max: 4, step: 0.1, format: (value) => `${value.toFixed(1)} points` }
  ];
  let market = Object.assign({}, defaults);
  let activeScenario = "unchanged";
  const byId = (id) => document.getElementById(id);

  function percent(value) { return `${(value * 100).toFixed(2)}%`; }
  function percent0(value) { return `${(value * 100).toFixed(0)}%`; }
  function points(value) { return value.toFixed(2); }
  function signed(value) { return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`; }
  function esc(value) { return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char])); }

  function createControls() {
    const groups = [];
    controls.forEach((control) => {
      let group = groups.find((item) => item.name === control.group);
      if (!group) { group = { name: control.group, items: [] }; groups.push(group); }
      group.items.push(control);
    });
    byId("valuation-controls").innerHTML = groups.map((group) => `<div class="control-block"><span class="control-title">${esc(group.name)}</span>${group.items.map((control) => `<label class="range-control" for="valuation-${control.id}"><span>${esc(control.label)} <output id="valuation-${control.id}-out"></output></span><input id="valuation-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${market[control.id]}"></label>`).join("")}</div>`).join("");
    controls.forEach((control) => {
      byId(`valuation-${control.id}`).addEventListener("input", (event) => {
        market[control.id] = Number(event.target.value);
        activeScenario = "custom";
        render();
      });
    });
  }

  function renderScenarioButtons() {
    byId("valuation-scenarios").innerHTML = scenarios.map((scenario) => `<button type="button" data-scenario="${scenario.id}" class="${scenario.id === activeScenario ? "on" : ""}" aria-pressed="${scenario.id === activeScenario}">${esc(scenario.label)}</button>`).join("");
    byId("valuation-scenarios").querySelectorAll("[data-scenario]").forEach((button) => {
      button.addEventListener("click", () => {
        const scenario = scenarios.find((item) => item.id === button.dataset.scenario);
        market = Object.assign({}, scenario.values);
        activeScenario = scenario.id;
        syncControls();
        render();
      });
    });
  }

  function syncControls() {
    controls.forEach((control) => {
      byId(`valuation-${control.id}`).value = market[control.id];
    });
  }

  function renderOutputs() {
    controls.forEach((control) => {
      byId(`valuation-${control.id}-out`).textContent = control.format(market[control.id]);
    });
  }

  function renderSummary(marked, attribution) {
    const spotMove = market.spot / terms.initialSpot - 1;
    byId("valuation-headline").textContent = Math.abs(spotMove) < 0.0001 ? `Spot unchanged at ${market.spot.toFixed(0)}` : `Spot ${spotMove > 0 ? "up" : "down"} ${Math.abs(spotMove * 100).toFixed(0)}%`;
    const largest = attribution.steps.reduce((best, step) => Math.abs(step.change) > Math.abs(best.change) ? step : best, attribution.steps[0]);
    byId("valuation-summary").textContent = `After ${market.elapsed.toFixed(2).replace(/\.00$/, "")} years, the illustrative bid is ${points(marked.bid)} versus an issue price of 100. The largest step in this ordered bridge is ${largest.label.toLowerCase()} (${signed(largest.change)}).`;
  }

  function renderIssueAndStack(marked) {
    byId("issue-strip").innerHTML = [
      ["Issue price", points(note.issuePrice), "Amount paid by investor"],
      ["Initial estimated value", points(note.estimatedValue), "Bond + option in this model"],
      ["Upfront difference", points(note.upfrontCost), "Illustrative costs and margin"],
      ["Upside participation", `${(note.participation * 100).toFixed(1)}%`, "Fixed when the note is issued"]
    ].map((item) => `<div><span>${esc(item[0])}</span><strong>${esc(item[1])}</strong><p>${esc(item[2])}</p></div>`).join("");

    const scaleMax = Math.ceil(Math.max(120, marked.modelValue, note.issuePrice) / 10) * 10;
    byId("value-scale-max").textContent = scaleMax.toFixed(0);
    const stack = byId("value-stack");
    stack.querySelector(".value-stack-bond").style.width = `${Math.max(0, marked.bond / scaleMax * 100)}%`;
    stack.querySelector(".value-stack-option").style.width = `${Math.max(0, marked.option / scaleMax * 100)}%`;
    stack.querySelector(".issue-price-marker").style.left = `${note.issuePrice / scaleMax * 100}%`;
    stack.setAttribute("aria-label", `Current model value ${points(marked.modelValue)}: issuer bond ${points(marked.bond)} plus option ${points(marked.option)}. Illustrative bid after deduction ${points(marked.bid)}.`);
    byId("value-stack-labels").innerHTML = [
      [points(marked.bond), "issuer bond"],
      [points(marked.option), "embedded option"],
      [points(marked.modelValue), "model value"],
      [points(marked.bid), "indicative bid"]
    ].map((item) => `<span><b>${item[0]}</b>${item[1]}</span>`).join("");
    const difference = marked.bid - note.issuePrice;
    byId("valuation-message").innerHTML = difference < 0
      ? `Selling at the illustrative bid would realise <strong>${points(Math.abs(difference))} points below the issue price</strong>. The maturity floor of 100 does not prevent that early-exit loss.`
      : `The illustrative bid is <strong>${points(difference)} points above the issue price</strong>. This is still a modelled indication, not a guaranteed executable price.`;
  }

  function renderCurve(marked) {
    const svg = byId("valuation-curve");
    const data = engine.valueCurve(note, market, 50, 160, 89);
    const width = 900, height = 360, left = 62, right = 24, top = 24, bottom = 48;
    const values = data.flatMap((point) => [point.modelValue, point.bid, point.maturityPayoff]).concat([100]);
    const yMin = Math.floor((Math.min.apply(null, values) - 8) / 10) * 10;
    const yMax = Math.ceil((Math.max.apply(null, values) + 8) / 10) * 10;
    const x = (spot) => left + (spot - 50) / 110 * (width - left - right);
    const y = (value) => top + (yMax - value) / (yMax - yMin) * (height - top - bottom);
    const path = (key) => data.map((point, index) => `${index ? "L" : "M"}${x(point.spot).toFixed(2)},${y(point[key]).toFixed(2)}`).join(" ");
    const xTicks = [50, 75, 100, 125, 150];
    const yTicks = Array.from({ length: 6 }, (_, index) => yMin + (yMax - yMin) * index / 5);
    svg.innerHTML = `<title>Current value and maturity payoff across underlying levels</title><desc>The current model value and illustrative bid differ from the maturity payoff because time, rates, volatility, dividends, issuer spread and exit costs remain.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${xTicks.map((tick) => `<line class="grid" x1="${x(tick)}" x2="${x(tick)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(tick)}" y="${height - bottom + 20}" text-anchor="middle">${tick}</text>`).join("")}<line class="valuation-issue-line" x1="${left}" x2="${width - right}" y1="${y(100)}" y2="${y(100)}"></line><path class="valuation-maturity" d="${path("maturityPayoff")}"></path><path class="valuation-current" d="${path("modelValue")}"></path><path class="valuation-bid" d="${path("bid")}"></path><line class="valuation-current-guide" x1="${x(market.spot)}" x2="${x(market.spot)}" y1="${top}" y2="${height - bottom}"></line><circle class="valuation-dot current" cx="${x(market.spot)}" cy="${y(marked.modelValue)}" r="5"></circle><circle class="valuation-dot bid" cx="${x(market.spot)}" cy="${y(marked.bid)}" r="5"></circle><circle class="valuation-dot maturity" cx="${x(market.spot)}" cy="${y(marked.maturityPayoff)}" r="5"></circle><text class="axis valuation-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Underlying level</text><text class="axis valuation-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Value per 100 nominal</text>`;
    byId("valuation-comparison").innerHTML = [
      [points(marked.maturityPayoff), "Maturity payoff at today’s spot", "Only if held to maturity and the issuer performs"],
      [points(marked.modelValue), "Current model value", `${marked.remaining.toFixed(2)} years remain`],
      [points(marked.bid), "Illustrative exit bid", `After a ${market.exitCost.toFixed(1)} point deduction`]
    ].map((item) => `<div><span>${esc(item[1])}</span><strong>${esc(item[0])}</strong><p>${esc(item[2])}</p></div>`).join("");
  }

  function renderDrivers(attribution) {
    const maximum = Math.max(0.01, ...attribution.steps.map((step) => Math.abs(step.change)));
    byId("valuation-drivers").innerHTML = attribution.steps.map((step) => {
      const width = Math.abs(step.change) / maximum * 48;
      return `<div><span>${esc(step.label)}</span><div class="driver-track"><i class="driver-bar ${step.change >= 0 ? "positive" : "negative"}" style="width:${width}%;${step.change >= 0 ? "left:50%" : "right:50%"}"></i></div><strong class="${step.change < 0 ? "event-negative" : step.change > 0 ? "event-positive" : "event-neutral"}">${signed(step.change)}</strong></div>`;
    }).join("");
    byId("attribution-note").textContent = `Ordered bridge: ${points(attribution.start)} initial estimated value → ${points(attribution.end)} illustrative bid. Contributions depend on the order because valuation inputs interact.`;
  }

  function renderRules() {
    const rows = [
      ["Maturity payoff", `100 + ${(note.participation * 100).toFixed(1)}% × max(final level − 100, 0)`, "Issuer default, recovery and tax"],
      ["Issue-date value", "Issue price 100 − upfront difference 2 = estimated value 98", "Actual commissions, hedging profit and issuer methodology"],
      ["Issuer bond", "100 × exp[−(reference rate + issuer spread) × remaining tenor]", "Full credit curve, recovery and funding-basis effects"],
      ["Embedded option", "Fixed participation × Black–Scholes call × issuer-spread discount factor", "Volatility skew, discrete dividends, jumps and model calibration"],
      ["Current model value", "Issuer bond + embedded option", "Dealer reserves, size, liquidity and competing models"],
      ["Indicative bid", "max(current model value − selected exit deduction, 0)", "No commitment to transact; an actual quote may differ or be unavailable"]
    ];
    byId("valuation-rules").innerHTML = rows.map((row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`).join("");
  }

  function render() {
    const marked = engine.markNote(note, market);
    const attribution = engine.buildAttribution(note, market);
    renderScenarioButtons();
    renderOutputs();
    renderSummary(marked, attribution);
    renderIssueAndStack(marked);
    renderCurve(marked);
    renderDrivers(attribution);
    renderRules();
  }

  byId("valuation-reset").addEventListener("click", () => {
    market = Object.assign({}, defaults);
    activeScenario = "unchanged";
    syncControls();
    render();
  });
  createControls();
  render();
}());
