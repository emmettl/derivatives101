"use strict";

import * as engine from "./engine.ts";

const byId = (id) => document.getElementById(id);
const choiceOptions = {
  referenceMeasure: [
    ["unresolved", "Unresolved"],
    ["worst", "Worst-of"],
    ["average", "Average"],
  ],
  callComparison: [
    ["unresolved", "Unresolved"],
    ["gte", "At or above (≥)"],
    ["gt", "Strictly above (>)"],
  ],
  memory: [
    ["unresolved", "Unresolved"],
    ["yes", "Memory"],
    ["no", "No memory"],
  ],
  eventOrder: [
    ["unresolved", "Unresolved"],
    ["coupon-first", "Coupon → call"],
    ["call-first", "Call → coupon if active"],
  ],
  finalConvention: [
    ["unresolved", "Unresolved"],
    ["maturity-only", "Maturity only"],
    ["final-call", "Final call test"],
  ],
  settlement: [
    ["unresolved", "Unresolved"],
    ["cash", "Cash"],
    ["physical", "Physical"],
  ],
};
let state = Object.assign({}, engine.profiles.resolved, { scenarioId: "lateCall" });

function esc(value) {
  return String(value).replace(
    /[&<>"]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char],
  );
}

function renderProfiles() {
  byId("spec-profiles").innerHTML = Object.values(engine.profiles)
    .map(
      (profile) =>
        `<button type="button" data-profile="${profile.id}" class="${state.id === profile.id ? "on" : ""}" aria-pressed="${state.id === profile.id}">${esc(profile.name)}</button>`,
    )
    .join("");
  byId("spec-profiles")
    .querySelectorAll("[data-profile]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        const scenarioId = state.scenarioId;
        state = Object.assign({}, engine.profiles[button.dataset.profile], { scenarioId });
        render();
      }),
    );
}

function renderControls() {
  byId("spec-controls").innerHTML = engine.choiceDefinitions
    .map(
      (field) =>
        `<div class="control-block"><label for="spec-${field.key}">${esc(field.label)}</label><select id="spec-${field.key}">${choiceOptions[field.key].map((option) => `<option value="${option[0]}"${option[0] === state[field.key] ? " selected" : ""}>${esc(option[1])}</option>`).join("")}</select></div>`,
    )
    .join("");
  engine.choiceDefinitions.forEach((field) =>
    byId(`spec-${field.key}`).addEventListener("change", (event) => {
      state[field.key] = event.target.value;
      state.id = "custom";
      render();
    }),
  );
}

function renderScenarios() {
  byId("spec-scenarios").innerHTML = Object.values(engine.scenarios)
    .map(
      (scenario) =>
        `<button type="button" data-scenario="${scenario.id}" class="${state.scenarioId === scenario.id ? "on" : ""}" aria-pressed="${state.scenarioId === scenario.id}">${esc(scenario.name)}</button>`,
    )
    .join("");
  byId("spec-scenarios")
    .querySelectorAll("[data-scenario]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        state.scenarioId = button.dataset.scenario;
        render();
      }),
    );
  byId("scenario-note").textContent = engine.scenarios[state.scenarioId].note;
}

function renderReadiness() {
  const readiness = engine.compile(state);
  const tests = engine.acceptanceTests(state);
  const status = byId("spec-status");
  status.textContent = readiness.executable
    ? "Ready to execute"
    : readiness.blockers.length
      ? "Blocked"
      : "Decisions open";
  status.className = `spec-status ${readiness.executable ? "ready" : "blocked"}`;
  byId("spec-readiness").innerHTML = [
    [readiness.resolved, `of ${readiness.required} decisions`, "Explicit choices"],
    [readiness.open.length, "need an owner and answer", "Open questions"],
    [readiness.blockers.length, "internally inconsistent", "Build blockers"],
    [tests.length, "generated boundary cases", "Acceptance tests"],
  ]
    .map(
      (item) =>
        `<div><span>${esc(item[2])}</span><strong>${esc(item[0])}</strong><p>${esc(item[1])}</p></div>`,
    )
    .join("");
  byId("spec-pipeline").innerHTML =
    `<div><span>01 · Source language</span><strong>Six economic decisions</strong><p>“Linked to A and B”, “above the trigger”, “with memory” and “may settle physically” are not executable by themselves.</p></div><div><span>02 · Normalized contract</span><strong>${readiness.resolved}/${readiness.required} choices resolved</strong><ul><li>Named inputs and comparison operators</li><li>Persistent state and same-day ordering</li><li>Termination and settlement outputs</li></ul></div><div><span>03 · Evidence</span><strong>${readiness.executable ? "Trace + 10 tests" : "Outputs held"}</strong><p>${readiness.executable ? "One scenario can run through the compiled rules, and boundaries have expected results." : "Execution waits until every required decision is explicit and consistent."}</p></div>`;
  const issues = readiness.open.concat(readiness.blockers);
  byId("spec-issues").innerHTML = issues.length
    ? issues
        .map(
          (issue) =>
            `<div class="spec-issue"><span>${issue.severity === "blocker" ? "Blocker" : "Open decision"}</span><p><strong>${esc(issue.label)}:</strong> ${esc(issue.message)}</p></div>`,
        )
        .join("")
    : `<div class="clear"><strong>No unresolved or contradictory core decisions.</strong> The specimen is executable under its simplified scope.</div>`;
}

