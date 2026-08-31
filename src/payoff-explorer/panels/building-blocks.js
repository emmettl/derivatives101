import { $, C, fmt, frame, ticks } from "../core";
import { attachHorizontalInspector } from "../../shared/svg-interaction";

/* Payoff conventions, stated once so they cannot drift:
   lc / lp / sp  -> P&L at expiry on the option position, baseline 0.
   rc            -> REDEMPTION VALUE per 100 invested, baseline 100. The short put is
                    notional-scaled by 100/k so that a share price of zero leaves the
                    client with the coupon alone, which is what a reverse convertible does. */
(function () {
  let type = "lc";
  const K = $("bk-k"),
    P = $("bk-p");
  let selectedSpot = 100,
    chartContext = null;
  const SPEC = {
    lc: {
      name: "Long call",
      basis: "Profit and loss at expiry, per 100 of notional",
      base: 0,
      col: C.jade,
      prem: "Premium paid",
    },
    lp: {
      name: "Long put",
      basis: "Profit and loss at expiry, per 100 of notional",
      base: 0,
      col: C.jade,
      prem: "Premium paid",
    },
    sp: {
      name: "Short put",
      basis: "Profit and loss at expiry, per 100 of notional",
      base: 0,
      col: C.brick,
      prem: "Premium received",
    },
    rc: {
      name: "Bond + short put",
      basis: "Redemption value at maturity, per 100 invested",
      base: 100,
      col: C.brick,
      prem: "Coupon",
    },
  };
  function pay(t, k, pr, s) {
    if (t === "lc") return Math.max(s - k, 0) - pr;
    if (t === "lp") return Math.max(k - s, 0) - pr;
    if (t === "sp") return pr - Math.max(k - s, 0);
    return 100 + pr - (100 / k) * Math.max(k - s, 0); // reverse convertible, put scaled to full principal
  }
  // best / worst / breakeven, all on the SAME basis as pay()
  function bounds(t, k, pr) {
    if (t === "lc") return { best: null, worst: -pr, be: k + pr };
    if (t === "lp") return { best: k - pr, worst: -pr, be: k - pr };
    if (t === "sp") return { best: pr, worst: pr - k, be: k - pr };
    return { best: 100 + pr, worst: pr, be: k * (1 - pr / 100) };
  }
  document.querySelectorAll("#bk-type button").forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelectorAll("#bk-type button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        type = b.dataset.v;
        draw();
      }),
  );
  [K, P].forEach((i) => (i.oninput = draw));

  const inspector = attachHorizontalInspector($("bk-svg"), () => {
    if (!chartContext) return null;
    const { f, lo, hi, f0, base, sp } = chartContext;
    return {
      width: 760,
      left: f.m.l,
      right: f.m.r,
      top: f.m.t,
      bottom: 420 - f.m.b,
      minimum: lo,
      maximum: hi,
      step: 1,
      value: selectedSpot,
      label: `${sp.name} payoff diagram. Hover to inspect; click or drag to pin an expiry level.`,
      inspect: (spot) => {
        const payoff = f0(spot);
        return {
          title: `Underlying at expiry ${spot.toFixed(0)}`,
          rows: [
            {
              label: sp.base === 100 ? "Redemption" : "Position P/L",
              value: fmt(payoff, 2),
              color: sp.col,
            },
            {
              label: "Versus baseline",
              value: `${payoff >= base ? "+" : "−"}${fmt(Math.abs(payoff - base), 2)}`,
            },
          ],
          points: [{ y: f.Y(payoff), color: sp.col }],
        };
      },
      onSelect: (spot) => {
        selectedSpot = spot;
      },
    };
  });

  function draw() {
    const k = +K.value,
      pr = +P.value,
      sp = SPEC[type];
    $("bk-k-v").textContent = k;
    $("bk-p-v").textContent = pr;
    $("bk-p-lab").textContent = sp.prem;
    $("bk-basis").textContent = sp.basis;
    const lo = type === "rc" ? 0 : 40,
      hi = 160;
    const f0 = (s) => pay(type, k, pr, s);
    const base = sp.base;
    const ys = [f0(lo), f0(hi), f0(k), base];
    const nice = (v) => Math.round(v / 10) * 10;
    const ylo = nice(Math.min.apply(null, ys) - 12),
      yhi = nice(Math.max.apply(null, ys) + 16);
    const xt =
      type === "rc" ? [0, 20, 40, 60, 80, 100, 120, 140, 160] : [40, 60, 80, 100, 120, 140, 160];
    const f = frame($("bk-svg"), {
      H: 420,
      xr: [lo, hi],
      yr: [ylo, yhi],
      xticks: xt,
      yticks: ticks(ylo, yhi, 5),
      yfmt: (v) => v.toFixed(0),
      xlab: "Price of the underlying at expiry",
    });
    f.hline(base, C.muted, "2 3");
    f.vline(k, C.line);
    const pts = [
      [lo, f0(lo)],
      [k, f0(k)],
      [hi, f0(hi)],
    ];
    // shade above the baseline green, below it red
    (function () {
      const segs = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i],
          b = pts[i + 1];
        if ((a[1] - base) * (b[1] - base) < 0) {
          const t = (base - a[1]) / (b[1] - a[1]),
            xc = a[0] + t * (b[0] - a[0]);
          segs.push([a, [xc, base]]);
          segs.push([[xc, base], b]);
        } else segs.push([a, b]);
      }
      segs.forEach((sg) => {
        const mid = (sg[0][1] + sg[1][1]) / 2;
        if (Math.abs(mid - base) < 1e-9) return;
        f.area(
          [sg[0], sg[1], [sg[1][0], base], [sg[0][0], base]],
          mid > base ? C.jade : C.brick,
          0.13,
        );
      });
    })();
    f.line(pts, sp.col, 3.2);
    f.text(k, yhi - (yhi - ylo) * 0.04, "strike " + k, C.muted, 11);
    chartContext = { f, lo, hi, f0, base, sp };
    selectedSpot = Math.max(lo, Math.min(hi, selectedSpot));
    inspector.refresh();

    const B = bounds(type, k, pr);
    const bestTxt = B.best == null ? "unlimited" : fmt(B.best, 1);
    if (B.best != null && B.worst > B.best + 1e-9)
      console.error("payoff-explorer: worst exceeds best", type, k, pr, B);
    const tail =
      type === "lc" || type === "lp"
        ? " You paid " +
          fmt(pr, 1) +
          " for the right to act, so your loss is capped at that premium."
        : type === "sp"
          ? " You were paid " +
            fmt(pr, 1) +
            " to take on an obligation. That premium is the most you can make; the loss runs to " +
            fmt(pr - k, 1) +
            " if the share goes to zero."
          : " Above the strike the note simply repays 100 plus the " +
            fmt(pr, 1) +
            " coupon. Below it you are delivered the shares, so a share price of zero leaves you holding the coupon and nothing else.";
    $("bk-read").innerHTML =
      "<b>" +
      sp.name +
      "</b> — breakeven at <b>" +
      fmt(B.be, 1) +
      "</b>. " +
      "Best case <b>" +
      bestTxt +
      "</b>, worst case <b>" +
      fmt(B.worst, 1) +
      "</b> (underlying at zero)." +
      tail +
      "<br><span style='color:#94AAB9;font-size:12.5px'>Figures are " +
      (base === 100
        ? "redemption values per 100 invested"
        : "profit and loss per 100 of notional") +
      ".</span>";
  }
  draw();
})();
