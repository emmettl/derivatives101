"use strict";

export const clauses = [
  {
    id: "BAR-01",
    category: "Barrier state",
    severity: "Outcome-changing",
    title: "Does an exact barrier touch count?",
    quote:
      "A Barrier Event occurs if the Underlying closes below 60% of its Initial Level during the Observation Period.",
    problem:
      "“Below” could mean strictly less than the barrier, while traders and documents often use an inclusive comparison. At exactly 60, the two implementations disagree.",
    options: [
      {
        label: "At or below 60%",
        tag: "Illustrative convention",
        rule: "On every scheduled trading day while the note is ACTIVE, set barrierBreached = true when officialClose ≤ 60. Once true, it never returns to false.",
        impact:
          "An exact close of 60 records a breach. With a final level of 80, the investor receives the downside settlement rather than par.",
      },
      {
        label: "Strictly below 60%",
        tag: "Alternative",
        rule: "On every scheduled trading day while the note is ACTIVE, set barrierBreached = true only when officialClose < 60. Once true, it never returns to false.",
        impact:
          "An exact close of 60 does not record a breach. If the final level is 80, the barrier remains intact and par is repaid.",
      },
    ],
  },
  {
    id: "ORD-01",
    category: "Event ordering",
    severity: "Cash-flow-changing",
    title: "Is the coupon evaluated before the autocall?",
    quote:
      "If the Underlying is at or above 100% on an Observation Date, the Note redeems early. A coupon is payable when the Underlying is at or above 70%.",
    problem:
      "Both tests can pass on the same date. The draft does not say whether the investor earns that date’s coupon before the note terminates.",
    options: [
      {
        label: "Coupon, then autocall",
        tag: "Illustrative convention",
        rule: "For an eligible active observation: update barrier state; evaluate and book the coupon; then evaluate the autocall. A successful call pays principal plus all coupon cash booked for that observation.",
        impact:
          "At a level of 105, the fourth observation pays 1,000 principal plus the 20 current coupon, then changes noteState to REDEEMED.",
      },
      {
        label: "Autocall, then coupon only if active",
        tag: "Alternative",
        rule: "For an eligible active observation: update barrier state; evaluate the autocall; evaluate the coupon only if noteState remains ACTIVE after the call test.",
        impact:
          "At a level of 105, the fourth observation redeems at 1,000 before the current 20 coupon is evaluated.",
      },
    ],
  },
  {
    id: "DIS-01",
    category: "Market data & calendars",
    severity: "Lifecycle-changing",
    title: "What replaces a disrupted fixing?",
    quote:
      "If an Observation Date is disrupted, the Calculation Agent will determine the relevant level in accordance with market practice.",
    problem:
      "“Market practice” is not an algorithm. The rule needs a valid data source, a postponement window and a deterministic fallback when no official close becomes available.",
    options: [
      {
        label: "Postpone, then estimate",
        tag: "Illustrative convention",
        rule: "Move the observation to the next scheduled trading day with an official close, up to eight such days. If none is valid, use the calculation agent’s good-faith estimate for the eighth day and retain an audit flag.",
        impact:
          "If the scheduled close is unavailable and the next valid close is 102, use 102. The call test passes.",
      },
      {
        label: "Use the preceding valid close",
        tag: "Alternative",
        rule: "If the scheduled observation has no official close, use the most recent preceding scheduled trading day with a valid official close and retain an audit flag.",
        impact:
          "If the preceding valid close is 98 and the next day closes at 102, use 98. The call test fails and the note remains active.",
      },
    ],
  },
  {
    id: "MEM-01",
    category: "Coupon state",
    severity: "Cash-flow-changing",
    title: "What happens to memory when the note calls?",
    quote:
      "Unpaid coupons are carried forward and may be paid on a subsequent Observation Date on which the Coupon Condition is satisfied.",
    problem:
      "The call date may be the final opportunity to satisfy the coupon condition. The draft does not expressly include or exclude the accumulated memory amount in the call payment.",
    options: [
      {
        label: "Pay current coupon and memory",
        tag: "Illustrative convention",
        rule: "When officialClose ≥ 70, couponCash = 20 + memoryBalance and memoryBalance = 0. Apply this rule before any same-date autocall payment.",
        impact:
          "With 40 of memory and a passing coupon/call level, the observation books 60 of coupon cash before principal is repaid.",
      },
      {
        label: "Pay current coupon only on call",
        tag: "Alternative",
        rule: "When the coupon and call tests both pass, couponCash = 20 and any memoryBalance is cancelled on redemption. On a non-call passing observation, pay 20 + memoryBalance.",
        impact:
          "With 40 of memory on a call date, only the current 20 coupon is paid; the 40 balance is forfeited.",
      },
    ],
  },
  {
    id: "SET-01",
    category: "Maturity settlement",
    severity: "Delivery-changing",
    title: "Does downside settle in cash or shares?",
    quote:
      "If a Barrier Event has occurred and the Final Level is below the Strike, the investor bears the Underlying’s decline.",
    problem:
      "The economics alone do not identify the settlement asset, delivery ratio, fractional-unit treatment, payment date or rounding precision.",
    options: [
      {
        label: "Physical delivery plus cash-in-lieu",
        tag: "Illustrative convention",
        rule: "If ACTIVE at maturity, barrierBreached is true and finalLevel < strike: entitlement = nominal ÷ strike. Deliver whole units; pay the fractional entitlement in cash at finalLevel, rounded to two currency decimals.",
        impact:
          "For 1,000 nominal, strike 99 and final 80: deliver 10 units and pay 8.08 cash-in-lieu. Total value is 808.08.",
      },
      {
        label: "Cash settlement",
        tag: "Alternative",
        rule: "If ACTIVE at maturity, barrierBreached is true and finalLevel < strike: pay nominal × finalLevel ÷ strike in cash, rounded to two currency decimals. Deliver no units.",
        impact: "For 1,000 nominal, strike 99 and final 80: pay 808.08 cash and deliver no units.",
      },
    ],
  },
];
