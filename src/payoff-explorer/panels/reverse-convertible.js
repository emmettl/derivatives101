import { $, C, el, fmt, pct, rng, normals, frame, ticks, statCards, histogram } from "../core";
import { attachHorizontalInspector } from "../../shared/svg-interaction";

(function () {
  let obs = "eu",
    seed = 987654,
    selectedTerminal = 100,
    payoffContext = null;
  const ids = ["rc-c", "rc-b", "rc-a", "rc-t", "rc-f", "rc-v"];
  document.querySelectorAll("#rc-obs button").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelectorAll("#rc-obs button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        obs = b.dataset.v;
        run();
      }),
  );
  ids.forEach((i) => ($(i).oninput = run));
  $("rc-run").onclick = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    run();
  };
  const payoffInspector = attachHorizontalInspector($("rc-pay"), () => {
    if (!payoffContext) return null;
    const { f, bar, totCpn } = payoffContext;
    const redemption = (spot) =>
      bar > 0 ? (spot < bar ? spot + totCpn : 100 + totCpn) : Math.min(spot, 100) + totCpn;
    return {
      width: 760,
      left: f.m.l,
      right: f.m.r,
      top: f.m.t,
      bottom: 300 - f.m.b,
      minimum: 0,
      maximum: 150,
      step: 1,
      value: selectedTerminal,
      label:
        "Reverse convertible redemption diagram. Hover to inspect; click or drag to pin a terminal level.",
      inspect: (spot) => {
        const value = redemption(spot);
        const downside = bar > 0 && spot < bar;
        return {
          title: `Terminal underlying ${spot.toFixed(0)}%`,
          rows: [
            { label: "Redemption", value: fmt(value, 2), color: downside ? C.brick : C.jade },
            { label: "Displayed state", value: downside ? "Downside branch" : "Principal repaid" },
            { label: "Coupons", value: fmt(totCpn, 2) },
          ],
          points: [{ y: f.Y(value), color: downside ? C.brick : C.jade }],
        };
      },
      onSelect: (spot) => {
        selectedTerminal = spot;
      },
    };
  });

  function run() {
    const cpn = +$("rc-c").value / 100,
      bar = +$("rc-b").value,
      ac = +$("rc-a").value,
      T = +$("rc-t").value,
      fq = +$("rc-f").value,
      vol = +$("rc-v").value / 100;
    $("rc-c-v").textContent = fmt(cpn * 100, 1) + "%";
    $("rc-b-v").textContent = bar + "%";
    $("rc-a-v").textContent = ac + "%";
    $("rc-t-v").textContent = T;
    $("rc-f-v").textContent = fq;
    $("rc-v-v").textContent = (vol * 100).toFixed(0) + "%";

    /* payoff at maturity, assuming the barrier has been breached */
    const totCpn = cpn * T * 100;
    const f = frame($("rc-pay"), {
      H: 300,
      xr: [0, 150],
      yr: [-5, Math.max(140, 110 + totCpn)],
      xticks: [0, 25, 50, 75, 100, 125, 150],
      xfmt: (v) => v + "%",
      yticks: ticks(0, Math.max(140, 110 + totCpn), 4),
      yfmt: (v) => v.toFixed(0),
      xlab: "Level of the underlying at maturity, % of initial",
    });
    $("rc-pay").appendChild(
      el(
        "text",
        { x: 62, y: 14, "font-size": 12, "font-weight": 700, fill: C.ink },
        "Redemption value per 100 invested, if held to maturity",
      ),
    );
    f.rect(0, bar, C.brick, 0.07);
    f.hline(100, C.muted, "2 3");
    if (bar > 0) {
      f.line(
        [
          [0, totCpn],
          [bar, bar + totCpn],
        ],
        C.brick,
        3.2,
      );
      f.line(
        [
          [bar, 100 + totCpn],
          [150, 100 + totCpn],
        ],
        C.jade,
        3.2,
      );
      f.dot(bar, 100 + totCpn, C.jade);
      f.dot(bar, bar + totCpn, C.brick);
      f.vline(bar, C.brick);
      f.text(Math.min(142, bar + 13), -3, "barrier " + bar + "%", C.brick, 11);
      if (100 - bar > 6)
        f.text(
          Math.min(138, bar + 24),
          (bar + 100) / 2 + totCpn,
          "cliff of " + fmt(100 - bar, 0) + " points",
          C.brick,
          11,
          "start",
        );
    } else {
      f.line(
        [
          [0, totCpn],
          [100, 100 + totCpn],
        ],
        C.brick,
        3.2,
      );
      f.line(
        [
          [100, 100 + totCpn],
          [150, 100 + totCpn],
        ],
        C.jade,
        3.2,
      );
    }
    f.text(125, 100 + totCpn + 8, "par + " + fmt(totCpn, 0) + " of coupons", C.jade, 11);
    payoffContext = { f, bar, totCpn };
    payoffInspector.refresh();

    /* Monte Carlo */
    const paths = 2000,
      r = rng(seed),
      steps = Math.round(252 * T),
      dt = 1 / 252,
      sd = vol * Math.sqrt(dt);
    const obsEvery = Math.max(1, Math.round(252 / fq));
    const rets = [];
    let called = 0,
      lost = 0,
      ki = 0,
      sum = 0,
      lifeSum = 0;
    for (let i = 0; i < paths; i++) {
      let S = 100,
        minS = 100,
        z = [],
        zi = 2,
        done = false,
        ret = 0,
        life = T;
      for (let d = 1; d <= steps; d++) {
        if (zi > 1) {
          z = normals(r);
          zi = 0;
        }
        S *= Math.exp(-0.5 * sd * sd + sd * z[zi++]);
        if (S < minS) minS = S;
        if (d % obsEvery === 0 && d >= obsEvery && d < steps) {
          if (S >= ac) {
            ret = cpn * (d / 252) * 100;
            life = d / 252;
            called++;
            done = true;
            break;
          }
        }
      }
      if (!done) {
        const breached = obs === "am" ? minS < bar : S < bar;
        const c = cpn * T * 100;
        ret = breached && S < 100 ? S - 100 + c : c;
        if (breached) ki++;
        life = T;
      }
      if (ret < 0) lost++;
      rets.push(ret);
      sum += ret;
      lifeSum += life;
    }
    rets.sort((a, b2) => a - b2);
    const q = (p) => rets[Math.min(rets.length - 1, Math.floor(p * rets.length))];
    statCards($("rc-stats"), [
      { v: pct(called / paths, 0), l: "autocalled before maturity", c: C.jade },
      { v: pct(ki / paths, 0), l: "knocked in", c: C.amberD },
      { v: pct(lost / paths, 0), l: "lost money", c: C.brick },
      { v: fmt(sum / paths, 1), l: "average return per 100", c: C.ink },
      { v: fmt(lifeSum / paths, 1) + " yr", l: "average life vs " + T + " yr tenor", c: C.deep },
    ]);
    const lo = Math.max(-100, q(0.002) - 4),
      hi = Math.min(120, q(0.999) + 4);
    histogram($("rc-hist"), rets, {
      lo: lo,
      hi: hi,
      split: 0,
      bins: 38,
      xfmt: (v) => v.toFixed(0),
      xlab: "Total return per 100 invested",
      title: "Distribution of outcomes across 2,000 simulated markets",
    });
    $("rc-read").innerHTML =
      "The note pays <b>" +
      fmt(cpn * 100, 1) +
      "% a year</b>, but in these markets it lived on average <b>" +
      fmt(lifeSum / paths, 1) +
      " years</b> against a " +
      T +
      "-year tenor — a rally redeems it early and the coupons stop. " +
      "It lost money <b>" +
      pct(lost / paths, 0) +
      "</b> of the time, and when it did the loss was severe: the 5th " +
      "percentile outcome is <b>" +
      fmt(q(0.05), 0) +
      " per 100</b>. " +
      (obs === "am"
        ? "With a daily-observed barrier the client is exposed to the low of the whole period, not just the last day."
        : "With a maturity-only barrier a mid-life crash is forgiven if the market recovers — try switching to a daily barrier.");
  }
  run();
})();