function renderFlow() {
  const unresolved = (key) => state[key] === "unresolved";
  const steps = [
    ["Validate observation", "Use the scheduled official closes for both assets."],
    [
      "Calculate reference",
      unresolved("referenceMeasure")
        ? "Worst-of or average is still undecided."
        : state.referenceMeasure === "worst"
          ? "Take the lower of Asset A and Asset B."
          : "Take the arithmetic mean of A and B.",
    ],
    [
      state.eventOrder === "call-first" ? "Test autocall" : "Test coupon",
      unresolved("eventOrder")
        ? "Same-day event ordering is still undecided."
        : state.eventOrder === "call-first"
          ? "A successful call terminates before coupon testing."
          : "Pay or bank coupon before testing the call.",
    ],
    [
      state.eventOrder === "call-first" ? "Test coupon if active" : "Test autocall",
      unresolved("eventOrder")
        ? "Same-day event ordering is still undecided."
        : state.eventOrder === "call-first"
          ? "Run only if no same-day call occurred."
          : "Apply the dated trigger after booking coupon cash.",
    ],
    [
      "Settle or continue",
      unresolved("settlement") || unresolved("finalConvention")
        ? "Final-date or settlement rule remains open."
        : "Persist state, ignore post-call events, or apply the final settlement branch.",
    ],
  ];
  byId("spec-flow").style.setProperty("--flow-count", steps.length);
  byId("spec-flow").innerHTML = steps
    .map(
      (step, index) =>
        `<li class="${/undecided|remains open/.test(step[1]) ? "pending" : "complete"}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${esc(step[0])}</strong><small>${esc(step[1])}</small></li>`,
    )
    .join("");
  byId("spec-flow-note").innerHTML =
    state.eventOrder === "unresolved"
      ? "<strong>Blocked:</strong> a level that satisfies both conditions has two plausible cash-flow outcomes."
      : state.eventOrder === "coupon-first"
        ? "<strong>Selected ordering:</strong> a coupon that passes on a call date is booked before principal redemption."
        : "<strong>Selected ordering:</strong> a successful call terminates the note before that date’s coupon is tested.";
}

function renderNormalized() {
  const readiness = engine.compile(state);
  const rows = engine.normalizedRows(state);
  byId("spec-rules").innerHTML = rows
    .map(
      (row) =>
        `<tr class="${row[2].includes("UNRESOLVED") ? "unresolved" : ""}"><td>${esc(row[0])}</td><td>${esc(row[1])}</td><td>${esc(row[2])}</td></tr>`,
    )
    .join("");
  byId("spec-artifacts").innerHTML = [
    [
      readiness.resolved === readiness.required,
      "Decision log",
      `${readiness.resolved}/${readiness.required} core choices recorded`,
    ],
    [
      readiness.open.length === 0,
      "Rulebook",
      readiness.open.length
        ? `${readiness.open.length} definitions still open`
        : "Terms and operators normalized",
    ],
    [
      readiness.executable,
      "Scenario trace",
      readiness.executable ? "Selected path evaluated" : "Held until contract compiles",
    ],
    [
      readiness.executable,
      "Test matrix",
      readiness.executable ? "10 expected results generated" : "Pending decisions remain visible",
    ],
  ]
    .map(
      (item) =>
        `<div class="${item[0] ? "ready" : "held"}"><span>${item[0] ? "Ready" : "Held"}</span><strong>${esc(item[1])}</strong><p>${esc(item[2])}</p></div>`,
    )
    .join("");
}

