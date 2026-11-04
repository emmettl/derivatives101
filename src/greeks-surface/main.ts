import {
  bookGreeks,
  buildGrid,
  DEFAULT_PARAMS,
  knockedIn,
  SPOT_MAX,
  SPOT_MIN,
  TRADING_DAYS,
  type Metric,
  type Observation,
  type SurfaceGrid,
  type SurfaceParams,
  type View,
} from "./engine";
import {
  buildMesh,
  DEFAULT_CAMERA,
  project,
  spotToX,
  timeToZ,
  viewProjection,
  type Camera,
  type Mesh,
} from "./mesh";
import {
  createRenderer,
  MAP_MARGIN,
  shaderSource,
  WebGpuRenderer,
  type Renderer,
  type RendererKind,
  type Scene,
} from "./renderer";

const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

interface State {
  params: SurfaceParams;
  metric: Metric;
  view: View;
  compressed: boolean;
  /** Readout point: spot in % of initial and trading days to maturity. */
  spot: number;
  days: number;
  camera: Camera;
}

const DEFAULT_STATE: State = {
  params: { ...DEFAULT_PARAMS },
  metric: "gamma",
  view: "desk",
  compressed: true,
  spot: 80,
  days: 21,
  camera: { ...DEFAULT_CAMERA },
};

const state: State = structuredClone(DEFAULT_STATE);

let renderer: Renderer | null = null;
let grid: SurfaceGrid | null = null;
let mesh: Mesh | null = null;
let version = 0;
let frameQueued = false;
let playing = 0;

const METRIC_LABEL: Record<Metric, string> = {
  value: "Value",
  delta: "Delta",
  gamma: "Gamma",
  vega: "Vega",
};

const METRIC_UNIT: Record<Metric, string> = {
  value: "% of notional",
  delta: "per 1% move in the stock",
  gamma: "change in delta per 1% move",
  vega: "% of notional per vol point",
};

const METRIC_DIGITS: Record<Metric, number> = { value: 2, delta: 3, gamma: 3, vega: 3 };

function fixed(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "–";
  const rounded = Number(value.toFixed(digits));
  return (rounded === 0 ? 0 : rounded).toFixed(digits);
}

const percent = (value: number, digits = 0) => `${fixed(value * 100, digits)}%`;

function daysText(days: number): string {
  if (days >= TRADING_DAYS) return "12 months";
  if (days >= 42) return `${fixed(days / 21, 0)} months`;
  return days === 1 ? "1 trading day" : `${days} trading days`;
}

// ---------------------------------------------------------------------------
// Surface

function rebuildGrid(): void {
  grid = buildGrid(state.params, state.view);
  rebuildMesh();
}

function rebuildMesh(): void {
  if (!grid) return;
  mesh = buildMesh(grid, {
    metric: state.metric,
    compressed: state.compressed,
    tenor: state.params.tenor,
  });
  version += 1;
  renderLegend();
}

function canvas(): HTMLCanvasElement {
  return $<HTMLCanvasElement>("#surface-canvas");
}

function scene(): Scene | null {
  if (!grid || !mesh) return null;
  return {
    grid,
    values: grid[state.metric],
    mesh,
    version,
    camera: state.camera,
    barrier: state.params.barrier,
    strike: state.params.strike,
    slice: state.days / TRADING_DAYS,
    markerSpot: state.spot,
    markerTime: state.days / TRADING_DAYS,
  };
}

function requestDraw(): void {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    draw();
  });
}

function draw(): void {
  const current = scene();
  if (!renderer || !current) return;
  const element = canvas();
  const { width, height } = element.getBoundingClientRect();
  if (width < 2 || height < 2) return;
  renderer.draw(current, width, height, Math.min(window.devicePixelRatio || 1, 2));
  placeLabels(width, height);
}

