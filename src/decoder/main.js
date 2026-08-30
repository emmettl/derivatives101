"use strict";

import { clauses } from "./clauses.js";

const defaults = [0, 0, 0, 0, 0];
const state = { selected: 0, choices: defaults.slice() };
const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]));
}

function renderClauseList() {
  byId("decoder-clause-list").innerHTML = clauses.map((clause, index) => {
    const chosen = clause.options[state.choices[index]];
    return `<button type="button" class="clause-card${index === state.selected ? " active" : ""}" data-clause="${index}" aria-pressed="${index === state.selected}"><span>${String(index + 1).padStart(2, "0")} · ${escapeHtml(clause.category)}</span><strong>${escapeHtml(clause.title)}</strong><small>${escapeHtml(chosen.label)}</small></button>`;
  }).join("");
  byId("decoder-clause-list").querySelectorAll("[data-clause]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selected = Number(button.dataset.clause);
      render();
    });
  });
}

function renderDetail() {
  const clause = clauses[state.selected];
  const selectedChoice = state.choices[state.selected];
  byId("clause-category").textContent = `${clause.id} · ${clause.category}`;
  byId("resolution-title").textContent = clause.title;
  byId("clause-problem").textContent = clause.problem;
  byId("clause-severity").textContent = clause.severity;
  byId("draft-language").innerHTML = `<span>Draft language</span>“${escapeHtml(clause.quote)}”`;
  byId("resolution-options").innerHTML = clause.options.map((option, index) => `<button type="button" class="resolution-option${index === selectedChoice ? " active" : ""}" data-choice="${index}" aria-pressed="${index === selectedChoice}"><span>${escapeHtml(option.tag)}</span><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.rule)}</small></button>`).join("");
  byId("resolution-options").querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      state.choices[state.selected] = Number(button.dataset.choice);
      render();
    });
  });
  const chosen = clause.options[selectedChoice];
  const other = clause.options[selectedChoice === 0 ? 1 : 0];
  byId("impact-compare").innerHTML = `<div><span>Selected interpretation</span><strong>${escapeHtml(chosen.label)}</strong><p>${escapeHtml(chosen.impact)}</p></div><div><span>Other interpretation</span><strong>${escapeHtml(other.label)}</strong><p>${escapeHtml(other.impact)}</p></div>`;
}

function flowSteps() {
  const couponFirst = state.choices[1] === 0;
  const fixing = state.choices[2] === 0 ? "Postpone within the defined window; otherwise estimate and flag" : "Use the preceding valid official close and flag";
  const coupon = state.choices[3] === 0 ? "Pay current coupon plus eligible memory when the test passes" : "On a call date, pay current coupon only and cancel memory";
  if (couponFirst) {
    return [
      ["Validate fixing", fixing],
      ["Update barrier state", state.choices[0] === 0 ? "Set persistent state when close ≤ 60" : "Set persistent state when close < 60"],
      ["Evaluate coupon", coupon],
      ["Evaluate autocall", "If eligible and close ≥ 100, book principal and set REDEEMED"],
      ["Settle or continue", "Pay booked cash; stop future events only after redemption"]
    ];
  }
  return [
    ["Validate fixing", fixing],
    ["Update barrier state", state.choices[0] === 0 ? "Set persistent state when close ≤ 60" : "Set persistent state when close < 60"],
    ["Evaluate autocall", "If eligible and close ≥ 100, book principal and set REDEEMED"],
    ["Evaluate coupon", "Run only if the note remains ACTIVE after the call test"],
    ["Settle or continue", "Pay booked cash; stop all future observations after redemption"]
  ];
}

