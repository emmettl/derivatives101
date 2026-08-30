"use strict";

const terms = {
  nominal: 100,
  initialLevels: { A: 100, B: 100 },
  observationLabels: ["Q1", "Q2", "Q3", "Final"],
  callSchedule: [100, 95, 90, 85],
  couponBarrier: 70,
  couponAmount: 2,
  protectionBarrier: 60,
};

const profiles = {
  resolved: {
    id: "resolved",
    name: "Resolved specimen",
    referenceMeasure: "worst",
    callComparison: "gte",
    memory: "yes",
    eventOrder: "coupon-first",
    finalConvention: "maturity-only",
    settlement: "cash",
  },
  draft: {
    id: "draft",
    name: "Ambiguous draft",
    referenceMeasure: "unresolved",
    callComparison: "unresolved",
    memory: "yes",
    eventOrder: "unresolved",
    finalConvention: "unresolved",
    settlement: "unresolved",
  },
  conflict: {
    id: "conflict",
    name: "Settlement conflict",
    referenceMeasure: "average",
    callComparison: "gte",
    memory: "yes",
    eventOrder: "coupon-first",
    finalConvention: "final-call",
    settlement: "physical",
  },
};

const scenarios = {
  lateCall: {
    id: "lateCall",
    name: "Late step-down call",
    A: [94, 92, 93, 96],
    B: [89, 91, 90, 94],
    note: "The worst performer misses 100 and 95, then meets the Q3 trigger exactly.",
  },
  memoryRecovery: {
    id: "memoryRecovery",
    name: "Memory recovery",
    A: [84, 68, 79, 82],
    B: [81, 66, 76, 80],
    note: "The Q2 coupon is missed, then recovered at Q3 while every call test fails.",
  },
  boundary: {
    id: "boundary",
    name: "Call boundary",
    A: [92, 95, 89, 86],
    B: [90, 95, 88, 84],
    note: "Both names equal the Q2 call trigger, exposing the inclusive-versus-strict comparison.",
  },
  downside: {
    id: "downside",
    name: "Downside settlement",
    A: [88, 77, 68, 55],
    B: [85, 74, 64, 50],
    note: "No call occurs; the final reference is below the protection barrier.",
  },
};

const choiceDefinitions = [
  {
    key: "referenceMeasure",
    label: "Basket reference",
    unresolved: "Is the applicable level worst-of or average?",
  },
  {
    key: "callComparison",
    label: "Call comparison",
    unresolved: "Does equality with a call trigger redeem the note?",
  },
  {
    key: "memory",
    label: "Coupon memory",
    unresolved: "Are missed coupons banked or permanently lost?",
  },
  {
    key: "eventOrder",
    label: "Same-day order",
    unresolved: "Is coupon evaluated before or after the call?",
  },
  {
    key: "finalConvention",
    label: "Final date",
    unresolved: "Is the final observation also an autocall date?",
  },
  {
    key: "settlement",
    label: "Downside settlement",
    unresolved: "Is a loss paid in cash or by delivering an asset?",
  },
];

function referenceLevel(a, b, measure) {
  return measure === "average" ? (a + b) / 2 : Math.min(a, b);
}

function comparisonPass(value, threshold, operator) {
  return operator === "gt" ? value > threshold : value >= threshold;
}

function compile(config) {
  const open = choiceDefinitions
    .filter((field) => config[field.key] === "unresolved")
    .map((field) => ({
      id: field.key,
      label: field.label,
      message: field.unresolved,
      severity: "open",
    }));
  const blockers = [];
  if (config.referenceMeasure === "average" && config.settlement === "physical") {
    blockers.push({
      id: "average-physical",
      label: "Deliverable asset",
      message:
        "Physical settlement cannot be executed from an average reference without defining which asset and delivery ratio apply.",
      severity: "blocker",
    });
  }
  return {
    required: choiceDefinitions.length,
    resolved: choiceDefinitions.length - open.length,
    open,
    blockers,
    executable: open.length === 0 && blockers.length === 0,
  };
}

