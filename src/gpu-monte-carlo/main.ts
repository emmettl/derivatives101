import { CpuPricer } from "./cpu";
import {
  addSums,
  AUTOCALL_TRIGGERS,
  closedFormReference,
  DEFAULT_LOCK_IN,
  DEFAULT_PARAMS,
  emptySums,
  estimate,
  hasFeatures,
  OBSERVATIONS,
  samplePaths,
  type Autocall,
  type BatchSums,
  type Estimate,
  type McParams,
  type Monitoring,
  type PathFate,
} from "./engine";
import { GpuPricer, kernelSource, MAX_GPU_BATCH } from "./gpu";

interface Pricer {
  run(params: McParams, offset: number, count: number): Promise<BatchSums>;
}

type Backend = "gpu" | "cpu";

const GPU_TARGETS = [262_144, 1_048_576, 4_194_304, 16_777_216];
const CPU_TARGETS = [16_384, 65_536, 262_144];
const DEFAULT_TARGET: Record<Backend, number> = { gpu: 4_194_304, cpu: 65_536 };
const MAX_BATCH: Record<Backend, number> = { gpu: MAX_GPU_BATCH, cpu: 8_192 };
const FIRST_BATCH = 4_096;
const SWEEP_CORRELATIONS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const SWEEP_PATHS: Record<Backend, number> = { gpu: 262_144, cpu: 8_192 };
const RACE_PATHS = 16_384;
const SAMPLE_PATHS = 40;

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const state = {
  params: { ...DEFAULT_PARAMS } as McParams,
  target: DEFAULT_TARGET.cpu,
  backend: "cpu" as Backend,
  /** Lock-in level remembered while the feature is switched off. */
  lockLevel: DEFAULT_LOCK_IN,
};

let gpu: GpuPricer | null = null;
let cpu: CpuPricer | null = null;
let runId = 0;
let sweepId = 0;
let history: Estimate[] = [];
let sweep: { params: McParams; points: { corr: number; result: Estimate }[] } | null = null;

const cpuPricer = (): CpuPricer => (cpu ??= new CpuPricer());
const pricer = (): Pricer => (state.backend === "gpu" && gpu ? gpu : cpuPricer());

// ---------------------------------------------------------------------------
// Formatting

const integer = new Intl.NumberFormat("en-GB");
const fixed = (value: number, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "–");
const percent = (value: number, digits = 1) => `${fixed(value * 100, digits)}%`;

function compactPaths(value: number): string {
  if (value >= 1_000_000) return `${fixed(value / 1_048_576, value % 1_048_576 ? 1 : 0)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_024)}k`;
  return String(value);
}

function rate(paths: number, milliseconds: number): number {
  return paths / Math.max(milliseconds, 0.5) / 1e-3;
}

function rateText(pathsPerSecond: number): string {
  if (pathsPerSecond >= 1e6) return `${fixed(pathsPerSecond / 1e6, 1)} million paths/s`;
  if (pathsPerSecond >= 1e3) return `${integer.format(Math.round(pathsPerSecond / 1e3))}k paths/s`;
  return `${integer.format(Math.round(pathsPerSecond))} paths/s`;
}

// ---------------------------------------------------------------------------
// SVG helpers

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (text !== undefined) element.textContent = text;
  return element;
}

interface Frame {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const plotWidth = (frame: Frame) => frame.width - frame.left - frame.right;
const plotHeight = (frame: Frame) => frame.height - frame.top - frame.bottom;

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = Math.max(max - min, 1e-9);
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => span / s <= count) ?? power;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-6; value += step)
    ticks.push(Number(value.toFixed(10)));
  return ticks;
}

function yAxis(
  chart: SVGSVGElement,
  frame: Frame,
  ticks: number[],
  y: (value: number) => number,
  label: (value: number) => string,
): void {
  ticks.forEach((tick) => {
    chart.append(
      svg("line", {
        x1: frame.left,
        x2: frame.width - frame.right,
        y1: y(tick),
        y2: y(tick),
        class: "mc-grid",
      }),
      svg(
        "text",
        { x: frame.left - 10, y: y(tick) + 4, class: "mc-axis", "text-anchor": "end" },
        label(tick),
      ),
    );
  });
}

// ---------------------------------------------------------------------------
// Charts