/** Positions the HTML axis labels over the canvas. */
function placeLabels(width: number, height: number): void {
  if (!renderer || !mesh) return;
  const layer = $("#surface-labels");
  layer.replaceChildren();
  const matrix = viewProjection(state.camera, width / height, renderer.zeroToOne);
  // Ticks sit on the zero plane for Greeks and on the floor for value.
  const floor = mesh.zeroY;
  const at = (x: number, y: number, z: number) => {
    if (renderer?.threeD) return project(matrix, [x, y, z], width, height);
    // Flat heat map: x is spot, z (time) runs down the page; labels sit in its margins.
    const plotWidth = width - MAP_MARGIN.left - MAP_MARGIN.right;
    const plotHeight = height - MAP_MARGIN.top - MAP_MARGIN.bottom;
    return {
      x: x > 1 ? width - MAP_MARGIN.right / 2 : MAP_MARGIN.left + ((x + 1) / 2) * plotWidth,
      y:
        z > 1.2
          ? height - 10
          : z > 1
            ? height - MAP_MARGIN.bottom + 14
            : MAP_MARGIN.top + ((z + 1) / 2) * plotHeight,
      depth: 1,
    };
  };
  const label = (text: string, point: { x: number; y: number }, className = "") => {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) return;
    // Axis titles are wider than ticks: keep them whole inside the canvas.
    const x = className === "axis" ? Math.min(Math.max(point.x, 70), width - 70) : point.x;
    const span = document.createElement("span");
    span.className = `surface-label ${className}`.trim();
    span.textContent = text;
    span.style.left = `${x}px`;
    span.style.top = `${point.y}px`;
    layer.append(span);
  };
  const narrow = width < 520;
  for (let spot = 50; spot <= 130; spot += narrow ? 20 : 10)
    label(`${spot}%`, at(spotToX(spot), floor, 1.12), "tick");
  label("Spot, % of initial", at(0, floor, 1.32), "axis");
  const side = renderer.threeD ? (Math.sin(state.camera.yaw) < 0 ? 1.1 : -1.1) : 1.08;
  const timeTicks: [number, string][] = [
    [1, "12m"],
    [0.5, "6m"],
    [0.25, "3m"],
    [0, "Maturity"],
  ];
  timeTicks.forEach(([fraction, text]) => label(text, at(side, floor, timeToZ(fraction)), "tick"));
  if (renderer.threeD) {
    label(
      `${METRIC_LABEL[state.metric]}${state.compressed && state.metric !== "value" ? " (compressed)" : ""}`,
      at(-1, 0.86, -1),
      "axis",
    );
    const zero = state.metric === "value" ? null : at(-1.06, mesh.zeroY, -1);
    if (zero) label("0", zero, "tick");
  }
}

function renderLegend(): void {
  if (!mesh) return;
  const legend = $("#surface-legend");
  const digits = METRIC_DIGITS[state.metric];
  const stops =
    state.metric === "value"
      ? [mesh.low, (mesh.low + mesh.high) / 2, mesh.high]
      : [mesh.low, 0, mesh.high];
  const colors = stops.map((value) => {
    const [r, g, b] = mesh!.color(value);
    return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
  });
  legend.style.setProperty("--legend", `linear-gradient(90deg, ${colors.join(", ")})`);
  $("#legend-low").textContent = fixed(mesh.low, digits);
  $("#legend-mid").textContent = state.metric === "value" ? fixed(stops[1], digits) : "0";
  $("#legend-high").textContent = fixed(mesh.high, digits);
  $("#legend-title").textContent =
    `${METRIC_LABEL[state.metric]} · ${METRIC_UNIT[state.metric]}, ` +
    `${state.view === "note" ? "investor's note" : "issuer's long put"}`;
}

// ---------------------------------------------------------------------------
// Picking and rotation

function pick(clientX: number, clientY: number): void {
  if (!renderer || !grid || !mesh) return;
  const rect = canvas().getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (renderer.pick) {
    const hit = renderer.pick(x, y, rect.width, rect.height);
    if (hit) setPoint(hit.spot, hit.time * TRADING_DAYS);
    return;
  }
  const matrix = viewProjection(state.camera, rect.width / rect.height, renderer.zeroToOne);
  const columns = grid.spots.length;
  const vertices = mesh.vertices;
  let best = -1;
  let bestDepth = Infinity;
  let nearest = -1;
  let nearestDistance = Infinity;
  for (let cell = 0; cell < grid.value.length; cell += 1) {
    const offset = cell * 11;
    const point = project(
      matrix,
      [vertices[offset], vertices[offset + 1], vertices[offset + 2]],
      rect.width,
      rect.height,
    );
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = cell;
    }
    if (distance < 10 && point.depth < bestDepth) {
      bestDepth = point.depth;
      best = cell;
    }
  }
  const cell = best >= 0 ? best : nearestDistance < 30 ? nearest : -1;
  if (cell < 0) return;
  const j = Math.floor(cell / columns);
  const i = cell % columns;
  setPoint(grid.spots[i], grid.times[j] * TRADING_DAYS);
}

