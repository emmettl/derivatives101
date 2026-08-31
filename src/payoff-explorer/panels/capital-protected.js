import { $, C, fmt, bsCall, frame, ticks, statCards } from "../core";
import { attachHorizontalInspector } from "../../shared/svg-interaction";

(function () {
  let capped = false,
    selectedTerminal = 100,
    rateContext = null,
    payoffContext = null;
  ["cp-r", "cp-t", "cp-pr", "cp-v", "cp-q", "cp-f"].forEach((i) => ($(i).oninput = run));
  document.querySelectorAll("#cp-cap button").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelectorAll("#cp-cap button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        capped = b.dataset.v === "yes";
        run();
      }),
  );

  const CAPLVL = 140;
  function build(rate, T, prot, vol, q, fee) {
    const floor = prot / Math.pow(1 + rate, T);
    const budget = 100 - floor - fee;
    const rc = Math.log(1 + rate);
    const callCost = capped
      ? bsCall(100, 100, T, rc, q, vol) - bsCall(100, CAPLVL, T, rc, q, vol)
      : bsCall(100, 100, T, rc, q, vol);
    const part = budget > 0 && callCost > 0 ? budget / callCost : 0;
    return { floor, budget, callCost, part };
  }

  const rateInspector = attachHorizontalInspector($("cp-curve"), () => {
    if (!rateContext) return null;
    const { f, T, prot, vol, q, fee } = rateContext;
    return {
      width: 760,
      left: f.m.l,
      right: f.m.r,
      top: f.m.t,
      bottom: 300 - f.m.b,
      minimum: -1,
      maximum: 8,
      step: 0.1,
      value: +$("cp-r").value / 100,
      label: "Participation across issuer funding rates. Click or drag to set the funding rate.",
      inspect: (ratePercent) => {
        const terms = build(ratePercent / 100, T, prot, vol, q, fee);
        const participation = Math.min(3, terms.part);
        return {
          title: `Funding rate ${ratePercent.toFixed(2)}%`,
          rows: [
            {
              label: "Participation",
              value: terms.part > 0 ? `${terms.part.toFixed(2)}×` : "Unbuildable",
              color: terms.part > 0 ? C.jade : C.brick,
            },
            { label: "Option budget", value: fmt(terms.budget, 2) },
            { label: "Floor cost", value: fmt(terms.floor, 2) },
          ],
          points: [{ y: f.Y(participation), color: terms.part > 0 ? C.jade : C.brick }],
        };
      },
      onSelect: (ratePercent) => {
        $("cp-r").value = Math.round(ratePercent * 100);
        run();
      },
    };
  });
  const payoffInspector = attachHorizontalInspector($("cp-pay"), () => {
    if (!payoffContext) return null;
    const { f, hi, pay, prot, part } = payoffContext;
    return {
      width: 760,
      left: f.m.l,
      right: f.m.r,
      top: f.m.t,
      bottom: 280 - f.m.b,
      minimum: 0,
      maximum: hi,
      step: 1,
      value: selectedTerminal,
      label:
        "Capital-protected payoff diagram. Hover to inspect; click or drag to pin a terminal level.",
      inspect: (spot) => {
        const redemption = pay(spot);
        return {
          title: `Terminal underlying ${spot.toFixed(0)}%`,
          rows: [
            { label: "Redemption", value: fmt(redemption, 2), color: C.jade },
            { label: "Protection floor", value: fmt(prot, 2) },
            { label: "Participation", value: part > 0 ? `${part.toFixed(2)}×` : "Unbuildable" },
          ],
          points: [{ y: f.Y(redemption), color: C.jade }],
        };
      },
      onSelect: (spot) => {
        selectedTerminal = spot;
      },
    };
  });

  function run() {
    const rate = +$("cp-r").value / 10000,
      T = +$("cp-t").value,
      prot = +$("cp-pr").value,
      vol = +$("cp-v").value / 100,
      q = +$("cp-q").value / 100,
      fee = +$("cp-f").value;
    $("cp-r-v").textContent = fmt(rate * 100, 2) + "%";
    $("cp-t-v").textContent = T;
    $("cp-pr-v").textContent = prot + "%";
    $("cp-v-v").textContent = (vol * 100).toFixed(0) + "%";
    $("cp-q-v").textContent = fmt(q * 100, 2) + "%";
    $("cp-f-v").textContent = fmt(fee, 2) + "%";

    const B = build(rate, T, prot, vol, q, fee);
    const bondAlt = (Math.pow(1 + rate, T) - 1) * 100;
    statCards($("cp-stats"), [
      { v: fmt(B.floor, 1), l: "cost of the bond floor", c: C.deep },
      { v: fmt(B.budget, 1), l: "points left to buy options", c: B.budget > 0 ? C.amber : C.brick },
      { v: fmt(B.callCost, 1), l: "cost of the call" + (capped ? " spread" : ""), c: C.steel },
      {
        v: B.part > 0 ? fmt(B.part, 2) + "×" : "unbuildable",
        l: "participation rate",
        c: B.part > 0 ? C.jade : C.brick,
      },
      { v: fmt(bondAlt, 1) + "%", l: "a plain bond would return", c: C.ink },
    ]);

    /* participation vs rate curve */
    const pts = [];
    for (let bp = -100; bp <= 800; bp += 25) {
      const rr = bp / 10000,
        b = build(rr, T, prot, vol, q, fee);
      pts.push([bp / 100, Math.min(3, b.part)]);
    }
    const f = frame($("cp-curve"), {
      H: 300,
      xr: [-1, 8],
      yr: [0, 3],
      xticks: [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8],
      xfmt: (v) => v + "%",
      yticks: [0, 0.5, 1, 1.5, 2, 2.5, 3],
      yfmt: (v) => v.toFixed(1) + "×",
      xlab: "Issuer funding rate",
    });
    f.rect(-1, 0, C.brick, 0.1);
    f.line(pts, C.amber, 3);
    f.hline(1, C.line, "4 4");
    f.dot(rate * 100, Math.min(3, B.part), C.ink);
    f.text(-0.4, 2.72, "unbuildable", C.brick, 10.5);
    f.text(6.4, 1.12, "1:1 participation", C.muted, 10.5);
    rateContext = { f, T, prot, vol, q, fee };
    rateInspector.refresh();

    /* payoff */
    const hi = 200;
    const f2 = frame($("cp-pay"), {
      H: 280,
      xr: [0, hi],
      yr: [Math.min(60, prot - 10), Math.max(180, prot + 80)],
      xticks: [0, 25, 50, 75, 100, 125, 150, 175, 200],
      xfmt: (v) => v + "%",
      yticks: ticks(Math.min(60, prot - 10), Math.max(180, prot + 80), 4),
      yfmt: (v) => v.toFixed(0),
      xlab: "Underlying at maturity, % of initial",
    });
    const pay = (S) => {
      const up = Math.max(S - 100, 0);
      const capped2 = capped ? Math.min(up, CAPLVL - 100) : up;
      return prot + B.part * capped2;
    };
    f2.hline(100, C.muted, "2 3");
    f2.line(
      [
        [0, pay(0)],
        [100, pay(100)],
        [hi, pay(hi)],
      ],
      C.jade,
      3.2,
    );
    f2.line(
      [
        [0, 0],
        [hi, hi],
      ],
      C.line,
      1.6,
      "5 4",
    );
    f2.vline(100, C.line);
    f2.text(30, prot + 10, "floor at " + prot, C.jade, 10.5);
    payoffContext = { f: f2, hi, pay, prot, part: B.part };
    payoffInspector.refresh();

    $("cp-terms").innerHTML =
      "<tr><td>Bond floor</td><td>" +
      fmt(B.floor, 2) +
      "</td></tr>" +
      "<tr><td>Fees</td><td>" +
      fmt(fee, 2) +
      "</td></tr>" +
      "<tr><td>Option budget</td><td>" +
      fmt(B.budget, 2) +
      "</td></tr>" +
      "<tr><td>Participation</td><td>" +
      (B.part > 0 ? fmt(B.part, 2) + "×" : "—") +
      "</td></tr>";

    const breakeven = B.part > 0 ? 100 + (100 - prot) / B.part : null;
    $("cp-read").innerHTML =
      B.budget <= 0
        ? "<b>There is no product here.</b> At " +
          fmt(rate * 100, 2) +
          "% over " +
          T +
          " years the floor alone costs " +
          fmt(B.floor, 1) +
          " points, and after " +
          fmt(fee, 1) +
          " points of fees the option budget is <b>" +
          fmt(B.budget, 1) +
          "</b>. This is not an expensive note — it is an unbuildable one, and it is why the family effectively vanished from 2015 to 2021."
        : "At " +
          fmt(rate * 100, 2) +
          "% the floor costs <b>" +
          fmt(B.floor, 1) +
          "</b>, leaving <b>" +
          fmt(B.budget, 1) +
          "</b> points after fees. That buys <b>" +
          fmt(B.part, 2) +
          "×</b> participation. " +
          "The client needs the underlying above <b>" +
          fmt(breakeven, 1) +
          "%</b> just to get their money back in nominal terms — while the issuer's own bond would have returned <b>" +
          fmt(bondAlt, 1) +
          "%</b> with certainty. " +
          "Push the fee slider and watch the participation fall while the protection never moves: fees come out of the upside, not the floor.";
  }
  run();
})();