function renderConvergence(): void {
  const chart = $<SVGSVGElement>("#converge-chart");
  chart.replaceChildren();
  const frame: Frame = { width: 900, height: 320, left: 64, right: 26, top: 22, bottom: 44 };
  // The closed form prices the plain note, so it is only a target without features.
  const reference = hasFeatures(state.params) ? null : closedFormReference(state.params);
  const minPaths = FIRST_BATCH;
  const maxPaths = Math.max(state.target, minPaths * 4);
  const x = (paths: number) =>
    frame.left + (Math.log2(paths / minPaths) / Math.log2(maxPaths / minPaths)) * plotWidth(frame);

  const values = history.flatMap((point) => [
    point.put - 1.96 * point.standardError,
    point.put + 1.96 * point.standardError,
  ]);
  if (reference) values.push(reference.put);
  const centre = history.at(-1)?.put ?? reference?.put ?? 5;
  let low = values.length ? Math.min(...values) : centre - 1;
  let high = values.length ? Math.max(...values) : centre + 1;
  const pad = Math.max((high - low) * 0.12, 0.05);
  low = Math.max(0, low - pad);
  high += pad;
  const y = (value: number) => frame.top + ((high - value) / (high - low)) * plotHeight(frame);

  yAxis(chart, frame, niceTicks(low, high), y, (value) => fixed(value, value < 1 ? 2 : 1));
  for (let paths = minPaths; paths <= maxPaths; paths *= 4) {
    chart.append(
      svg(
        "text",
        { x: x(paths), y: frame.height - 20, class: "mc-axis", "text-anchor": "middle" },
        compactPaths(paths),
      ),
    );
  }
  chart.append(
    svg(
      "text",
      { x: frame.width - frame.right, y: frame.height - 4, class: "mc-axis", "text-anchor": "end" },
      "Paths simulated (log scale)",
    ),
    svg("text", { x: 12, y: frame.top - 6, class: "mc-axis" }, "Knock-in put, % of notional"),
  );

  if (history.length) {
    const upper = history.map((p) => `${x(p.paths)},${y(p.put + 1.96 * p.standardError)}`);
    const lower = history
      .map((p) => `${x(p.paths)},${y(p.put - 1.96 * p.standardError)}`)
      .reverse();
    chart.append(svg("polygon", { points: [...upper, ...lower].join(" "), class: "mc-band" }));
  }

  if (reference) {
    chart.append(
      svg("line", {
        x1: frame.left,
        x2: frame.width - frame.right,
        y1: y(reference.put),
        y2: y(reference.put),
        class: "mc-reference",
      }),
      svg(
        "text",
        {
          x: frame.width - frame.right,
          y: y(reference.put) - 8,
          class: "mc-reference-label",
          "text-anchor": "end",
        },
        `${reference.corrected ? "Corrected closed form" : "Closed form"} ${fixed(reference.put, 3)}`,
      ),
    );
  }

  if (history.length) {
    chart.append(
      svg("polyline", {
        points: history.map((p) => `${x(p.paths)},${y(p.put)}`).join(" "),
        class: "mc-line",
      }),
    );
    history.forEach((point) =>
      chart.append(
        svg("circle", { cx: x(point.paths), cy: y(point.put), r: 3.5, class: "mc-dot" }),
      ),
    );
  }
}

const FATE_CLASS: Record<PathFate, string> = {
  plain: "mc-path",
  knocked: "mc-path touched",
  locked: "mc-path locked",
  called: "mc-path called",
};

/** Draw order: ordinary paths underneath, the ones with a story on top. */
const FATE_ORDER: Record<PathFate, number> = { plain: 0, called: 1, locked: 2, knocked: 3 };