function renderFlow() {
  const steps = flowSteps();
  const flow = byId("event-flow");
  flow.style.setProperty("--flow-count", steps.length);
  flow.innerHTML = steps.map((step, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(step[0])}</strong><small>${escapeHtml(step[1])}</small></li>`).join("");
  byId("flow-note").innerHTML = state.choices[1] === 0
    ? `<strong>Same-day result:</strong> a passing coupon is booked before a successful autocall terminates the note.`
    : `<strong>Same-day result:</strong> a successful autocall terminates the note before the current coupon is evaluated.`;
}

function selectedRules() {
  return clauses.map((clause, index) => ({ id: clause.id, name: clause.category, definition: clause.options[state.choices[index]].rule }));
}

function renderSpecification() {
  const settlement = state.choices[4] === 0 ? "Physical downside delivery" : "Cash-only downside settlement";
  const order = state.choices[1] === 0 ? "Coupon → autocall" : "Autocall → coupon if active";
  byId("spec-overview").innerHTML = [
    ["Product", "Fictional autocallable RC"],
    ["Notional", "1,000 currency units"],
    ["Observation", "Quarterly; official close"],
    ["Event order", order],
    ["Persistent state", "Barrier flag; memory balance"],
    ["Downside", settlement]
  ].map((item) => `<div><span>${escapeHtml(item[0])}</span><strong>${escapeHtml(item[1])}</strong></div>`).join("");
  byId("decoder-rule-strip").innerHTML = `<b>ACTIVE note</b><i>→</i><span>validated fixing</span><i>→</i><span>state update</span><i>→</i><span>cash-flow tests</span><i>→</i><span>redemption test</span><i>→</i><b>ACTIVE / REDEEMED / MATURED</b>`;
  const staticRules = [
    { id: "ID-01", name: "Product identity", definition: "Single-underlying, three-year note; nominal 1,000; initial level and strike normalised to 100 unless a test explicitly overrides strike." },
    { id: "DAT-01", name: "Scheduled events", definition: "Quarterly observation dates; first three are non-call; dates falling on a non-trading day move to the next scheduled trading day." },
    { id: "MKT-01", name: "Market input", definition: "Use the underlying exchange’s official closing level for the applicable observation day and retain source, timestamp and validity status." },
    { id: "CPN-01", name: "Coupon condition", definition: "Current coupon is 2% of nominal. If officialClose ≥ 70, apply the selected memory rule; otherwise add 20 to memoryBalance." },
    { id: "CAL-01", name: "Autocall condition", definition: "From observation four onward, call automatically when officialClose ≥ 100, subject to the selected same-day order." },
    { id: "MAT-01", name: "Maturity branch", definition: "If still ACTIVE at maturity: repay par when barrierBreached is false or finalLevel ≥ strike; otherwise apply the selected downside settlement." }
  ];
  byId("compiled-rules").innerHTML = staticRules.concat(selectedRules()).map((rule) => `<tr><td>${escapeHtml(rule.id)}</td><td>${escapeHtml(rule.name)}</td><td>${escapeHtml(rule.definition)}</td></tr>`).join("");
}

function acceptanceTests() {
  const tests = [];
  tests.push({
    id: "AT-BAR-01",
    title: "Exact barrier touch",
    given: "An active note, barrier 60, no prior breach or call and final level 80.",
    when: "A monitored official close is exactly 60.",
    then: state.choices[0] === 0 ? "barrierBreached becomes true; maturity delivers 10 units worth 800." : "barrierBreached remains false; maturity repays 1,000 cash."
  });
  tests.push({
    id: "AT-ORD-01",
    title: "Coupon and autocall pass together",
    given: "Observation four, active note, no memory and official close 105.",
    when: "The coupon threshold and autocall trigger are both satisfied.",
    then: state.choices[1] === 0 ? "book a 20 coupon, then redeem; total cash due is 1,020." : "redeem before testing the coupon; total cash due is 1,000."
  });
  tests.push({
    id: "AT-DIS-01",
    title: "Scheduled fixing is unavailable",
    given: "The preceding valid close is 98; the scheduled observation has no official close; the next valid close is 102.",
    when: "The observation engine requests the contractual fixing.",
    then: state.choices[2] === 0 ? "use 102 on the postponed date, retain a disruption flag and satisfy the call test." : "use the preceding close of 98, retain a disruption flag and leave the note active."
  });
  tests.push({
    id: "AT-MEM-01",
    title: "Memory balance on a call date",
    given: "An active note has 40 memory; the current 20 coupon and autocall conditions both pass.",
    when: "The selected same-day event sequence is applied.",
    then: state.choices[1] === 1
      ? "the autocall terminates the note before any coupon test; pay no coupon and cancel memory on redemption. ORD-01 therefore dominates MEM-01."
      : (state.choices[3] === 0 ? "book 60 coupon cash and clear memoryBalance before redemption." : "book 20 current coupon, cancel the 40 memory balance and then redeem.")
  });
  tests.push({
    id: "AT-SET-01",
    title: "Fractional downside entitlement",
    given: "Nominal 1,000, strike 99, barrier breached and final level 80.",
    when: "The active note reaches maturity below strike.",
    then: state.choices[4] === 0 ? "deliver 10 whole units plus 8.08 cash-in-lieu; total value 808.08." : "deliver no units and pay 808.08 cash."
  });
  return tests;
}

function renderTests() {
  byId("acceptance-tests").innerHTML = acceptanceTests().map((test) => `<article class="acceptance-test"><header><span>${escapeHtml(test.id)}</span><strong>${escapeHtml(test.title)}</strong></header><dl><div><dt>Given</dt><dd>${escapeHtml(test.given)}</dd></div><div><dt>When</dt><dd>${escapeHtml(test.when)}</dd></div><div><dt>Then</dt><dd>${escapeHtml(test.then)}</dd></div></dl></article>`).join("");
}

function renderReady() {
  const items = [
    ["Product identity", "Economic family, parties, currency and nominal"],
    ["Dates & calendars", "Scheduled dates, adjustments and non-call period"],
    ["Market data", "Source, time, validity and disruption handling"],
    ["Comparisons", "Every threshold with an explicit operator"],
    ["Persistent state", "Barrier flag, memory balance and note state"],
    ["Event ordering", "Same-day sequence and termination point"],
    ["Cash flows", "Amounts, accrual, payment dates and cancellation"],
    ["Settlement", "Cash or asset, ratio, fractions and rounding"]
  ];
  byId("ready-grid").innerHTML = items.map((item) => `<div><span aria-hidden="true">✓</span><p><strong>${escapeHtml(item[0])}</strong><small>${escapeHtml(item[1])}</small></p></div>`).join("");
}

function specificationText() {
  const lines = [
    "TERM SHEET DECODER — FICTIONAL SPECIFICATION",
    "",
    "Static terms",
    "- Product: single-underlying three-year autocallable reverse convertible",
    "- Nominal: 1,000; initial level: 100; strike: 100",
    "- Coupon: 2% quarterly, conditional at level >= 70, with memory",
    "- Autocall: quarterly from observation 4 when level >= 100",
    "- Barrier: 60, monitored on scheduled trading-day official closes",
    "",
    "Resolved rules"
  ];
  selectedRules().forEach((rule) => lines.push(`- ${rule.id} ${rule.name}: ${rule.definition}`));
  lines.push("", "Acceptance tests");
  acceptanceTests().forEach((test) => lines.push(`- ${test.id} ${test.title}: GIVEN ${test.given} WHEN ${test.when} THEN ${test.then}`));
  lines.push("", "Outside scope: corporate actions, tax, issuer default, hedging, secondary-market valuation and jurisdiction-specific legal drafting.");
  return lines.join("\n");
}

async function copySpecification() {
  const status = byId("copy-status");
  try {
    await navigator.clipboard.writeText(specificationText());
    status.textContent = "Specification and acceptance tests copied.";
  } catch (error) {
    status.textContent = "Copy was unavailable in this browser. The compiled rules remain visible above.";
  }
}

function renderSummary() {
  const alternatives = state.choices.reduce((total, choice) => total + (choice === 1 ? 1 : 0), 0);
  byId("decoder-count").textContent = "32 possible specifications";
  byId("decoder-summary").textContent = alternatives === 0
    ? "The five illustrative conventions now compile into one rule set. Each alternative changes an observable outcome or delivery."
    : `${alternatives} of 5 clauses use the alternative interpretation. The compiled rules and acceptance results below have changed with them.`;
}

function render() {
  renderSummary();
  renderClauseList();
  renderDetail();
  renderFlow();
  renderSpecification();
  renderTests();
  renderReady();
}

byId("decoder-reset").addEventListener("click", () => {
  state.selected = 0;
  state.choices = defaults.slice();
  byId("copy-status").textContent = "";
  render();
});
byId("copy-spec").addEventListener("click", copySpecification);
render();
