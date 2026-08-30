import { $, C, el, fmt, pct, rng, normals, frame, ticks, statCards, histogram } from "../core";

(function () {
  let dir = "acc",
    seed = 12345;
  const ids = ["ac-k", "ac-b", "ac-g", "ac-n", "ac-v", "ac-m"];
  document.querySelectorAll("#ac-dir button").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelectorAll("#ac-dir button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        dir = b.dataset.v;
        // flip sensible defaults when switching direction
        if (dir === "dec") {
          $("ac-k").value = 112;
          $("ac-b").value = 97;
        } else {
          $("ac-k").value = 88;
          $("ac-b").value = 103;
        }
        run();
      }),
  );
  ids.forEach((i) => ($(i).oninput = run));
  $("ac-run").onclick = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    run();
  };

  function run() {
    const k = +$("ac-k").value,
      b = +$("ac-b").value,
      g = +$("ac-g").value,
      n = +$("ac-n").value,
      vol = +$("ac-v").value / 100,
      mgn = +$("ac-m").value / 100;
    $("ac-k-v").textContent = k + "%";
    $("ac-b-v").textContent = b + "%";
    $("ac-g-v").textContent = fmt(g, 1) + "×";
    $("ac-n-v").textContent = n;
    $("ac-v-v").textContent = (vol * 100).toFixed(0) + "%";
    $("ac-m-v").textContent = (mgn * 100).toFixed(0) + "%";
    const isAcc = dir === "acc";
    const maxNotional = n * g * k; // per 1 share/day base quantity, spot = 100
    const margin = maxNotional * mgn;

    /* ---- single-day payoff ---- */
    const lo = Math.max(20, Math.min(k, b) - 45),
      hi = Math.max(k, b) + 30;
    const dayPnl = (s) =>
      isAcc ? (s >= k ? 1 * (s - k) : g * (s - k)) : s <= k ? 1 * (k - s) : g * (k - s);
    const ys = [dayPnl(lo), dayPnl(hi), 0];
    const ylo = Math.min.apply(null, ys) * 1.15 - 2,
      yhi = Math.max.apply(null, ys) * 1.35 + 2;
    const f = frame($("ac-day"), {
      H: 300,
      xr: [lo, hi],
      yr: [ylo, yhi],
      xticks: ticks(lo, hi, 6),
      xfmt: (v) => v.toFixed(0),
      yticks: ticks(ylo, yhi, 4),
      yfmt: (v) => v.toFixed(0),
      xlab: "Closing price of the underlying on one observation day (spot = 100)",
    });
    $("ac-day").appendChild(
      el(
        "text",
        { x: 62, y: 14, "font-size": 12, "font-weight": 700, fill: C.ink },
        "Client P&L on a single day, per 1 unit of base daily quantity",
      ),
    );
    if (isAcc) {
      f.rect(lo, k, C.brick, 0.07);
    } else {
      f.rect(k, hi, C.brick, 0.07);
    }
    f.hline(0, C.muted, "2 3");
    f.vline(k, C.steel);
    f.vline(b, C.jade);
    if (isAcc) {
      f.line(
        [
          [lo, dayPnl(lo)],
          [k, 0],
        ],
        C.brick,
        3.2,
      );
      f.line(
        [
          [k, 0],
          [b, dayPnl(b)],
        ],
        C.jade,
        3.2,
      );
      f.dot(b, dayPnl(b), C.jade);
    } else {
      f.line(
        [
          [b, dayPnl(b)],
          [k, 0],
        ],
        C.jade,
        3.2,
      );
      f.line(
        [
          [k, 0],
          [hi, dayPnl(hi)],
        ],
        C.brick,
        3.2,
      );
      f.dot(b, dayPnl(b), C.jade);
    }
    f.text(k, ylo + (yhi - ylo) * 0.06, "strike " + k, C.steel, 11);
    f.text(b, yhi - (yhi - ylo) * 0.05, "knock-out " + b, C.jade, 11);

    /* ---- Monte Carlo ---- */
    const paths = 2000,
      r = rng(seed),
      dt = 1 / 252,
      sd = vol * Math.sqrt(dt);
    const rets = [],
      lives = [];
    let ko = 0,
      loss = 0,
      sumR = 0;
    for (let i = 0; i < paths; i++) {
      let S = 100,
        shares = 0,
        cost = 0,
        day = 0,
        alive = true;
      let z = [],
        zi = 2;
      for (day = 1; day <= n; day++) {
        if (zi > 1) {
          z = normals(r);
          zi = 0;
        }
        S *= Math.exp(-0.5 * sd * sd + sd * z[zi++]);
        const q = isAcc ? (S >= k ? 1 : g) : S <= k ? 1 : g;
        shares += q;
        cost += q * k;
        const hit = isAcc ? S >= b : S <= b;
        if (hit && day >= 20) {
          alive = false;
          break;
        }
      }
      if (!alive) ko++;
      const dayCount = day > n ? n : day;
      const pnl = isAcc ? shares * S - cost : cost - shares * S;
      const ret = pnl / margin;
      rets.push(ret);
      lives.push(dayCount);
      sumR += ret;
      if (pnl < 0) loss++;
    }
    rets.sort((a, b2) => a - b2);
    const q = (p) => rets[Math.min(rets.length - 1, Math.floor(p * rets.length))];
    const meanLife = lives.reduce((a, b2) => a + b2, 0) / paths;
    statCards($("ac-stats"), [
      { v: pct(ko / paths, 0), l: "knocked out early", c: C.jade },
      { v: pct(loss / paths, 0), l: "ended in a loss", c: C.brick },
      { v: pct(sumR / paths, 1), l: "average return on margin", c: C.ink },
      { v: pct(q(0.05), 0), l: "5th percentile return", c: C.brick },
      { v: Math.round(meanLife) + " d", l: "average life", c: C.deep },
    ]);
    const lo2 = Math.max(-4, q(0.002) - 0.1),
      hi2 = Math.min(3, q(0.998) + 0.1);
    histogram($("ac-hist"), rets, {
      lo: lo2,
      hi: hi2,
      split: 0,
      bins: 36,
      xfmt: (v) => Math.round(v * 100) + "%",
      xlab: "Return on initial margin over the life of the contract",
      title: "Distribution of outcomes across 2,000 simulated markets",
    });
    $("ac-terms").innerHTML =
      "<tr><td>Max notional, 1,000 shares/day</td><td>" +
      fmt((maxNotional * 1000) / 1e6, 1) +
      "m</td></tr>" +
      "<tr><td>Initial margin posted</td><td>" +
      fmt((margin * 1000) / 1e6, 1) +
      "m</td></tr>" +
      "<tr><td>Effective leverage</td><td>" +
      fmt(1 / mgn, 1) +
      "×</td></tr>" +
      "<tr><td>Best single day</td><td>" +
      fmt(Math.abs(b - k), 1) +
      " points</td></tr>";
    $("ac-read").innerHTML =
      "The client can make at most about <b>" +
      fmt(Math.abs(b - k), 0) +
      " points</b> on any one day and the trade " +
      "then ends, but there is no matching floor on the other side: at " +
      fmt(g, 1) +
      "× gearing the position keeps " +
      "growing precisely while it is losing. In these " +
      paths.toLocaleString() +
      " markets the contract " +
      (ko / paths > 0.5 ? "usually" : "often") +
      " knocked out early — average life <b>" +
      Math.round(meanLife) +
      " of " +
      n +
      " days</b> — yet the worst 5% of markets lost <b>" +
      pct(Math.abs(q(0.05)), 0) +
      "</b> of the margin posted.";
  }
  run();
})();