function evaluate(config, scenario) {
  const readiness = compile(config);
  if (!readiness.executable) return { executable: false, readiness, events: [] };

  let active = true;
  let memoryBalance = 0;
  let couponCash = 0;
  let calledIndex = -1;
  const events = [];

  for (let index = 0; index < terms.observationLabels.length; index += 1) {
    const a = scenario.A[index];
    const b = scenario.B[index];
    const reference = referenceLevel(a, b, config.referenceMeasure);
    if (!active) {
      events.push({
        index,
        label: terms.observationLabels[index],
        a,
        b,
        reference,
        status: "inactive",
        coupon: 0,
        call: false,
        memoryBalance,
      });
      continue;
    }

    const finalDate = index === terms.observationLabels.length - 1;
    const callEligible = !finalDate || config.finalConvention === "final-call";
    const call =
      callEligible && comparisonPass(reference, terms.callSchedule[index], config.callComparison);
    let coupon = 0;
    let couponStatus = "missed";

    if (config.eventOrder === "call-first" && call) {
      couponStatus = "skipped";
    } else if (reference >= terms.couponBarrier) {
      coupon = terms.couponAmount + (config.memory === "yes" ? memoryBalance : 0);
      memoryBalance = 0;
      couponCash += coupon;
      couponStatus = coupon > terms.couponAmount ? "memory paid" : "paid";
    } else if (config.memory === "yes") {
      memoryBalance += terms.couponAmount;
      couponStatus = "banked";
    } else {
      couponStatus = "lost";
    }

    if (call) {
      active = false;
      calledIndex = index;
    }
    events.push({
      index,
      label: terms.observationLabels[index],
      a,
      b,
      reference,
      status: call ? "called" : "active",
      coupon,
      couponStatus,
      call,
      callEligible,
      memoryBalance,
    });
  }

  let principalCash = 0;
  let delivered = null;
  let settlementStatus = "";
  const finalA = scenario.A[scenario.A.length - 1];
  const finalB = scenario.B[scenario.B.length - 1];
  const finalReference = referenceLevel(finalA, finalB, config.referenceMeasure);

  if (calledIndex >= 0) {
    principalCash = terms.nominal;
    settlementStatus = `Autocalled at ${terms.observationLabels[calledIndex]}; principal repaid in cash.`;
  } else if (finalReference >= terms.protectionBarrier) {
    principalCash = terms.nominal;
    settlementStatus =
      "Reached maturity with protection condition satisfied; principal repaid in cash.";
  } else if (config.settlement === "cash") {
    principalCash = (terms.nominal * finalReference) / 100;
    settlementStatus = "Protection failed; downside value settled in cash.";
  } else {
    const asset = finalA <= finalB ? "A" : "B";
    delivered = {
      asset,
      units: terms.nominal / terms.initialLevels[asset],
      value: (terms.nominal * finalReference) / 100,
    };
    settlementStatus = `Protection failed; ${delivered.units.toFixed(2)} unit of Asset ${asset} is delivered.`;
  }

  const economicPrincipal = delivered ? delivered.value : principalCash;
  return {
    executable: true,
    readiness,
    events,
    calledIndex,
    couponCash,
    expiredMemory: memoryBalance,
    principalCash,
    delivered,
    economicPrincipal,
    totalCash: couponCash + principalCash,
    totalEconomic: couponCash + economicPrincipal,
    finalReference,
    settlementStatus,
  };
}