function wireCanvas(): void {
  // Listen on the wrapper: the canvas itself is replaced if the renderer has to fall back.
  const element = $("#surface-wrap");
  let start: { x: number; y: number; yaw: number; pitch: number; moved: boolean } | null = null;
  element.addEventListener("pointerdown", (event) => {
    start = {
      x: event.clientX,
      y: event.clientY,
      yaw: state.camera.yaw,
      pitch: state.camera.pitch,
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener("pointermove", (event) => {
    if (!start || !renderer?.threeD) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 4) start.moved = true;
    if (!start.moved) return;
    state.camera.yaw = start.yaw - dx * 0.008;
    state.camera.pitch = Math.min(1.5, Math.max(0.08, start.pitch + dy * 0.006));
    requestDraw();
  });
  const end = (event: PointerEvent) => {
    if (start && !start.moved) pick(event.clientX, event.clientY);
    start = null;
  };
  element.addEventListener("pointerup", end);
  element.addEventListener("pointercancel", () => {
    start = null;
  });
  element.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 0.2 : 0.06;
    if (event.key === "ArrowLeft") state.camera.yaw += step;
    else if (event.key === "ArrowRight") state.camera.yaw -= step;
    else if (event.key === "ArrowUp") state.camera.pitch = Math.min(1.5, state.camera.pitch + step);
    else if (event.key === "ArrowDown")
      state.camera.pitch = Math.max(0.08, state.camera.pitch - step);
    else return;
    event.preventDefault();
    requestDraw();
  });
}

// ---------------------------------------------------------------------------
// Readout and slice chart

function setPoint(spot: number, days: number): void {
  state.spot = Math.min(SPOT_MAX, Math.max(SPOT_MIN, Math.round(spot * 2) / 2));
  state.days = Math.min(TRADING_DAYS, Math.max(1, Math.round(days)));
  renderReadout();
  renderControls();
  requestDraw();
}

function renderReadout(): void {
  const { params, view, spot, days } = state;
  const time = days / TRADING_DAYS;
  const greeks = bookGreeks(params, spot, time, view, grid?.coupon);
  (["value", "delta", "gamma", "vega"] as Metric[]).forEach((metric) => {
    $(`#stat-${metric}`).textContent = fixed(greeks[metric], METRIC_DIGITS[metric]);
    $(`#stat-${metric}`)
      .closest(".stat")
      ?.classList.toggle("shown", metric === state.metric);
  });
  $("#stat-value-note").textContent =
    view === "note" ? "note, % of notional" : "put, % of notional";
  const stateText =
    params.observation === "maturity"
      ? spot < params.barrier
        ? "below the barrier, which is checked only at the final fixing"
        : "above the barrier, which is checked only at the final fixing"
      : knockedIn(params, spot)
        ? "at or below the barrier, so the put has knocked in"
        : "above the barrier, which is still intact";
  $("#readout-point").textContent =
    `Spot ${fixed(spot, 1)}% of initial with ${daysText(days)} to maturity: ${stateText}.`;
  renderSlice();
}

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

function sliceSeries(time: number): { spot: number; value: number; seam: boolean }[] {
  const points: { spot: number; value: number; seam: boolean }[] = [];
  let previous: boolean | null = null;
  for (let spot = SPOT_MIN; spot <= SPOT_MAX + 1e-9; spot += 0.25) {
    const value = bookGreeks(state.params, spot, time, state.view, grid?.coupon)[state.metric];
    const side = knockedIn(state.params, spot);
    points.push({ spot, value, seam: previous !== null && previous !== side });
    previous = side;
  }
  return points;
}

