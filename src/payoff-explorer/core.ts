export const C = {
  ink: "#0B1E2D",
  deep: "#123B54",
  steel: "#2C5670",
  amber: "#E4A340",
  amberD: "#B87E24",
  brick: "#B5443A",
  jade: "#3E8E7E",
  muted: "#64798A",
  line: "#D3DBE2",
  tint: "#F2F5F7",
} as const;

type Point = readonly [number, number];
type Margins = { l: number; r: number; t: number; b: number };

export interface FrameOptions {
  W?: number;
  H?: number;
  m?: Margins;
  xr: readonly [number, number];
  yr: readonly [number, number];
  xticks?: number[];
  yticks?: number[];
  xfmt?: (value: number) => string;
  yfmt?: (value: number) => string;
  xlab?: string;
  ylab?: string;
}

export interface PlotFrame {
  g: SVGGElement;
  X: (value: number) => number;
  Y: (value: number) => number;
  m: Margins;
  pw: number;
  ph: number;
  line: (points: Point[], color: string, width?: number, dash?: string) => SVGPathElement;
  area: (points: Point[], color: string, opacity?: number) => void;
  vline: (x: number, color: string, dash?: string) => void;
  hline: (y: number, color: string, dash?: string) => void;
  rect: (x0: number, x1: number, color: string, opacity?: number) => void;
  text: (
    x: number,
    y: number,
    text: string,
    color?: string,
    size?: number,
    anchor?: string,
    weight?: number,
  ) => void;
  dot: (x: number, y: number, color: string) => void;
  bar: (x0: number, x1: number, y0: number, y1: number, color: string, opacity?: number) => void;
}

export interface StatCard {
  c: string;
  v: string;
  l: string;
}

export interface HistogramOptions {
  lo: number;
  hi: number;
  bins?: number;
  split?: number;
  xfmt?: (value: number) => string;
  xlab?: string;
  title?: string;
}

export function $<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing payoff explorer element #${id}`);
  return element as unknown as T;
}

export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (text != null) element.textContent = text;
  return element;
}

export function clear(svg: SVGElement): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

export function fmt(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "–" : value.toFixed(digits);
}

export function pct(value: number, digits = 1): string {
  return `${fmt(100 * value, digits)}%`;
}