function normalizedRows(config) {
  const text = {
    unresolved: "UNRESOLVED",
    worst: "Minimum performance of Asset A and Asset B",
    average: "Arithmetic mean of Asset A and Asset B",
    gte: "Call when reference level ≥ scheduled trigger",
    gt: "Call when reference level > scheduled trigger",
    yes: "Missed coupons accumulate and pay on the next passing observation",
    no: "Missed coupons expire immediately",
    "coupon-first": "Coupon test, then autocall test",
    "call-first": "Autocall test; coupon only if the note remains active",
    "maturity-only": "Final date is maturity settlement, not an autocall observation",
    "final-call": "Final date tests autocall before maturity settlement",
    cash: "Cash-only downside settlement",
    physical: "Deliver worst-performing asset when protection fails",
  };
  return [
    ["PROD-01", "Product", "Two-asset step-down autocallable note; fictional; nominal 100"],
    ["OBS-01", "Observations", "Quarterly Q1, Q2, Q3 and Final; official closing levels"],
    ["REF-01", "Basket reference", text[config.referenceMeasure]],
    ["CAL-01", "Autocall", `${text[config.callComparison]}; schedule 100%, 95%, 90%, 85%`],
    ["CPN-01", "Coupon", `2.00 per observation when reference ≥ 70%; ${text[config.memory]}`],
    ["ORD-01", "Event order", text[config.eventOrder]],
    ["MAT-01", "Final convention", text[config.finalConvention]],
    ["SET-01", "Settlement", text[config.settlement]],
    ["STATE-01", "Persistent state", "ACTIVE / REDEEMED / MATURED; coupon memory balance"],
    [
      "TERM-01",
      "Termination",
      "After redemption, all later observations and cash-flow tests are inactive",
    ],
  ];
}

function acceptanceTests(config) {
  const unresolved = Object.values(config).includes("unresolved");
  const equalityResult =
    config.callComparison === "unresolved"
      ? "Pending operator decision"
      : config.callComparison === "gte"
        ? "Redeem"
        : "Remain active";
  const callCouponResult =
    config.eventOrder === "unresolved"
      ? "Pending event-order decision"
      : config.eventOrder === "coupon-first"
        ? "Pay coupon, then redeem"
        : "Redeem; do not pay current coupon";
  const memoryResult =
    config.memory === "unresolved"
      ? "Pending memory decision"
      : config.memory === "yes"
        ? "Bank 2.00"
        : "Lose 2.00";
  const finalResult =
    config.finalConvention === "unresolved"
      ? "Pending final-date decision"
      : config.finalConvention === "final-call"
        ? "Test 85% call before maturity"
        : "Proceed directly to maturity settlement";
  const downsideResult =
    config.settlement === "unresolved"
      ? "Pending settlement decision"
      : config.settlement === "cash"
        ? "Pay 59.99 cash principal"
        : config.referenceMeasure === "average"
          ? "BLOCKED: deliverable undefined"
          : "Deliver 1.00 unit of the worse asset";
  return [
    ["AT-01", "Exact call trigger", "Q2 reference = 95.00", equalityResult],
    ["AT-02", "Just below call trigger", "Q2 reference = 94.99", "Remain active"],
    [
      "AT-03",
      "Exact coupon barrier",
      "Reference = 70.00",
      "Pay current coupon and eligible memory",
    ],
    ["AT-04", "Just below coupon barrier", "Reference = 69.99", memoryResult],
    ["AT-05", "Coupon and call together", "Both tests pass on one active date", callCouponResult],
    [
      "AT-06",
      "Exact protection barrier",
      "Final reference = 60.00 and no prior call",
      "Repay 100 principal",
    ],
    [
      "AT-07",
      "Below protection barrier",
      "Final reference = 59.99 and no prior call",
      downsideResult,
    ],
    ["AT-08", "Final-date convention", "Final reference = 86.00", finalResult],
    [
      "AT-09",
      "Post-call event",
      "A prior observation already redeemed",
      "Ignore all later coupon and call tests",
    ],
    [
      "AT-10",
      "Basket divergence",
      "Asset A = 120; Asset B = 60",
      config.referenceMeasure === "unresolved"
        ? "Pending reference-measure decision"
        : config.referenceMeasure === "worst"
          ? "Reference = 60"
          : "Reference = 90",
    ],
  ].map((row) => ({
    id: row[0],
    title: row[1],
    given: row[2],
    expected: row[3],
    pending: unresolved && /Pending|BLOCKED/.test(row[3]),
  }));
}

export {
  terms,
  profiles,
  scenarios,
  choiceDefinitions,
  referenceLevel,
  comparisonPass,
  compile,
  evaluate,
  normalizedRows,
  acceptanceTests,
};
