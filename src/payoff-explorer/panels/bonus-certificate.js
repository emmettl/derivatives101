import { $, C, fmt, pct, rng, normals, frame, ticks, statCards } from "../core";
import { attachHorizontalInspector } from "../../shared/svg-interaction";

(function () {
  let obs = "cont",
    seed = 13579,
    selectedTerminal = 100,
    payoffContext = null;
  ["bn-l", "bn-b", "bn-t", "bn-v", "bn-q"].forEach((i) => ($(i).oninput = run));
  document.querySelectorAll("#bn-obs button").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelectorAll("#bn-obs button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        obs = b.dataset.v;
        run();
      }),
  );
  $("bn-run").onclick = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    run();
  };
  const payoffInspector = attachHorizontalInspector($("bn-pay"), () => {
    if (!payoffContext) return null;
    const { f, lo, hi, bar, bonus } = payoffContext;
    return {
      width: 760,
      left: f.m.l,
      right: f.m.r,
      top: f.m.t,
      bottom: 320 - f.m.b,
      minimum: lo,
      maximum: hi,
      step: 1,
      value: selectedTerminal,
      label:
        "Bonus certificate payoff diagram. Hover to compare barrier states; click or drag to pin a terminal level.",
      inspect: (spot) => {
        const breached = spot;
        const intact = spot >= bonus ? spot : bonus;
        return {
          title: `Terminal underlying ${spot.toFixed(0)}%`,
          rows: [
            { label: "Barrier intact", value: fmt(intact, 2), color: C.jade },
            { label: "Barrier breached", value: fmt(breached, 2), color: C.brick },
            { label: "Barrier level", value: `${bar.toFixed(0)}%` },
          ],
          points: [
            { y: f.Y(intact), color: C.jade },
            ...(Math.abs(intact - breached) > 0.01 ? [{ y: f.Y(breached), color: C.brick }] : []),
          ],
        };
      },
      onSelect: (spot) => {
        selectedTerminal = spot;
      },
    };
  });

  function run() {
    const bonus = +$("bn-l").value,
      bar = +$("bn-b").value,
      months = +$("bn-t").value,
      vol = +$("bn-v").value / 100,
      q0 = +$("bn-q").value / 100;
    $("bn-l-v").textContent = bonus + "%";
    $("bn-b-v").textContent = bar + "%";
    $("bn-t-v").textContent = months;
    $("bn-v-v").textContent = (vol * 100).toFixed(0) + "%";
    $("bn-q-v").textContent = fmt(q0 * 100, 2) + "%";
    const T = months / 12;

    const lo = 20,
      hi = Math.max(170, bonus + 40);
    const f = frame($("bn-pay"), {
      H: 320,
      xr: [lo, hi],
      yr: [0, hi],
      xticks: ticks(lo, hi, 6),
      xfmt: (v) => v.toFixed(0),
      yticks: ticks(0, hi, 5),
      yfmt: (v) => v.toFixed(0),
      xlab: "Underlying at maturity, % of spot at issue",
    });
    f.line(
      [
        [lo, lo],
        [hi, hi],
      ],
      C.line,
      1.8,
      "5 4",
    );
    f.rect(lo, bar, C.brick, 0.07);
    f.vline(bar, C.brick);
    f.vline(bonus, C.jade);
    f.line(
      [
        [bar, bonus],
        [bonus, bonus],
      ],
      C.jade,
      3.2,
    );
    f.line(
      [
        [bonus, bonus],
        [hi, hi],
      ],
      C.jade,
      3.2,
    );
    f.line(
      [
        [lo, lo],
        [bar, bar],
      ],
      C.brick,
      2.4,
      "3 3",
    );
    f.dot(bar, bonus, C.jade);
    f.text(bar, hi * 0.96, "barrier " + bar, C.brick, 10.5);
    f.text(bonus, hi * 0.05, "bonus " + bonus, C.jade, 10.5);
    f.text(Math.min(hi - 16, (bar + bonus) / 2), bonus + hi * 0.07, "bonus paid", C.jade, 10.5);
    payoffContext = { f, lo, hi, bar, bonus };
    selectedTerminal = Math.max(lo, Math.min(hi, selectedTerminal));
    payoffInspector.refresh();

    /* Monte Carlo — price process is ex-dividend, so the certificate never receives q */
    const paths = 2000,
      r = rng(seed),
      steps = Math.max(1, Math.round(21 * months)),
      dt = 1 / 252,
      sd = vol * Math.sqrt(dt);
    const rets = [];
    let broke = 0,
      bonusPaid = 0,
      above = 0,
      beat = 0,
      sum = 0,
      sumDir = 0;
    for (let i = 0; i < paths; i++) {
      let S = 100,
        mn = 100,
        z = [],
        zi = 2;
      for (let d = 1; d <= steps; d++) {
        if (zi > 1) {
          z = normals(r);
          zi = 0;
        }
        S *= Math.exp(-0.5 * sd * sd + sd * z[zi++]);
        if (S < mn) mn = S;
      }
      const hit = obs === "cont" ? mn <= bar : S <= bar;
      let red;
      if (hit) {
        red = S;
        broke++;
      } else if (S >= bonus) {
        red = S;
        above++;
      } else {
        red = bonus;
        bonusPaid++;
      }
      const ret = red - 100;
      const dir = S - 100 + 100 * (Math.exp(q0 * T) - 1); // direct holding keeps the dividends
      rets.push(ret);
      sum += ret;
      sumDir += dir;
      if (ret > dir) beat++;
    }
    rets.sort((a, b) => a - b);
    statCards($("bn-stats"), [
      { v: pct(broke / paths, 0), l: "barrier breached", c: C.brick },
      { v: pct(bonusPaid / paths, 0), l: "bonus paid", c: C.amberD },
      { v: pct(above / paths, 0), l: "participated above the bonus", c: C.jade },
      { v: pct(beat / paths, 0), l: "beat the share, dividends included", c: C.deep },
      { v: fmt(sum / paths, 1), l: "average return per 100", c: C.ink },
    ]);

    const budget = 100 * (1 - Math.exp(-q0 * T));
    $("bn-terms").innerHTML =
      "<tr><td>Bonus if the barrier holds</td><td>" +
      fmt(bonus - 100, 1) +
      "%</td></tr>" +
      "<tr><td>Buffer to the barrier</td><td>" +
      fmt(100 - bar, 1) +
      " points</td></tr>" +
      "<tr><td>Dividends forgone over the term</td><td>" +
      fmt(budget, 2) +
      " points</td></tr>" +
      "<tr><td>Average return on the share</td><td>" +
      fmt(sumDir / paths, 1) +
      "</td></tr>";
    $("bn-read").innerHTML =
      "The dividends the client gives up over " +
      months +
      " months are worth about <b>" +
      fmt(budget, 1) +
      " points</b> — that is the entire budget available to buy the down-and-out put, and therefore the bonus. " +
      "Set the dividend slider to zero and you can see the problem: with no budget there is nothing to fund a bonus with. " +
      "In these markets the barrier was breached <b>" +
      pct(broke / paths, 0) +
      "</b> of the time" +
      (obs === "cont"
        ? " on continuous observation. Switch to a maturity-only barrier and watch that number fall sharply for the same headline level."
        : " on a maturity-only test. Switch to continuous observation to see how much harder the listed European convention is.") +
      " The certificate beat a direct holding including dividends <b>" +
      pct(beat / paths, 0) +
      "</b> of the time.";
  }
  run();
})();
