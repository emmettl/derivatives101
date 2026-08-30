import { $, C, fmt, pct, rng, normals, frame, ticks, statCards } from "../core";

(function () {
  let dir = "long",
    seed = 97531;
  ["mf-f", "mf-s", "mf-r", "mf-fs", "mf-d", "mf-v"].forEach((i) => ($(i).oninput = run));
  document.querySelectorAll("#mf-dir button").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelectorAll("#mf-dir button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        dir = b.dataset.v;
        $("mf-f").value = dir === "long" ? 90 : 110;
        run();
      }),
  );
  $("mf-run").onclick = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    run();
  };

  function run() {
    const FL0 = +$("mf-f").value,
      buf = +$("mf-s").value / 10 / 100,
      rate = +$("mf-r").value / 10000,
      fs = +$("mf-fs").value / 10000,
      days = +$("mf-d").value,
      vol = +$("mf-v").value / 100;
    $("mf-f-v").textContent = FL0;
    $("mf-s-v").textContent = fmt(buf * 100, 1) + "%";
    $("mf-r-v").textContent = fmt(rate * 100, 1) + "%";
    $("mf-fs-v").textContent = fmt(fs * 100, 1) + "%";
    $("mf-d-v").textContent = days;
    $("mf-v-v").textContent = (vol * 100).toFixed(0) + "%";
    const isLong = dir === "long";
    const S0 = 100;
    const price0 = isLong ? S0 - FL0 : FL0 - S0;
    const lev = price0 > 0 ? S0 / price0 : Infinity;
    // long pays rate+spread, short receives rate-spread
    const carry = isLong ? rate + fs : rate - fs;
    const FLat = (t) => FL0 * (1 + (carry * t) / 360);
    const SLat = (t) => (isLong ? FLat(t) * (1 + buf) : FLat(t) * (1 - buf));

    /* drift chart */
    const pts = [],
      slp = [];
    for (let t = 0; t <= days; t += Math.max(1, Math.round(days / 60))) {
      pts.push([t, FLat(t)]);
      slp.push([t, SLat(t)]);
    }
    const all = pts
      .concat(slp)
      .map((p) => p[1])
      .concat([S0]);
    const ylo = Math.min.apply(null, all) - 4,
      yhi = Math.max.apply(null, all) + 4;
    const f = frame($("mf-drift"), {
      H: 300,
      xr: [0, days],
      yr: [ylo, yhi],
      xticks: ticks(0, days, 6),
      xfmt: (v) => v.toFixed(0),
      yticks: ticks(ylo, yhi, 5),
      yfmt: (v) => v.toFixed(0),
      xlab: "Calendar days held",
    });
    f.hline(S0, C.deep, "4 4");
    f.line(pts, C.steel, 2.6);
    f.line(slp, C.brick, 2.6);
    f.text(days * 0.14, S0 + (yhi - ylo) * 0.05, "underlying, held flat at 100", C.deep, 10.5);
    f.text(days * 0.8, SLat(days) + (yhi - ylo) * 0.06, "stop-loss", C.brick, 10.5);
    f.text(days * 0.8, FLat(days) - (yhi - ylo) * 0.07, "financing level", C.steel, 10.5);

    const priceEnd = isLong ? S0 - FLat(days) : FLat(days) - S0;
    const bleed = price0 > 0 ? (priceEnd / price0 - 1) * 100 : 0;

    /* Monte Carlo */
    const paths = 2000,
      r = rng(seed),
      steps = Math.max(1, Math.round((days * 252) / 365)),
      dt = 1 / 252,
      sd = vol * Math.sqrt(dt);
    const rets = [];
    let stopped = 0,
      wiped = 0,
      sum = 0;
    for (let i = 0; i < paths; i++) {
      let S = S0,
        z = [],
        zi = 2,
        done = false,
        ret = 0;
      for (let d = 1; d <= steps; d++) {
        if (zi > 1) {
          z = normals(r);
          zi = 0;
        }
        S *= Math.exp(-0.5 * sd * sd + sd * z[zi++]);
        const t = (d * 365) / 252;
        const sl = SLat(t),
          fl = FLat(t);
        const hit = isLong ? S <= sl : S >= sl;
        if (hit) {
          const resid = Math.max(0, isLong ? S - fl : fl - S);
          ret = (resid / price0 - 1) * 100;
          stopped++;
          if (resid <= 0.0001) wiped++;
          done = true;
          break;
        }
      }
      if (!done) {
        const fl = FLat(days);
        const val = isLong ? S - fl : fl - S;
        ret = (val / price0 - 1) * 100;
      }
      rets.push(ret);
      sum += ret;
    }
    rets.sort((a, b) => a - b);
    const q = (t) => rets[Math.min(rets.length - 1, Math.floor(t * rets.length))];
    statCards($("mf-stats"), [
      { v: fmt(lev, 1) + "×", l: "leverage at entry", c: C.amber },
      { v: fmt(price0, 2), l: "cost per certificate", c: C.deep },
      { v: pct(stopped / paths, 0), l: "stopped out", c: C.brick },
      { v: pct(wiped / paths, 0), l: "total loss", c: C.brick },
      { v: fmt(sum / paths, 0) + "%", l: "average return", c: C.ink },
    ]);
    $("mf-terms").innerHTML =
      "<tr><td>Buffer, spot to stop-loss</td><td>" +
      fmt((Math.abs(S0 - SLat(0)) / S0) * 100, 2) +
      "%</td></tr>" +
      "<tr><td>Carry charged per year</td><td>" +
      fmt(carry * 100, 2) +
      "%</td></tr>" +
      "<tr><td>Financing level after " +
      days +
      "d</td><td>" +
      fmt(FLat(days), 2) +
      "</td></tr>" +
      "<tr><td>Value if spot never moves</td><td>" +
      fmt(priceEnd, 2) +
      "</td></tr>";
    $("mf-read").innerHTML =
      "At entry you pay <b>" +
      fmt(price0, 2) +
      "</b> for 100 of exposure — <b>" +
      fmt(lev, 1) +
      "× leverage</b> — with only <b>" +
      fmt((Math.abs(S0 - SLat(0)) / S0) * 100, 1) +
      "%</b> of room to the stop-loss. " +
      "Hold it for " +
      days +
      " days with the underlying completely unchanged and the certificate is worth <b>" +
      fmt(priceEnd, 2) +
      "</b>, a " +
      (bleed < 0 ? "loss" : "gain") +
      " of <b>" +
      fmt(Math.abs(bleed), 1) +
      "%</b> from carry alone" +
      (isLong
        ? ", because the financing level has climbed toward the spot."
        : ", because a short receives the reference rate less the spread.") +
      " In these markets it was stopped out <b>" +
      pct(stopped / paths, 0) +
      "</b> of the time and the worst 5% returned <b>" +
      fmt(q(0.05), 0) +
      "%</b>.";
  }
  run();
})();