function renderPaths(): void {
  const chart = $<SVGSVGElement>("#paths-chart");
  chart.replaceChildren();
  const frame: Frame = { width: 900, height: 300, left: 52, right: 26, top: 16, bottom: 34 };
  const { params } = state;
  const paths = samplePaths(params, SAMPLE_PATHS);
  const all = paths.flatMap((path) => path.levels);
  const low = Math.max(0, Math.min(params.barrier - 10, ...all) - 5);
  const high = Math.max(130, params.lockIn + 10, ...all) + 5;
  const steps = params.steps;
  const callEvery = Math.round(steps / OBSERVATIONS);
  const x = (step: number) => frame.left + (step / steps) * plotWidth(frame);
  const y = (value: number) => frame.top + ((high - value) / (high - low)) * plotHeight(frame);

  yAxis(chart, frame, niceTicks(low, high, 6), y, (value) => `${fixed(value, 0)}%`);
  ["Start", "3 months", "6 months", "9 months", "Maturity"].forEach((label, index) =>
    chart.append(
      svg(
        "text",
        {
          x: x((index / 4) * steps),
          y: frame.height - 10,
          class: "mc-axis",
          "text-anchor": index === 0 ? "start" : index === 4 ? "end" : "middle",
        },
        label,
      ),
    ),
  );

  const lines: [number, string, string][] = [
    [params.strike, `Strike ${params.strike}%`, "mc-strike"],
    [params.barrier, `Barrier ${params.barrier}%`, "mc-barrier"],
  ];
  if (params.lockIn > 0) lines.push([params.lockIn, `Lock-in ${params.lockIn}%`, "mc-lock"]);
  lines.forEach(([level, label, className]) =>
    chart.append(
      svg("line", {
        x1: frame.left,
        x2: frame.width - frame.right,
        y1: y(level),
        y2: y(level),
        class: className,
      }),
      svg("text", { x: frame.left + 8, y: y(level) - 6, class: `${className}-label` }, label),
    ),
  );

  [...paths]
    .sort((a, b) => FATE_ORDER[a.fate] - FATE_ORDER[b.fate])
    .forEach((path) => {
      const end = path.callStep || steps;
      const stride = 2;
      const points: string[] = [];
      for (let step = 0; step <= end; step += stride)
        points.push(`${x(step).toFixed(1)},${y(path.levels[step]).toFixed(1)}`);
      if (end % stride) points.push(`${x(end)},${y(path.levels[end])}`);
      chart.append(svg("polyline", { points: points.join(" "), class: FATE_CLASS[path.fate] }));
      if (path.fate === "called")
        chart.append(
          svg("circle", {
            cx: x(end),
            cy: y(path.levels[end]),
            r: 3.5,
            class: "mc-event called",
          }),
        );
      if (path.fate === "locked")
        chart.append(
          svg("circle", {
            cx: x(path.lockStep),
            cy: y(path.levels[path.lockStep]),
            r: 3.5,
            class: "mc-event locked",
          }),
        );
    });

  // Autocall triggers on top: a short bar at each quarterly observation.
  if (params.autocall !== "off") {
    const levels = AUTOCALL_TRIGGERS[params.autocall];
    levels.forEach((level, index) => {
      const cx = x((index + 1) * callEvery);
      chart.append(
        svg("line", {
          x1: cx - 14,
          x2: cx + 14,
          y1: y(level),
          y2: y(level),
          class: "mc-trigger",
        }),
      );
    });
    chart.append(
      svg(
        "text",
        { x: x(callEvery) + 20, y: y(levels[0]) + 4, class: "mc-trigger-label" },
        params.autocall === "flat" ? "Autocall 100%" : "Autocall 100 → 97%",
      ),
    );
  }

  const count = (fate: PathFate) => paths.filter((path) => path.fate === fate).length;
  const knocked = paths.filter((path) => path.fate === "knocked");
  const below = knocked.filter((path) => path.worst < params.strike).length;
  const parts: string[] = [];
  if (params.autocall !== "off")
    parts.push(`${count("called")} were called early and stop at the call date (blue)`);
  if (params.lockIn > 0)
    parts.push(`${count("locked")} locked in and are repaid at par whatever happens next (green)`);
  const knockText =
    `${knocked.length} closed at or below the barrier while still exposed (red), ` +
    `and ${below} of those finished below the strike and would deliver a loss`;
  $("#paths-caption").textContent =
    `Of these ${SAMPLE_PATHS} paths, ${[...parts, knockText].join("; ")}. ` +
    `They are the first ${SAMPLE_PATHS} paths of the run above, recomputed in the page from the same random numbers.`;
}