export function rng(seed: number): () => number {
  let state = seed >>> 0 || 88675123;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

export function normals(random: () => number): [number, number] {
  let u = 0,
    v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  const magnitude = Math.sqrt(-2 * Math.log(u));
  return [magnitude * Math.cos(2 * Math.PI * v), magnitude * Math.sin(2 * Math.PI * v)];
}

export function normCdf(input: number): number {
  const coefficients = [0.31938153, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
  const sign = input < 0 ? -1 : 1;
  const value = Math.abs(input);
  const t = 1 / (1 + 0.2316419 * value);
  let polynomial = 0,
    power = t;
  coefficients.forEach((coefficient) => {
    polynomial += coefficient * power;
    power *= t;
  });
  const probability = 1 - (Math.exp((-value * value) / 2) / Math.sqrt(2 * Math.PI)) * polynomial;
  return sign > 0 ? probability : 1 - probability;
}

export function bsCall(
  spot: number,
  strike: number,
  tenor: number,
  rate: number,
  dividend: number,
  volatility: number,
): number {
  if (tenor <= 0 || volatility <= 0)
    return Math.max(spot * Math.exp(-dividend * tenor) - strike * Math.exp(-rate * tenor), 0);
  const sigmaRootT = volatility * Math.sqrt(tenor);
  const d1 =
    (Math.log(spot / strike) + (rate - dividend + 0.5 * volatility * volatility) * tenor) /
    sigmaRootT;
  const d2 = d1 - sigmaRootT;
  return (
    spot * Math.exp(-dividend * tenor) * normCdf(d1) -
    strike * Math.exp(-rate * tenor) * normCdf(d2)
  );
}

export function frame(svg: SVGSVGElement, options: FrameOptions): PlotFrame {
  clear(svg);
  const width = options.W ?? 760,
    height = options.H ?? 300,
    margins = options.m ?? { l: 62, r: 22, t: 22, b: 44 };
  const plotWidth = width - margins.l - margins.r,
    plotHeight = height - margins.t - margins.b;
  const X = (value: number) =>
    margins.l + ((value - options.xr[0]) / (options.xr[1] - options.xr[0])) * plotWidth;
  const Y = (value: number) =>
    margins.t +
    plotHeight -
    ((value - options.yr[0]) / (options.yr[1] - options.yr[0])) * plotHeight;
  const g = el("g", {});
  svg.appendChild(g);
  (options.yticks ?? []).forEach((tick) => {
    g.append(
      el("line", {
        x1: margins.l,
        x2: margins.l + plotWidth,
        y1: Y(tick),
        y2: Y(tick),
        stroke: C.line,
        "stroke-width": 1,
      }),
    );
    g.append(
      el(
        "text",
        { x: margins.l - 8, y: Y(tick) + 4, "text-anchor": "end", "font-size": 11, fill: C.muted },
        options.yfmt?.(tick) ?? String(tick),
      ),
    );
  });
  (options.xticks ?? []).forEach((tick) =>
    g.append(
      el(
        "text",
        {
          x: X(tick),
          y: margins.t + plotHeight + 18,
          "text-anchor": "middle",
          "font-size": 11,
          fill: C.muted,
        },
        options.xfmt?.(tick) ?? String(tick),
      ),
    ),
  );
  g.append(
    el("line", {
      x1: margins.l,
      x2: margins.l,
      y1: margins.t,
      y2: margins.t + plotHeight,
      stroke: C.muted,
      "stroke-width": 1,
    }),
  );
  g.append(
    el("line", {
      x1: margins.l,
      x2: margins.l + plotWidth,
      y1: margins.t + plotHeight,
      y2: margins.t + plotHeight,
      stroke: C.muted,
      "stroke-width": 1,
    }),
  );
  if (options.xlab)
    g.append(
      el(
        "text",
        {
          x: margins.l + plotWidth / 2,
          y: height - 8,
          "text-anchor": "middle",
          "font-size": 12,
          fill: C.muted,
        },
        options.xlab,
      ),
    );
  if (options.ylab)
    g.append(
      el(
        "text",
        { x: margins.l - 46, y: margins.t - 8, "font-size": 12, fill: C.muted },
        options.ylab,
      ),
    );

  return {
    g,
    X,
    Y,
    m: margins,
    pw: plotWidth,
    ph: plotHeight,
    line(points, color, lineWidth = 2.5, dash) {
      const path = el("path", {
        d: points
          .map((point, index) => `${index ? "L" : "M"}${X(point[0])} ${Y(point[1])}`)
          .join(" "),
        fill: "none",
        stroke: color,
        "stroke-width": lineWidth,
        "stroke-linejoin": "round",
      });
      if (dash) path.setAttribute("stroke-dasharray", dash);
      g.append(path);
      return path;
    },
    area(points, color, opacity = 0.12) {
      g.append(
        el("path", {
          d: `${points.map((point, index) => `${index ? "L" : "M"}${X(point[0])} ${Y(point[1])}`).join(" ")} Z`,
          fill: color,
          opacity,
          stroke: "none",
        }),
      );
    },
    vline(x, color, dash = "5 4") {
      g.append(
        el("line", {
          x1: X(x),
          x2: X(x),
          y1: margins.t,
          y2: margins.t + plotHeight,
          stroke: color,
          "stroke-width": 1.4,
          "stroke-dasharray": dash,
        }),
      );
    },
    hline(y, color, dash = "5 4") {
      g.append(
        el("line", {
          x1: margins.l,
          x2: margins.l + plotWidth,
          y1: Y(y),
          y2: Y(y),
          stroke: color,
          "stroke-width": 1.4,
          "stroke-dasharray": dash,
        }),
      );
    },
    rect(x0, x1, color, opacity = 0.08) {
      g.append(
        el("rect", {
          x: X(x0),
          y: margins.t,
          width: Math.max(0, X(x1) - X(x0)),
          height: plotHeight,
          fill: color,
          opacity,
        }),
      );
    },
    text(x, y, text, color = C.muted, size = 11, anchor = "middle", weight = 700) {
      g.append(
        el(
          "text",
          {
            x: X(x),
            y: Y(y),
            fill: color,
            "font-size": size,
            "text-anchor": anchor,
            "font-weight": weight,
          },
          text,
        ),
      );
    },
    dot(x, y, color) {
      g.append(
        el("circle", {
          cx: X(x),
          cy: Y(y),
          r: 4.5,
          fill: color,
          stroke: "#fff",
          "stroke-width": 1.5,
        }),
      );
    },
    bar(x0, x1, y0, y1, color, opacity = 1) {
      g.append(
        el("rect", {
          x: X(x0),
          y: Y(y1),
          width: Math.max(1, X(x1) - X(x0)),
          height: Math.max(0, Y(y0) - Y(y1)),
          fill: color,
          opacity,
        }),
      );
    },
  };
}

export function ticks(low: number, high: number, count: number): number[] {
  const step = (high - low) / count;
  return Array.from({ length: count + 1 }, (_, index) => low + index * step);
}

export function statCards(host: HTMLElement, items: StatCard[]): void {
  host.innerHTML = items
    .map(
      (item) =>
        `<div class="stat"><div class="v" style="color:${item.c}">${item.v}</div><div class="l">${item.l}</div></div>`,
    )
    .join("");
}

export function histogram(
  svg: SVGSVGElement,
  values: number[],
  options: HistogramOptions,
): PlotFrame {
  const bins = options.bins ?? 34;
  const counts = Array.from({ length: bins }, () => 0);
  values.forEach((value) => {
    const index = Math.min(
      bins - 1,
      Math.max(0, Math.floor(((value - options.lo) / (options.hi - options.lo)) * bins)),
    );
    counts[index] += 1;
  });
  const maximum = Math.max(...counts) || 1;
  const plot = frame(svg, {
    H: 300,
    xr: [options.lo, options.hi],
    yr: [0, maximum * 1.12],
    xticks: ticks(options.lo, options.hi, 6),
    xfmt: options.xfmt,
    yticks: [],
    xlab: options.xlab,
  });
  const width = (options.hi - options.lo) / bins;
  counts.forEach((count, index) => {
    const x0 = options.lo + index * width;
    plot.bar(
      x0 + width * 0.08,
      x0 + width * 0.92,
      0,
      count,
      x0 + width / 2 < (options.split ?? -1e9) ? C.brick : C.jade,
      0.85,
    );
  });
  if (options.split != null) plot.vline(options.split, C.ink, "4 4");
  if (options.title)
    svg.append(
      el("text", { x: 62, y: 14, "font-size": 12, "font-weight": 700, fill: C.ink }, options.title),
    );
  return plot;
}