function renderSlice(): void {
  const chart = $<SVGSVGElement>("#slice-chart");
  chart.replaceChildren();
  const frame = { width: 900, height: 300, left: 64, right: 22, top: 20, bottom: 40 };
  const plotWidth = frame.width - frame.left - frame.right;
  const plotHeight = frame.height - frame.top - frame.bottom;
  const time = state.days / TRADING_DAYS;
  const current = sliceSeries(time);
  const issue = sliceSeries(state.params.tenor);
  const all = [...current, ...issue].map((point) => point.value);
  let low = Math.min(...all);
  let high = Math.max(...all);
  if (state.metric !== "value") {
    low = Math.min(low, 0);
    high = Math.max(high, 0);
  }
  const pad = Math.max((high - low) * 0.08, 1e-3);
  low -= pad;
  high += pad;
  const x = (spot: number) => frame.left + ((spot - SPOT_MIN) / (SPOT_MAX - SPOT_MIN)) * plotWidth;
  const y = (value: number) => frame.top + ((high - value) / (high - low)) * plotHeight;
  const digits = METRIC_DIGITS[state.metric];

  niceTicks(low, high).forEach((tick) => {
    chart.append(
      svg("line", {
        x1: frame.left,
        x2: frame.width - frame.right,
        y1: y(tick),
        y2: y(tick),
        class: tick === 0 ? "gs-zero" : "gs-grid",
      }),
      svg(
        "text",
        { x: frame.left - 10, y: y(tick) + 4, class: "gs-axis", "text-anchor": "end" },
        fixed(tick, Math.max(0, digits - 1)),
      ),
    );
  });
  for (let spot = 40; spot <= 140; spot += 20)
    chart.append(
      svg(
        "text",
        { x: x(spot), y: frame.height - 18, class: "gs-axis", "text-anchor": "middle" },
        `${spot}%`,
      ),
    );
  chart.append(
    svg(
      "text",
      { x: frame.width - frame.right, y: frame.height - 2, class: "gs-axis", "text-anchor": "end" },
      "Spot, % of initial",
    ),
    svg(
      "text",
      { x: 12, y: frame.top - 6, class: "gs-axis" },
      `${METRIC_LABEL[state.metric]}, ${METRIC_UNIT[state.metric]}`,
    ),
  );

  const barrierX = x(state.params.barrier);
  chart.append(
    svg("line", {
      x1: barrierX,
      x2: barrierX,
      y1: frame.top,
      y2: frame.height - frame.bottom,
      class: "gs-barrier",
    }),
    svg(
      "text",
      { x: barrierX + 6, y: frame.top + 14, class: "gs-barrier-label" },
      `Barrier ${state.params.barrier}%`,
    ),
    svg("line", {
      x1: x(state.params.strike),
      x2: x(state.params.strike),
      y1: frame.top,
      y2: frame.height - frame.bottom,
      class: "gs-strike",
    }),
    svg(
      "text",
      { x: x(state.params.strike) + 6, y: frame.top + 14, class: "gs-strike-label" },
      "Strike",
    ),
  );

  const breakAtSeam = state.metric !== "value";
  const path = (points: typeof current) =>
    points
      .map(
        (point, index) =>
          `${index === 0 || (breakAtSeam && point.seam) ? "M" : "L"}${x(point.spot).toFixed(1)},${y(point.value).toFixed(1)}`,
      )
      .join(" ");
  chart.append(
    svg("path", { d: path(issue), class: "gs-issue" }),
    svg("path", { d: path(current), class: "gs-current" }),
  );
  const marker = bookGreeks(state.params, state.spot, time, state.view, grid?.coupon)[state.metric];
  chart.append(svg("circle", { cx: x(state.spot), cy: y(marker), r: 5, class: "gs-marker" }));
  $("#slice-key-current").textContent = `${daysText(state.days)} to maturity`;
}

// ---------------------------------------------------------------------------
// Controls