function renderSweep(): void {
  const chart = $<SVGSVGElement>("#sweep-chart");
  chart.replaceChildren();
  const frame: Frame = { width: 900, height: 260, left: 64, right: 26, top: 22, bottom: 40 };
  const x = (corr: number) => frame.left + (corr / 0.9) * plotWidth(frame);
  const points = sweep?.points ?? [];
  const values = points.flatMap((p) => [
    p.result.put - 1.96 * p.result.standardError,
    p.result.put + 1.96 * p.result.standardError,
  ]);
  let low = values.length ? Math.min(...values) : 0;
  let high = values.length ? Math.max(...values) : 10;
  const pad = Math.max((high - low) * 0.15, 0.1);
  low = Math.max(0, low - pad);
  high += pad;
  const y = (value: number) => frame.top + ((high - value) / (high - low)) * plotHeight(frame);

  yAxis(chart, frame, niceTicks(low, high), y, (value) => fixed(value, 1));
  SWEEP_CORRELATIONS.forEach((corr) =>
    chart.append(
      svg(
        "text",
        { x: x(corr), y: frame.height - 16, class: "mc-axis", "text-anchor": "middle" },
        `${Math.round(corr * 100)}%`,
      ),
    ),
  );
  chart.append(
    svg(
      "text",
      { x: frame.width - frame.right, y: frame.height - 2, class: "mc-axis", "text-anchor": "end" },
      "Correlation between the underlyings",
    ),
    svg("text", { x: 12, y: frame.top - 6, class: "mc-axis" }, "Knock-in put, % of notional"),
  );

  if (state.params.corr <= 0.9) {
    chart.append(
      svg("line", {
        x1: x(state.params.corr),
        x2: x(state.params.corr),
        y1: frame.top,
        y2: frame.height - frame.bottom,
        class: "mc-marker",
      }),
    );
  }
  if (!points.length) return;
  chart.append(
    svg("polyline", {
      points: points.map((p) => `${x(p.corr)},${y(p.result.put)}`).join(" "),
      class: "mc-line",
    }),
  );
  points.forEach((point) => {
    const cx = x(point.corr);
    chart.append(
      svg("line", {
        x1: cx,
        x2: cx,
        y1: y(point.result.put - 1.96 * point.result.standardError),
        y2: y(point.result.put + 1.96 * point.result.standardError),
        class: "mc-whisker",
      }),
      svg("circle", { cx, cy: y(point.result.put), r: 4, class: "mc-dot" }),
    );
  });
  const first = points[0];
  const last = points.at(-1);
  if (first && last) {
    chart.append(
      svg(
        "text",
        { x: x(first.corr) + 8, y: y(first.result.put) - 10, class: "mc-note" },
        `coupon ${fixed(first.result.coupon, 1)}%`,
      ),
      svg(
        "text",
        {
          x: x(last.corr) - 8,
          y: y(last.result.put) + 22,
          class: "mc-note",
          "text-anchor": "end",
        },
        `coupon ${fixed(last.result.coupon, 1)}%`,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Readouts

function renderStats(): void {
  const latest = history.at(-1);
  const featured = hasFeatures(state.params);
  const reference = closedFormReference(state.params);
  $("#stat-put").textContent = latest ? fixed(latest.put, 3) : "–";
  $("#stat-put-ci").textContent = latest
    ? `± ${fixed(1.96 * latest.standardError, 3)} (95%)`
    : "% of notional";
  $("#stat-ki").textContent = latest ? percent(latest.knockInProbability) : "–";
  $("#stat-ki-note").textContent = featured ? "breached while still exposed" : "barrier breached";
  $("#stat-coupon").textContent = latest ? `${fixed(latest.coupon, 2)}%` : "–";
  if (reference) {
    $("#stat-ref").textContent = fixed(reference.put, 3);
    $("#stat-ref-note").textContent = featured
      ? "plain note, no lock-in or autocall"
      : reference.corrected
        ? `KI ${percent(reference.knockInProbability)} · BGK-corrected`
        : `KI ${percent(reference.knockInProbability)} · Reiner-Rubinstein`;
  } else {
    $("#stat-ref").textContent = "None";
    $("#stat-ref-note").textContent = "worst-of needs simulation";
  }
}

function signed(value: number, digits: number, suffix: string): string {
  if (!Number.isFinite(value)) return "–";
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${fixed(Math.abs(value), digits)}${suffix}`;
}

function renderFeatures(): void {
  const latest = history.at(-1);
  const { params } = state;
  const featured = hasFeatures(params);
  const panel = $("#features-panel");
  panel.dataset.active = String(featured);
  const put = (value: number) => fixed(value, 2);
  const rows: [string, string, string, string][] = latest
    ? [
        [
          "Fair coupon p.a.",
          `${fixed(latest.base.coupon, 2)}%`,
          `${fixed(latest.coupon, 2)}%`,
          signed(latest.coupon - latest.base.coupon, 2, " pts"),
        ],
        [
          "Knock-in probability",
          percent(latest.base.knockInProbability),
          percent(latest.knockInProbability),
          signed(100 * (latest.knockInProbability - latest.base.knockInProbability), 1, " pts"),
        ],
        [
          "Knock-in put sold",
          put(latest.base.put),
          put(latest.put),
          signed(latest.put - latest.base.put, 2, ""),
        ],
        [
          "Expected life",
          `${fixed(params.tenor * 12, 1)} months`,
          `${fixed(latest.expectedLife * 12, 1)} months`,
          signed(12 * (latest.expectedLife - params.tenor), 1, " months"),
        ],
      ]
    : [];
  $("#features-table").replaceChildren(
    ...rows.map((cells) => {
      const row = document.createElement("tr");
      cells.forEach((text, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        if (index === 0) cell.setAttribute("scope", "row");
        cell.textContent = text;
        row.append(cell);
      });
      return row;
    }),
  );

  // Where the paths end up, as one stacked bar.
  const segments: { key: string; label: string; share: number }[] = [];
  if (latest) {
    latest.callProbabilities.forEach((share, index) => {
      if (params.autocall !== "off")
        segments.push({ key: "called", label: `Called at ${3 * (index + 1)} months`, share });
    });
    if (params.lockIn > 0)
      segments.push({
        key: "locked",
        label: "Locked in, par at maturity",
        share: latest.lockProbability,
      });
    segments.push({
      key: "knocked",
      label: "Knocked in, exposed at maturity",
      share: latest.knockInProbability,
    });
    const used = segments.reduce((total, segment) => total + segment.share, 0);
    segments.push({
      key: "plain",
      label: "Barrier intact at maturity",
      share: Math.max(0, 1 - used),
    });
  }
  $("#features-bar").replaceChildren(
    ...segments.map((segment, index) => {
      const bar = document.createElement("i");
      bar.className = `fate-${segment.key}`;
      bar.style.width = `${(segment.share * 100).toFixed(2)}%`;
      if (segment.key === "called") bar.style.opacity = String(1 - index * 0.22);
      bar.title = `${segment.label}: ${percent(segment.share)}`;
      return bar;
    }),
  );
  $("#features-legend").replaceChildren(
    ...segments.map((segment, index) => {
      const item = document.createElement("li");
      const swatch = document.createElement("i");
      swatch.className = `fate-${segment.key}`;
      if (segment.key === "called") swatch.style.opacity = String(1 - index * 0.22);
      item.append(swatch, `${segment.label} ${percent(segment.share)}`);
      return item;
    }),
  );

  let summary: string;
  if (!latest) summary = "Waiting for the first batch of paths…";
  else if (!featured)
    summary =
      "Switch on a lock-in or an autocall in the terms panel. The same paths are priced with and " +
      "without the feature, so every difference here is the feature itself, not sampling noise.";
  else {
    const notes: string[] = [];
    if (params.lockIn > 0)
      notes.push(
        params.autocall === "off"
          ? `the lock-in hands back the barrier risk on the ${percent(latest.lockProbability, 0)} of paths ` +
              `whose worst performer closes at ${params.lockIn}% or above`
          : `the lock-in hands back the barrier risk on the ${percent(latest.lockProbability, 0)} of notes ` +
              `that reach ${params.lockIn}% without being called first`,
      );
    if (params.autocall !== "off") {
      const called = latest.callProbabilities.reduce((total, p) => total + p, 0);
      notes.push(
        `the autocall ends ${percent(called, 0)} of notes early, mostly in the good states where the put ` +
          "was worth least, so the client earns the coupon for less time",
      );
    }
    const change = latest.coupon - latest.base.coupon;
    summary =
      `Here ${notes.join(", and ")}. The fair coupon ${change >= 0 ? "rises" : "falls"} by ` +
      `${fixed(Math.abs(change), 2)} points to ${fixed(latest.coupon, 2)}% p.a.` +
      (params.autocall !== "off"
        ? " The put shrinks, but it is now earned over a shorter expected life, so the annual rate can still go up."
        : " A lock-in is protection the client buys back, so it is paid for out of the coupon.");
  }
  $("#features-summary").textContent = summary;
}

function renderControls(): void {
  const { params } = state;
  document.querySelectorAll<HTMLButtonElement>("[data-assets]").forEach((button) => {
    const on = Number(button.dataset.assets) === params.assets;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-monitoring]").forEach((button) => {
    const on = button.dataset.monitoring === params.monitoring;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lock]").forEach((button) => {
    const on = (button.dataset.lock === "on") === params.lockIn > 0;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autocall]").forEach((button) => {
    const on = button.dataset.autocall === params.autocall;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-lock]").forEach((button) =>
    button.addEventListener("click", () => {
      const previous = { ...state.params };
      state.params.lockIn = button.dataset.lock === "on" ? state.lockLevel : 0;
      paramsChanged(previous);
    }),
  );
  $<HTMLInputElement>("#mc-lock").addEventListener("input", (event) => {
    const previous = { ...state.params };
    state.lockLevel = Number((event.target as HTMLInputElement).value);
    if (state.params.lockIn > 0) state.params.lockIn = state.lockLevel;
    paramsChanged(previous);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autocall]").forEach((button) =>
    button.addEventListener("click", () => {
      const previous = { ...state.params };
      state.params.autocall = button.dataset.autocall as Autocall;
      paramsChanged(previous);
    }),
  );
  document.querySelectorAll<HTMLInputElement>("input[data-param]").forEach((input) => {
    const key = input.dataset.param as "vol" | "corr" | "barrier" | "rate";
    input.value = String(params[key]);
  });
  const lock = $<HTMLInputElement>("#mc-lock");
  lock.value = String(state.lockLevel);
  lock.disabled = params.lockIn === 0;
  $("#mc-lock-out").textContent = params.lockIn > 0 ? `${state.lockLevel}%` : "off";
  const corr = $<HTMLInputElement>("#mc-corr");
  corr.disabled = params.assets === 1;
  $("#mc-vol-out").textContent = percent(params.vol, 0);
  $("#mc-corr-out").textContent = params.assets === 1 ? "n/a" : percent(params.corr, 0);
  $("#mc-barrier-out").textContent = `${params.barrier}%`;
  $("#mc-rate-out").textContent = percent(params.rate, 2);
  $<HTMLSelectElement>("#mc-target").value = String(state.target);
  $<HTMLButtonElement>("#sweep-run").disabled = params.assets === 1;
}

function renderBackend(adapterText = ""): void {
  const banner = $("#backend-banner");
  banner.dataset.backend = state.backend;
  if (state.backend === "gpu") {
    $("#backend-name").textContent = "Running on your GPU with WebGPU";
    $("#backend-detail").textContent =
      `${adapterText ? `Adapter: ${adapterText}. ` : ""}` +
      `Up to ${integer.format(MAX_GPU_BATCH)} paths per dispatch, one GPU thread per path.`;
  } else {
    $("#backend-name").textContent = "WebGPU isn't available here, so this is running on the CPU";
    $("#backend-detail").textContent =
      "The same simulation runs in a background thread with fewer paths. For the GPU version, open " +
      "the page in a recent Chrome or Edge, Safari 26 or Firefox 141 or later, with hardware " +
      "acceleration switched on.";
  }
  const select = $<HTMLSelectElement>("#mc-target");
  select.replaceChildren(
    ...(state.backend === "gpu" ? GPU_TARGETS : CPU_TARGETS).map((count) => {
      const option = document.createElement("option");
      option.value = String(count);
      option.textContent = `${integer.format(count)} paths`;
      return option;
    }),
  );
  select.value = String(state.target);
  $("#mc-target-help").textContent =
    state.backend === "gpu"
      ? "Each path is 252 trading days for every underlying."
      : "Capped on the CPU: a million paths would take minutes.";
  const race = $<HTMLButtonElement>("#race-run");
  race.disabled = state.backend !== "gpu";
  if (state.backend !== "gpu")
    $("#race-status").textContent =
      "The race needs WebGPU. On a supported browser it times the GPU against this CPU on identical paths.";
}

// ---------------------------------------------------------------------------
// Simulation

async function runSimulation(): Promise<void> {
  const id = (runId += 1);
  const params = { ...state.params };
  const backend = state.backend;
  const target = state.target;
  const maxBatch = MAX_BATCH[backend];
  history = [];
  renderStats();
  renderFeatures();
  renderConvergence();
  renderPaths();
  const status = $("#mc-status");
  status.textContent = "Simulating…";

  let sums = emptySums();
  let batch = FIRST_BATCH;
  const started = performance.now();
  try {
    while (sums.paths < target) {
      const count = Math.min(batch, target - sums.paths);
      const result = await pricer().run(params, sums.paths, count);
      if (id !== runId) return;
      sums = addSums(sums, result);
      history.push(estimate(sums, params));
      renderStats();
      renderFeatures();
      renderConvergence();
      status.textContent = `Simulating… ${integer.format(sums.paths)} of ${integer.format(target)} paths`;
      // Double the running total while batches are small, so points are evenly spaced in log paths.
      batch = Math.min(sums.paths, maxBatch);
    }
  } catch (error) {
    if (id !== runId) return;
    if (backend === "gpu") {
      state.backend = "cpu";
      state.target = DEFAULT_TARGET.cpu;
      renderBackend();
      renderControls();
      $("#backend-detail").textContent =
        `The GPU stopped responding (${error instanceof Error ? error.message : "unknown error"}), ` +
        "so the page has switched to the CPU.";
      void runSimulation();
      return;
    }
    throw error;
  }
  const milliseconds = performance.now() - started;
  const seconds = milliseconds / 1000;
  status.textContent =
    `Estimate current · ${integer.format(sums.paths)} paths in ${fixed(seconds, seconds < 10 ? 2 : 1)} s ` +
    `on the ${backend.toUpperCase()} · ${rateText(rate(sums.paths, milliseconds))} · ` +
    `${integer.format(sums.paths * params.steps * params.assets)} simulated stock-days`;
}

async function runSweep(): Promise<void> {
  if (state.params.assets === 1) return;
  const id = (sweepId += 1);
  const params = { ...state.params };
  const count = SWEEP_PATHS[state.backend];
  const status = $("#sweep-status");
  const button = $<HTMLButtonElement>("#sweep-run");
  button.disabled = true;
  sweep = { params, points: [] };
  const started = performance.now();
  for (const corr of SWEEP_CORRELATIONS) {
    status.textContent = `Pricing at ${Math.round(corr * 100)}% correlation…`;
    const point = { ...params, corr };
    let sums = emptySums();
    while (sums.paths < count) {
      const size = Math.min(MAX_BATCH[state.backend], count - sums.paths);
      sums = addSums(sums, await pricer().run(point, sums.paths, size));
      if (id !== sweepId) return;
    }
    sweep.points.push({ corr, result: estimate(sums, point) });
    renderSweep();
  }
  button.disabled = state.params.assets === 1;
  const total = count * SWEEP_CORRELATIONS.length;
  const seconds = (performance.now() - started) / 1000;
  status.textContent =
    `${integer.format(total)} paths in ${fixed(seconds, 2)} s, ${integer.format(count)} at each correlation, ` +
    "all on the same random numbers so the curve is smooth.";
}

async function runRace(): Promise<void> {
  if (!gpu || state.backend !== "gpu") return;
  const button = $<HTMLButtonElement>("#race-run");
  const status = $("#race-status");
  button.disabled = true;
  const params = { ...state.params };
  status.textContent = `Timing the GPU on ${integer.format(RACE_PATHS)} paths…`;

  // Warm up once so pipeline set-up is not counted, then time a full-size run.
  await gpu.run(params, 0, RACE_PATHS);
  const gpuStarted = performance.now();
  const gpuSmall = await gpu.run(params, 0, RACE_PATHS);
  const big = Math.min(MAX_GPU_BATCH, 262_144);
  await gpu.run(params, 0, big);
  const gpuMilliseconds = performance.now() - gpuStarted;
  const gpuRate = rate(RACE_PATHS + big, gpuMilliseconds);

  status.textContent = `Now the CPU on the same ${integer.format(RACE_PATHS)} paths…`;
  const cpuStarted = performance.now();
  const cpuSmall = await cpuPricer().run(params, 0, RACE_PATHS);
  const cpuMilliseconds = performance.now() - cpuStarted;
  const cpuRate = rate(RACE_PATHS, cpuMilliseconds);

  const ratio = gpuRate / cpuRate;
  $("#race-gpu").textContent = rateText(gpuRate);
  $("#race-cpu").textContent = rateText(cpuRate);
  $<HTMLElement>("#race-gpu-bar").style.width = "100%";
  $<HTMLElement>("#race-cpu-bar").style.width = `${Math.max(0.6, Math.min(100, 100 / ratio))}%`;
  const gpuPut = estimate(gpuSmall, params).put;
  const cpuPut = estimate(cpuSmall, params).put;
  status.textContent =
    `The GPU is about ${ratio >= 10 ? integer.format(Math.round(ratio)) : fixed(ratio, 1)}× faster here. ` +
    `Same ${integer.format(RACE_PATHS)} paths, same answer: GPU ${fixed(gpuPut, 4)} in single precision, ` +
    `CPU ${fixed(cpuPut, 4)} in double precision.`;
  button.disabled = false;
}

// ---------------------------------------------------------------------------
// Wiring

let pending: number | undefined;
function scheduleRun(): void {
  renderControls();
  window.clearTimeout(pending);
  pending = window.setTimeout(() => void runSimulation(), 180);
}

function paramsChanged(previous: McParams): void {
  if (sweep) {
    const { corr: _a, ...before } = sweep.params;
    const { corr: _b, ...after } = state.params;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      sweep = null;
      sweepId += 1;
      $("#sweep-status").textContent = "Inputs changed. Press the button to run the sweep again.";
      $<HTMLButtonElement>("#sweep-run").disabled = state.params.assets === 1;
    }
  }
  if (previous.assets !== state.params.assets && state.params.assets === 1)
    $("#sweep-status").textContent = "The sweep needs at least two underlyings.";
  renderSweep();
  scheduleRun();
}

function wire(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-assets]").forEach((button) =>
    button.addEventListener("click", () => {
      const previous = { ...state.params };
      state.params.assets = Number(button.dataset.assets);
      paramsChanged(previous);
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-monitoring]").forEach((button) =>
    button.addEventListener("click", () => {
      const previous = { ...state.params };
      state.params.monitoring = button.dataset.monitoring as Monitoring;
      paramsChanged(previous);
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-lock]").forEach((button) =>
    button.addEventListener("click", () => {
      const previous = { ...state.params };
      state.params.lockIn = button.dataset.lock === "on" ? state.lockLevel : 0;
      paramsChanged(previous);
    }),
  );
  $<HTMLInputElement>("#mc-lock").addEventListener("input", (event) => {
    const previous = { ...state.params };
    state.lockLevel = Number((event.target as HTMLInputElement).value);
    if (state.params.lockIn > 0) state.params.lockIn = state.lockLevel;
    paramsChanged(previous);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autocall]").forEach((button) =>
    button.addEventListener("click", () => {
      const previous = { ...state.params };
      state.params.autocall = button.dataset.autocall as Autocall;
      paramsChanged(previous);
    }),
  );
  document.querySelectorAll<HTMLInputElement>("input[data-param]").forEach((input) =>
    input.addEventListener("input", () => {
      const previous = { ...state.params };
      const key = input.dataset.param as "vol" | "corr" | "barrier" | "rate";
      state.params[key] = Number(input.value);
      paramsChanged(previous);
    }),
  );
  $<HTMLSelectElement>("#mc-target").addEventListener("change", (event) => {
    state.target = Number((event.target as HTMLSelectElement).value);
    scheduleRun();
  });
  $("#mc-rerun").addEventListener("click", () => {
    const previous = { ...state.params };
    state.params.seed += 1;
    paramsChanged(previous);
  });
  $("#reset").addEventListener("click", () => {
    const previous = { ...state.params };
    state.params = { ...DEFAULT_PARAMS };
    state.lockLevel = DEFAULT_LOCK_IN;
    state.target = DEFAULT_TARGET[state.backend];
    paramsChanged(previous);
  });
  $("#sweep-run").addEventListener("click", () => void runSweep());
  $("#race-run").addEventListener("click", () => void runRace());
}

async function start(): Promise<void> {
  $("#kernel-source").textContent = kernelSource;
  wire();
  renderControls();
  renderFeatures();
  renderSweep();
  gpu = await GpuPricer.create();
  state.backend = gpu ? "gpu" : "cpu";
  state.target = DEFAULT_TARGET[state.backend];
  const adapter = gpu
    ? [gpu.adapter.vendor, gpu.adapter.architecture, gpu.adapter.description]
        .filter(Boolean)
        .join(" · ")
    : "";
  renderBackend(adapter);
  renderControls();
  void runSimulation();
}

void start();