function renderPathChart(result, scenario) {
  const svg = byId("spec-path-chart");
  const width = 900,
    height = 360,
    left = 60,
    right = 26,
    top = 24,
    bottom = 50;
  const minimum = 45,
    maximum = 105;
  const x = (index) => left + (index / 3) * (width - left - right);
  const y = (value) => top + ((maximum - value) / (maximum - minimum)) * (height - top - bottom);
  const path = (values) =>
    values
      .map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)}`)
      .join(" ");
  const reference = result.events.map((event) => event.reference);
  const yTicks = [50, 60, 70, 80, 90, 100];
  svg.innerHTML = `<title>${esc(scenario.name)} path trace</title><desc>Asset A, Asset B and the selected basket reference are compared with the descending autocall trigger at each observation.</desc>${yTicks.map((tick) => `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}"></line><text class="axis" x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick}</text>`).join("")}${engine.terms.observationLabels.map((label, index) => `<line class="grid" x1="${x(index)}" x2="${x(index)}" y1="${top}" y2="${height - bottom}"></line><text class="axis" x="${x(index)}" y="${height - bottom + 19}" text-anchor="middle">${esc(label)}</text>`).join("")}<path class="spec-line-trigger" d="${path(engine.terms.callSchedule)}"></path><path class="spec-line-a" d="${path(scenario.A)}"></path><path class="spec-line-b" d="${path(scenario.B)}"></path><path class="spec-line-reference" d="${path(reference)}"></path>${result.events.map((event) => `<circle class="spec-point ${event.status}" cx="${x(event.index)}" cy="${y(event.reference)}" r="5"></circle>${event.coupon ? `<text class="spec-coupon" x="${x(event.index)}" y="${y(event.reference) - 10}" text-anchor="middle">+${event.coupon.toFixed(0)}</text>` : ""}`).join("")}<text class="axis spec-axis-title" x="${(left + width - right) / 2}" y="${height - 8}" text-anchor="middle">Contractual observation</text><text class="axis spec-axis-title" x="14" y="${(top + height - bottom) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(top + height - bottom) / 2})">Percent of initial level</text>`;
}

function renderTrace() {
  const scenario = engine.scenarios[state.scenarioId];
  const result = engine.evaluate(state, scenario);
  const gate = byId("trace-gate");
  const output = byId("trace-output");
  if (!result.executable) {
    gate.className = "spec-gate visible";
    gate.innerHTML = `<strong>Trace withheld.</strong> Resolve ${result.readiness.open.length} open decision${result.readiness.open.length === 1 ? "" : "s"} and ${result.readiness.blockers.length} blocker${result.readiness.blockers.length === 1 ? "" : "s"}. A worked example should never hide assumptions merely to produce a number.`;
    output.className = "hidden";
    return;
  }
  gate.className = "spec-gate";
  output.className = "";
  const terminal =
    result.calledIndex >= 0
      ? `Called ${engine.terms.observationLabels[result.calledIndex]}`
      : "Matured";
  byId("trace-stats").innerHTML = [
    [terminal, "Lifecycle result", "First terminal event wins"],
    [
      result.couponCash.toFixed(2),
      "Coupon cash",
      result.expiredMemory
        ? `${result.expiredMemory.toFixed(2)} memory expired`
        : "No unpaid memory",
    ],
    [
      result.principalCash.toFixed(2),
      "Principal cash",
      result.delivered ? "Asset delivery replaces cash" : "Cash principal due",
    ],
    [result.totalEconomic.toFixed(2), "Economic outcome", "Coupon plus cash or delivered value"],
  ]
    .map(
      (item) =>
        `<div><span>${esc(item[1])}</span><strong>${esc(item[0])}</strong><p>${esc(item[2])}</p></div>`,
    )
    .join("");
  renderPathChart(result, scenario);
  byId("trace-ledger").innerHTML = result.events
    .map((event) => {
      const callTest =
        event.status === "inactive"
          ? "Not evaluated"
          : event.callEligible
            ? `${event.reference.toFixed(2)} ${state.callComparison === "gte" ? "≥" : ">"} ${engine.terms.callSchedule[event.index].toFixed(2)} → ${event.call ? "PASS" : "FAIL"}`
            : "Not a call date";
      const coupon =
        event.status === "inactive"
          ? "Not evaluated"
          : event.couponStatus === "skipped"
            ? "Skipped after call"
            : event.coupon
              ? `${event.coupon.toFixed(2)} paid (${event.couponStatus})`
              : `0.00 (${event.couponStatus})`;
      return `<tr class="${event.status}"><td>${esc(event.label)}</td><td>${event.a.toFixed(2)}</td><td>${event.b.toFixed(2)}</td><td>${event.reference.toFixed(2)}</td><td>${esc(callTest)}</td><td>${esc(coupon)}</td><td>${event.memoryBalance.toFixed(2)}</td><td>${event.status === "called" ? "REDEEMED" : event.status === "inactive" ? "INACTIVE" : event.index === 3 ? "MATURED" : "ACTIVE"}</td></tr>`;
    })
    .join("");
  byId("trace-settlement").innerHTML = [
    ["Coupon cash", result.couponCash.toFixed(2), "Paid over the lifecycle"],
    [
      result.delivered ? "Delivered asset" : "Principal cash",
      result.delivered
        ? `${result.delivered.units.toFixed(2)} × Asset ${result.delivered.asset}`
        : result.principalCash.toFixed(2),
      result.delivered
        ? `Worth ${result.delivered.value.toFixed(2)} at final level`
        : "Cash redemption amount",
    ],
    [
      "Total economic value",
      result.totalEconomic.toFixed(2),
      `Total cash paid ${result.totalCash.toFixed(2)}`,
    ],
  ]
    .map(
      (item) =>
        `<div><span>${esc(item[0])}</span><strong>${esc(item[1])}</strong><p>${esc(item[2])}</p></div>`,
    )
    .join("");
  byId("trace-narrative").textContent =
    `${result.settlementStatus} Coupon cash is ${result.couponCash.toFixed(2)}; ${result.expiredMemory ? `${result.expiredMemory.toFixed(2)} of unpaid memory expires at termination. ` : ""}The total economic outcome at settlement is ${result.totalEconomic.toFixed(2)}.`;
}

function renderTests() {
  const readiness = engine.compile(state);
  byId("spec-tests").innerHTML = engine
    .acceptanceTests(state)
    .map(
      (test) =>
        `<tr><td>${esc(test.id)}</td><td>${esc(test.title)}</td><td>${esc(test.given)}</td><td>${esc(test.expected)}</td><td class="${readiness.executable && !/BLOCKED|Pending/.test(test.expected) ? "test-pass" : "test-pending"}">${readiness.executable && !/BLOCKED|Pending/.test(test.expected) ? "Specified" : "Pending"}</td></tr>`,
    )
    .join("");
}

function specificationText() {
  const readiness = engine.compile(state);
  const scenario = engine.scenarios[state.scenarioId];
  const result = engine.evaluate(state, scenario);
  const lines = [
    "DERIVATIVES 101 — FICTIONAL SPECIFICATION CAPSTONE",
    "",
    `Status: ${readiness.executable ? "EXECUTABLE" : "NOT READY"}`,
    "",
    "Normalized rules",
  ];
  engine.normalizedRows(state).forEach((row) => lines.push(`- ${row[0]} ${row[1]}: ${row[2]}`));
  lines.push("", "Acceptance tests");
  engine
    .acceptanceTests(state)
    .forEach((test) =>
      lines.push(`- ${test.id} ${test.title}: GIVEN ${test.given}; EXPECT ${test.expected}`),
    );
  if (result.executable)
    lines.push(
      "",
      `Worked scenario: ${scenario.name}`,
      `Outcome: ${result.settlementStatus}`,
      `Coupon cash: ${result.couponCash.toFixed(2)}; total economic outcome: ${result.totalEconomic.toFixed(2)}`,
    );
  lines.push(
    "",
    "Scope: fictional normalized teaching example; excludes calendars, disruptions, corporate actions, issuer credit, tax, valuation and legal drafting.",
  );
  return lines.join("\n");
}

async function copySpecification() {
  try {
    await navigator.clipboard.writeText(specificationText());
    byId("copy-status").textContent = "Normalized rules, worked result and boundary tests copied.";
  } catch {
    byId("copy-status").textContent =
      "Copy is unavailable in this browser. The complete specification remains visible above.";
  }
}

function renderSummary() {
  const readiness = engine.compile(state);
  byId("spec-headline").textContent = readiness.executable
    ? "Executable specimen"
    : readiness.blockers.length
      ? "Contradictory specification"
      : "Draft is not ready";
  byId("spec-summary").textContent = readiness.executable
    ? `All six core decisions are explicit. The ${engine.scenarios[state.scenarioId].name.toLowerCase()} path can now be evaluated against one deterministic contract.`
    : readiness.blockers.length
      ? `${readiness.blockers.length} rule combination cannot be executed without another decision, even though every field is filled.`
      : `${readiness.open.length} required decisions remain open. The lifecycle trace is intentionally withheld rather than silently assuming conventions.`;
}

function render() {
  renderProfiles();
  renderControls();
  renderScenarios();
  renderSummary();
  renderReadiness();
  renderFlow();
  renderNormalized();
  renderTrace();
  renderTests();
}

byId("spec-reset").addEventListener("click", () => {
  state = Object.assign({}, engine.profiles.resolved, { scenarioId: "lateCall" });
  render();
});
byId("copy-spec").addEventListener("click", copySpecification);
render();