function renderControls(): void {
  const groups: [string, string][] = [
    ["metric", state.metric],
    ["view", state.view],
    ["observation", state.params.observation],
    ["scale", state.compressed ? "compressed" : "linear"],
  ];
  groups.forEach(([key, current]) => {
    document.querySelectorAll<HTMLButtonElement>(`[data-${key}]`).forEach((button) => {
      const on = button.dataset[key] === current;
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    });
  });
  document.querySelectorAll<HTMLInputElement>("input[data-param]").forEach((input) => {
    const key = input.dataset.param as "vol" | "barrier" | "rate";
    input.value = String(state.params[key]);
  });
  $<HTMLInputElement>("#gs-spot").value = String(state.spot);
  $<HTMLInputElement>("#gs-days").value = String(state.days);
  $("#gs-vol-out").textContent = percent(state.params.vol);
  $("#gs-barrier-out").textContent = `${state.params.barrier}%`;
  $("#gs-rate-out").textContent = percent(state.params.rate, 2);
  $("#gs-spot-out").textContent = `${fixed(state.spot, 1)}%`;
  $("#gs-days-out").textContent = daysText(state.days);
  $("#coupon-note").textContent = grid
    ? `Fair coupon at issue: ${fixed(grid.coupon, 2)}% p.a., before margin.`
    : "";
  $<HTMLButtonElement>("#gs-scale-linear").disabled = state.metric === "value";
  $<HTMLButtonElement>("#gs-scale-compressed").disabled = state.metric === "value";
}

function refreshAll(gridChanged: boolean): void {
  if (gridChanged) rebuildGrid();
  else rebuildMesh();
  renderControls();
  renderReadout();
  requestDraw();
}

interface Tour {
  metric: Metric;
  view: View;
  observation: Observation;
  spot: number;
  days: number;
  camera: Camera;
}

const TOURS: Record<string, Tour> = {
  gamma: {
    metric: "gamma",
    view: "desk",
    observation: "continuous",
    spot: 71,
    days: 3,
    camera: { ...DEFAULT_CAMERA, yaw: -0.35, pitch: 0.42 },
  },
  cliff: {
    metric: "gamma",
    view: "desk",
    observation: "maturity",
    spot: 69,
    days: 3,
    camera: { ...DEFAULT_CAMERA, yaw: -0.2, pitch: 0.38 },
  },
  delta: {
    metric: "delta",
    view: "note",
    observation: "continuous",
    spot: 72,
    days: 10,
    camera: { ...DEFAULT_CAMERA, yaw: -0.7, pitch: 0.45 },
  },
  vega: {
    metric: "vega",
    view: "note",
    observation: "continuous",
    spot: 80,
    days: 126,
    camera: { ...DEFAULT_CAMERA, yaw: 0.55, pitch: 0.5 },
  },
};

