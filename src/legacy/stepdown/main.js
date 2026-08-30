import * as engine from "./engine";

(function () {
  "use strict";

  const presets = engine.presets;
  const byId = (id) => document.getElementById(id);
  const controls = [
    {
      id: "selectedLevel",
      label: "Selected observation level",
      min: 40,
      max: 130,
      step: 1,
      format: level,
    },
    { id: "startCall", label: "First call threshold", min: 85, max: 110, step: 1, format: level },
    { id: "stepSize", label: "Step per observation", min: 0, max: 10, step: 0.5, format: points },
    { id: "callFloor", label: "Minimum call threshold", min: 55, max: 85, step: 1, format: level },
    { id: "couponBarrier", label: "Coupon barrier", min: 40, max: 100, step: 1, format: level },
    {
      id: "couponPerObservation",
      label: "Coupon per observation",
      min: 0,
      max: 5,
      step: 0.25,
      format: cash,
    },
    {
      id: "protectionBarrier",
      label: "Maturity protection barrier",
      min: 40,
      max: 90,
      step: 1,
      format: level,
    },
  ];
  let state = defaults();
  let framePending = false;

  function defaults() {
    return {
      id: "lateRecovery",
      path: presets.lateRecovery.path.slice(),
      selectedIndex: 4,
      startCall: 100,
      stepSize: 5,
      callFloor: 70,
      couponBarrier: 70,
      couponPerObservation: 2,
      protectionBarrier: 60,
    };
  }
  function level(value) {
    return `${value.toFixed(0)}% of initial`;
  }
  function points(value) {
    return `${value.toFixed(1)} points`;
  }
  function cash(value) {
    return `${value.toFixed(2)} per 100`;
  }
  function signed(value) {
    return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;
  }
  function esc(value) {
    return String(value).replace(
      /[&<>"]/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
    );
  }

  function createControls() {
    byId("stepdown-controls").innerHTML =
      `<div class="control-block"><span class="control-title">Edit the path</span>${controlMarkup(controls[0])}</div><div class="control-block"><span class="control-title">Call schedule</span>${controls.slice(1, 4).map(controlMarkup).join("")}</div><div class="control-block"><span class="control-title">Separate payment tests</span>${controls.slice(4).map(controlMarkup).join("")}</div>`;
    controls.forEach((control) =>
      byId(`stepdown-${control.id}`).addEventListener("input", (event) => {
        const value = Number(event.target.value);
        if (control.id === "selectedLevel") {
          state.path[state.selectedIndex] = value;
          state.id = "custom";
        } else state[control.id] = value;
        scheduleRender();
      }),
    );
  }

  function controlMarkup(control) {
    const value =
      control.id === "selectedLevel" ? state.path[state.selectedIndex] : state[control.id];
    return `<label class="range-control" for="stepdown-${control.id}"><span>${esc(control.label)} <output id="stepdown-${control.id}-out"></output></span><input id="stepdown-${control.id}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}"></label>`;
  }

  function renderPresets() {
    byId("stepdown-presets").innerHTML = Object.values(presets)
      .map(
        (preset) =>
          `<button type="button" data-preset="${preset.id}" class="${preset.id === state.id ? "on" : ""}" aria-pressed="${preset.id === state.id}">${esc(preset.name)}</button>`,
      )
      .join("");
    byId("stepdown-presets")
      .querySelectorAll("[data-preset]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const preset = presets[button.dataset.preset];
          state.id = preset.id;
          state.path = preset.path.slice();
          state.selectedIndex = 0;
          syncControls();
          render();
        }),
      );
  }

  function renderObservations() {
    byId("stepdown-observations").innerHTML = state.path
      .map(
        (value, indexValue) =>
          `<button type="button" data-observation="${indexValue}" class="${indexValue === state.selectedIndex ? "on" : ""}" aria-pressed="${indexValue === state.selectedIndex}"><span>Q${indexValue + 1}</span><strong>${value.toFixed(0)}</strong></button>`,
      )
      .join("");
    byId("stepdown-observations")
      .querySelectorAll("[data-observation]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          state.selectedIndex = Number(button.dataset.observation);
          syncControls();
          render();
        }),
      );
  }

  function syncControls() {
    controls.forEach((control) => {
      byId(`stepdown-${control.id}`).value =
        control.id === "selectedLevel" ? state.path[state.selectedIndex] : state[control.id];
    });
  }
  function renderOutputs() {
    controls.forEach((control) => {
      const value =
        control.id === "selectedLevel" ? state.path[state.selectedIndex] : state[control.id];
      byId(`stepdown-${control.id}-out`).textContent = control.format(value);
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

  function renderChart(result) {
    const svg = byId("stepdown-path-chart");
    const width = 900,
      height = 390,
      left = 62,
      right = 24,
      top = 24,
      bottom = 50;
    const values = state.path.concat([
      state.startCall,
      state.callFloor,
      state.couponBarrier,
      state.protectionBarrier,
    ]);
    const yMinimum = Math.floor((Math.min(...values) - 8) / 10) * 10;
    const yMaximum = Math.ceil((Math.max(...values) + 8) / 10) * 10;
    const x = (indexValue) => left + (indexValue / 7) * (width - left - right);
    const y = (value) =>
      top + ((yMaximum - value) / (yMaximum - yMinimum)) * (height - top - bottom);
    const yTicks = Array.from(
      { length: 6 },
      (_, indexValue) => yMinimum + ((yMaximum - yMinimum) * indexValue) / 5,
    );
    const path = state.path
      .map(
        (value, indexValue) =>
          `${indexValue ? "L" : "M"}${x(indexValue).toFixed(2)},${y(value).toFixed(2)}`,
      )
      .join(" ");
    const stairs = [];
    for (let indexValue = 0; indexValue < 7; indexValue += 1) {
      const threshold = engine.callThreshold(state, indexValue);
      const nextX = indexValue === 6 ? x(7) : (x(indexValue) + x(indexValue + 1)) / 2;
      const startX = indexValue === 0 ? x(0) : (x(indexValue - 1) + x(indexValue)) / 2;
      stairs.push(`${indexValue ? "L" : "M"}${startX},${y(threshold)} L${nextX},${y(threshold)}`);
    }
    const callEvent = result.called ? result.events[result.calledIndex] : null;
    svg.innerHTML = `<title>Step-down autocall lifecycle</title><desc>The underlying is compared with a descending call threshold at each pre-maturity observation. Coupon and maturity protection use separate fixed barriers.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick.toFixed(0)}</text>`).join("")}${state.path.map((value, indexValue) => `<line class="grid" x1="${x(indexValue)}" x2="${x(indexValue)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(indexValue)}" y="${height - bottom + 18}" text-anchor="middle">Q${indexValue + 1}</text>`).join("")}<line class="stepdown-fixed-line" x1="${left}" x2="${x(6)}" y1="${y(state.startCall)}" y2="${y(state.startCall)}"></line><path class="stepdown-call-line" d="${stairs.join(" ")}"></path><line class="stepdown-coupon-line" x1="${left}" x2="${width - right}" y1="${y(state.couponBarrier)}" y2="${y(state.couponBarrier)}"></line><line class="stepdown-protection-line" x1="${left}" x2="${width - right}" y1="${y(state.protectionBarrier)}" y2="${y(state.protectionBarrier)}"></line><path class="stepdown-underlying-line" d="${path}"></path>${state.path.map((value, indexValue) => `<circle class="stepdown-observation ${indexValue === state.selectedIndex ? "selected" : ""}" cx="${x(indexValue)}" cy="${y(value)}" r="${indexValue === state.selectedIndex ? 6 : 4}"></circle>`).join("")}${callEvent ? `<circle class="stepdown-call-event" cx="${x(result.calledIndex)}" cy="${y(callEvent.level)}" r="9"></circle><text class="stepdown-event-label" x="${x(result.calledIndex) + 11}" y="${y(callEvent.level) - 11}">CALLED Q${result.calledIndex + 1}</text>` : ""}<text class="axis stepdown-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Quarterly observation</text><text class="axis stepdown-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Underlying (% of initial)</text>`;
  }

  function lifecycleLabel(result) {
    return result.called
      ? `Called at Q${result.calledIndex + 1}`
      : result.protectionPass
        ? "Matures at par"
        : "Matures with principal loss";
  }

  function renderComparison() {
    const comparison = engine.compare(state);
    const cases = [
      [
        "Descending schedule",
        comparison.stepDown,
        `Threshold falls by ${state.stepSize.toFixed(1)} points toward ${state.callFloor.toFixed(0)}`,
      ],
      [
        "Fixed schedule",
        comparison.fixed,
        `Threshold remains ${state.startCall.toFixed(0)} at every early-call observation`,
      ],
    ];
    byId("stepdown-comparison").innerHTML = cases
      .map(
        (item, indexValue) =>
          `<article class="${indexValue ? "fixed" : "stepped"}"><span>${esc(item[0])}</span><h3>${esc(lifecycleLabel(item[1]))}</h3><div><p><b>${item[1].heldObservations}</b> observations held</p><p><b>${item[1].totalCoupons.toFixed(2)}</b> coupons</p><p><b>${item[1].totalCash.toFixed(2)}</b> total cash</p></div><small>${esc(item[2])}</small></article>`,
      )
      .join("");
    const differentCall = comparison.stepDown.calledIndex !== comparison.fixed.calledIndex;
    byId("stepdown-compare-note").textContent = differentCall
      ? `The moving threshold changes termination: ${lifecycleLabel(comparison.stepDown).toLowerCase()} versus ${lifecycleLabel(comparison.fixed).toLowerCase()}. Earlier return of principal is not automatically a larger total return because later coupons disappear.`
      : `On this path both schedules produce the same call outcome. Move an observation near the descending staircase to expose the difference.`;
  }

  function renderLedger(result) {
    byId("stepdown-ledger").innerHTML = result.events
      .map((event) => {
        const threshold = event.maturity ? "Maturity rule" : event.threshold.toFixed(1);
        const couponTest = event.active
          ? `${event.level.toFixed(1)} ${event.couponPass ? "≥" : "<"} ${state.couponBarrier.toFixed(1)}`
          : "Not tested";
        const callDecision = !event.active
          ? "Not observed"
          : event.maturity
            ? `Protection: ${event.level.toFixed(1)} ${event.level >= state.protectionBarrier ? "≥" : "<"} ${state.protectionBarrier.toFixed(1)}`
            : `${event.level.toFixed(1)} ${event.callPass ? "≥" : "<"} ${event.threshold.toFixed(1)} · ${event.callPass ? "Call" : "Continue"}`;
        return `<tr class="${event.callPass ? "stepdown-called-row" : !event.active ? "stepdown-inactive-row" : ""}"><td>Q${event.index + 1}${event.maturity ? " · final" : ""}</td><td>${event.level.toFixed(1)}</td><td>${esc(threshold)}</td><td class="${event.active && event.couponPass ? "event-positive" : event.active ? "event-negative" : "event-neutral"}">${esc(couponTest)}</td><td>${event.couponPaid.toFixed(2)}</td><td>${esc(callDecision)}</td><td>${esc(event.state)}</td></tr>`;
      })
      .join("");
    byId("stepdown-ledger-total").innerHTML =
      `<th>Total</th><td colspan="3">${result.called ? `Principal returned at Q${result.calledIndex + 1}` : `Final principal ${result.principal.toFixed(2)}`}</td><td>${result.totalCoupons.toFixed(2)}</td><td colspan="2">${result.totalCash.toFixed(2)} total cash</td>`;
  }

  function renderBoundaries() {
    const indexValue = Math.min(6, state.selectedIndex);
    const threshold = engine.callThreshold(state, indexValue);
    const cases = [
      [
        threshold.toFixed(2),
        `Exactly on Q${indexValue + 1} threshold`,
        `${threshold.toFixed(2)} ≥ ${threshold.toFixed(2)} · autocall passes`,
        "pass",
      ],
      [
        (threshold - 0.01).toFixed(2),
        `One hundredth below Q${indexValue + 1}`,
        `${(threshold - 0.01).toFixed(2)} < ${threshold.toFixed(2)} · note continues`,
        "fail",
      ],
      [
        state.callFloor.toFixed(2),
        "Schedule floor",
        `Later thresholds cannot fall below ${state.callFloor.toFixed(2)}`,
        "floor",
      ],
    ];
    byId("stepdown-boundaries").innerHTML = cases
      .map(
        (item) =>
          `<article class="${item[3]}"><span>${esc(item[1])}</span><strong>${esc(item[0])}</strong><p>${esc(item[2])}</p></article>`,
      )
      .join("");
  }

  function renderMeanings() {
    const items = [
      [
        "Call threshold",
        "Does the note terminate?",
        "A lower future level makes early redemption easier.",
      ],
      [
        "Coupon barrier",
        "Is this period’s income paid?",
        "It may be fixed, stepped or paired with memory independently of callability.",
      ],
      [
        "Protection barrier",
        "How much principal is repaid at maturity?",
        "It matters only if the note survives and the maturity terms reference it.",
      ],
      [
        "Call amount / premium",
        "What cash is paid if called?",
        "This may step up over time even while the call threshold steps down.",
      ],
    ];
    byId("stepdown-meanings").innerHTML = items
      .map(
        (item) =>
          `<article><span>${esc(item[1])}</span><h3>${esc(item[0])}</h3><p>${esc(item[2])}</p></article>`,
      )
      .join("");
  }

  function renderRules() {
    const rows = [
      [
        "Dated schedule",
        "What is the call threshold on every eligible observation date?",
        "A formula may step every observation, annually, in blocks or only on the final date.",
      ],
      [
        "Decrement convention",
        "Is the step an absolute percentage-point change or a percentage of the previous threshold?",
        "100 minus 5 points is 95; 100 reduced by 5% may compound differently later.",
      ],
      [
        "Floor and rounding",
        "When is the floor applied, and to how many decimals is each threshold rounded?",
        "Small differences change boundary outcomes.",
      ],
      [
        "Comparison operator",
        "Does equality pass: ≥ or strictly >?",
        "Exactly-on-trigger acceptance tests otherwise disagree.",
      ],
      [
        "Non-call period",
        "Which early observations pay coupons but cannot call?",
        "Coupon dates and call dates need not be the same set.",
      ],
      [
        "Event ordering",
        "On a call date, is the coupon tested and paid before redemption?",
        "The final cash flow can differ by one coupon or accumulated memory.",
      ],
      [
        "Reference measure",
        "Single asset, basket, average or worst performer—and normalized how?",
        "The schedule is useless until the observed quantity is defined.",
      ],
      [
        "Final observation",
        "Is the final date another call test or solely a maturity/protection test?",
        "Documents use both conventions; they create different outcomes between call and protection levels.",
      ],
      [
        "Disruption and settlement",
        "How are postponed observations, payment dates, cash amounts and issuer credit handled?",
        "A market trigger does not itself specify a receivable or payment date.",
      ],
    ];
    byId("stepdown-rules").innerHTML = rows
      .map(
        (row) => `<tr><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`,
      )
      .join("");
  }

  function render() {
    const result = engine.evaluate(state);
    renderPresets();
    renderObservations();
    renderOutputs();
    const label = state.id === "custom" ? "Custom path" : presets[state.id].name;
    byId("stepdown-headline").textContent = label;
    byId("stepdown-summary").textContent = result.called
      ? `The note survives until Q${result.calledIndex + 1}, when the underlying at ${result.events[result.calledIndex].level.toFixed(0)} meets the stepped-down ${result.events[result.calledIndex].threshold.toFixed(0)} call threshold. Future observations no longer matter.`
      : `No pre-maturity call threshold is met. The final level of ${result.finalLevel.toFixed(0)} therefore reaches the separate maturity rule.`;
    const stats = [
      [
        result.called ? `Q${result.calledIndex + 1}` : "Not called",
        "Autocall outcome",
        result.called
          ? `${result.events[result.calledIndex].level.toFixed(0)} ≥ ${result.events[result.calledIndex].threshold.toFixed(0)}`
          : "All seven early-call tests fail",
      ],
      [
        result.totalCoupons.toFixed(2),
        "Coupons received",
        "Paid only while the note remains alive",
      ],
      [
        result.principal.toFixed(2),
        "Principal redemption",
        result.called || result.protectionPass
          ? "100 under the selected route"
          : "1-for-1 downside at maturity",
      ],
      [
        signed(result.totalReturn),
        "Total return",
        `${result.totalCash.toFixed(2)} total cash per 100 nominal`,
      ],
    ];
    byId("stepdown-stats").innerHTML = stats
      .map(
        (stat) =>
          `<div><span>${esc(stat[1])}</span><strong>${esc(stat[0])}</strong><p>${esc(stat[2])}</p></div>`,
      )
      .join("");
    byId("stepdown-outcome").textContent = result.called
      ? `Q${result.calledIndex + 1} pays the current contingent coupon, returns 100 principal and cancels all later opportunities. Total cash is ${result.totalCash.toFixed(2)}.`
      : result.protectionPass
        ? `The note reaches maturity above the ${state.protectionBarrier.toFixed(0)} protection barrier, returning 100 principal plus ${result.totalCoupons.toFixed(2)} coupons.`
        : `The final level is below the ${state.protectionBarrier.toFixed(0)} protection barrier. Principal falls to ${result.principal.toFixed(2)}; coupons bring total cash to ${result.totalCash.toFixed(2)}.`;
    renderChart(result);
    renderComparison();
    renderLedger(result);
    renderBoundaries();
    renderMeanings();
    renderRules();
  }

  byId("stepdown-reset").addEventListener("click", () => {
    state = defaults();
    syncControls();
    render();
  });
  createControls();
  render();
})();