function applyTour(name: string): void {
  const tour = TOURS[name];
  if (!tour) return;
  stopPlaying();
  const gridChanged = tour.view !== state.view || tour.observation !== state.params.observation;
  state.metric = tour.metric;
  state.view = tour.view;
  state.params.observation = tour.observation;
  state.compressed = true;
  state.spot = tour.spot;
  state.days = tour.days;
  state.camera = { ...tour.camera };
  document.querySelectorAll<HTMLButtonElement>("[data-tour]").forEach((button) => {
    const on = button.dataset.tour === name;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
  });
  refreshAll(gridChanged);
  $("#surface-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function stopPlaying(): void {
  if (!playing) return;
  cancelAnimationFrame(playing);
  playing = 0;
  $("#gs-play").textContent = "Run the clock to maturity";
}

function play(): void {
  if (playing) {
    stopPlaying();
    return;
  }
  const from = state.days <= 1 ? TRADING_DAYS : state.days;
  const duration = 6000 * (from / TRADING_DAYS);
  const started = performance.now();
  $("#gs-play").textContent = "Stop the clock";
  const tick = (now: number) => {
    const progress = Math.min(1, (now - started) / Math.max(duration, 1));
    // Ease towards maturity so the last fortnight, where everything happens, plays slowly.
    const remaining = from * (1 - progress) ** 2;
    setPoint(state.spot, Math.max(1, remaining));
    if (progress < 1) playing = requestAnimationFrame(tick);
    else stopPlaying();
  };
  playing = requestAnimationFrame(tick);
}

function wireControls(): void {
  const group = (key: string, apply: (value: string) => boolean) => {
    document.querySelectorAll<HTMLButtonElement>(`[data-${key}]`).forEach((button) =>
      button.addEventListener("click", () => {
        const gridChanged = apply(button.dataset[key] ?? "");
        document.querySelectorAll("[data-tour]").forEach((tour) => tour.classList.remove("on"));
        refreshAll(gridChanged);
      }),
    );
  };
  group("metric", (value) => {
    state.metric = value as Metric;
    return false;
  });
  group("view", (value) => {
    state.view = value as View;
    return true;
  });
  group("observation", (value) => {
    state.params.observation = value as Observation;
    return true;
  });
  group("scale", (value) => {
    state.compressed = value === "compressed";
    return false;
  });
  document.querySelectorAll<HTMLInputElement>("input[data-param]").forEach((input) =>
    input.addEventListener("input", () => {
      const key = input.dataset.param as "vol" | "barrier" | "rate";
      state.params[key] = Number(input.value);
      refreshAll(true);
    }),
  );
  $<HTMLInputElement>("#gs-spot").addEventListener("input", (event) =>
    setPoint(Number((event.target as HTMLInputElement).value), state.days),
  );
  $<HTMLInputElement>("#gs-days").addEventListener("input", (event) => {
    stopPlaying();
    setPoint(state.spot, Number((event.target as HTMLInputElement).value));
  });
  $("#gs-play").addEventListener("click", play);
  $("#reset").addEventListener("click", () => {
    stopPlaying();
    Object.assign(state, structuredClone(DEFAULT_STATE));
    document.querySelectorAll("[data-tour]").forEach((tour) => tour.classList.remove("on"));
    refreshAll(true);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-camera]").forEach((button) =>
    button.addEventListener("click", () => {
      const presets: Record<string, Camera> = {
        default: { ...DEFAULT_CAMERA },
        front: { ...DEFAULT_CAMERA, yaw: 0, pitch: 0.12 },
        above: { ...DEFAULT_CAMERA, yaw: 0, pitch: 1.5 },
        side: { ...DEFAULT_CAMERA, yaw: -Math.PI / 2 + 0.02, pitch: 0.12 },
      };
      state.camera = presets[button.dataset.camera ?? "default"] ?? { ...DEFAULT_CAMERA };
      requestDraw();
    }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-tour]")
    .forEach((button) =>
      button.addEventListener("click", () => applyTour(button.dataset.tour ?? "")),
    );
}

function renderBackend(kind: RendererKind | null, label: string): void {
  const banner = $("#backend-banner");
  banner.dataset.renderer = kind ?? "none";
  const name = $("#backend-name");
  const detail = $("#backend-detail");
  if (kind === "webgpu") {
    name.textContent = "Drawn on your GPU with WebGPU";
    detail.textContent =
      `${label ? `Adapter: ${label}. ` : ""}` +
      "Drag to rotate, or click the surface to read off a point. Arrow keys rotate when the surface has focus.";
  } else if (kind === "webgl") {
    name.textContent = "WebGPU isn't available here, so the surface is drawn with WebGL";
    detail.textContent =
      "Same mesh, same shading, through the older graphics API. Drag to rotate, or click the surface to read off a point.";
  } else if (kind === "canvas") {
    name.textContent = "No GPU drawing here, so the surface is shown as a flat heat map";
    detail.textContent =
      "Spot runs across, time to maturity runs down, colour is the Greek. Click the map to read off a point.";
  } else {
    name.textContent = "This browser can't draw the surface";
    detail.textContent = "The readout and slice chart below still work.";
  }
  $("#camera-actions").hidden = !(renderer?.threeD ?? false);
}

async function useRenderer(prefer: RendererKind | null): Promise<void> {
  renderer = await createRenderer(canvas(), prefer);
  if (renderer instanceof WebGpuRenderer)
    renderer.onLost = () => {
      void useRenderer("webgl").then(() => {
        $("#backend-detail").textContent =
          "WebGPU started but then lost its GPU device, so the page switched to WebGL. " +
          $("#backend-detail").textContent;
      });
    };
  renderBackend(renderer?.kind ?? null, renderer?.label ?? "");
  version += 1;
  requestDraw();
}

async function start(): Promise<void> {
  const query = new URLSearchParams(location.search).get("renderer");
  const prefer = query === "webgl" || query === "canvas" ? query : null;
  await useRenderer(prefer);
  wireCanvas();
  wireControls();
  $("#shader-source").textContent = shaderSource;
  refreshAll(true);
  new ResizeObserver(() => requestDraw()).observe($("#surface-wrap"));
}

void start();
