import { optionMetrics as calculateOptionMetrics } from "./math";
import type { OptionParams, OptionType } from "./types";

interface InitMessage {
  action: "init";
  canvas: OffscreenCanvas;
}

interface DrawMessage {
  action: "draw";
  frame: number;
  p: OptionParams;
  type: OptionType;
  yaw: number;
  pitch: number;
  width: number;
  height: number;
  dpr: number;
}

interface SurfacePoint {
  tv: number;
  pt: [number, number];
}

const palette = {
  deep: "#123b54",
  steel: "#2c5670",
  amber: "#e4a340",
  jade: "#3e8e7e",
  muted: "#8ba0ad",
  white: "#edf3f6",
};
let canvas: OffscreenCanvas | null = null,
  ctx: OffscreenCanvasRenderingContext2D | null = null,
  latestJob: DrawMessage | null = null,
  renderQueued = false;

function optionMetrics(
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  v: number,
  type: OptionType,
) {
  return calculateOptionMetrics({ S, K, T, r, q, v }, type);
}
function mix(a: string, b: string, t: number): string {
  const pa = (a.match(/\w\w/g) ?? []).map((x) => parseInt(x, 16)),
    pb = (b.match(/\w\w/g) ?? []).map((x) => parseInt(x, 16));
  return (
    "#" +
    pa
      .map((x, i) =>
        Math.round(x + ((pb[i] ?? x) - x) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
const surfaceColors = Array.from({ length: 64 }, (_, i) => {
  const t = i / 63;
  return t < 0.55
    ? mix(palette.deep, palette.jade, t / 0.55)
    : mix(palette.jade, palette.amber, (t - 0.55) / 0.45);
});

function drawSurface(job: DrawMessage): void {
  if (!canvas || !ctx) return;
  const context = ctx;
  const { p, type, yaw, pitch, width: w, height: h, dpr } = job,
    pixelWidth = Math.round(w * dpr),
    pixelHeight = Math.round(h * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, w, h);
  const nx = 34,
    nt = 20,
    sLo = p.K * 0.4,
    sHi = p.K * 1.6,
    scale = Math.min(w * 0.43, h * 0.48),
    cx = w * 0.51,
    cy = h * 0.74;
  const maxZ = Math.max(p.K * 0.72, 1),
    cosYaw = Math.cos(yaw),
    sinYaw = Math.sin(yaw),
    depth = 0.2 + pitch * 0.52;
  const project = (x: number, y: number, z: number): [number, number] => {
    const rx = x * cosYaw - y * sinYaw,
      ry = x * sinYaw + y * cosYaw;
    return [cx + rx * scale, cy + ry * scale * depth - z * scale * 1.35];
  };
  const points: SurfacePoint[][] = [];
  for (let j = 0; j <= nt; j++) {
    const row: SurfacePoint[] = [];
    for (let i = 0; i <= nx; i++) {
      const S = sLo + ((sHi - sLo) * i) / nx,
        T = (p.T * j) / nt,
        m = optionMetrics(S, p.K, T, p.r, p.q, p.v, type);
      row.push({
        tv: Math.max(0, m.price - m.intrinsic),
        pt: project((i / nx - 0.5) * 1.9, (j / nt - 0.5) * 1.45, m.price / maxZ),
      });
    }
    points.push(row);
  }
  context.fillStyle = "#071620";
  context.fillRect(0, 0, w, h);
  const cells: { i: number; j: number; depth: number }[] = [];
  for (let j = 0; j < nt; j++)
    for (let i = 0; i < nx; i++)
      cells.push({ i, j, depth: points[j][i].pt[1] + points[j + 1][i + 1].pt[1] });
  cells.sort((a, b) => a.depth - b.depth);
  cells.forEach(({ i, j }) => {
    const q = [points[j][i], points[j][i + 1], points[j + 1][i + 1], points[j + 1][i]],
      tv = (q[0].tv + q[1].tv + q[2].tv + q[3].tv) / 4,
      t = Math.min(1, tv / (p.K * 0.14));
    context.beginPath();
    q.forEach((x, k) => (k ? context.lineTo(...x.pt) : context.moveTo(...x.pt)));
    context.closePath();
    context.fillStyle = surfaceColors[Math.round(t * 63)] ?? palette.jade;
    context.globalAlpha = 0.82;
    context.fill();
    context.globalAlpha = 0.42;
    context.strokeStyle = "#6f919e";
    context.lineWidth = 0.45;
    context.stroke();
    context.globalAlpha = 1;
  });
  [0, nt].forEach((j) => {
    context.beginPath();
    points[j].forEach((x, i) => (i ? context.lineTo(...x.pt) : context.moveTo(...x.pt)));
    context.strokeStyle = j ? palette.amber : palette.white;
    context.lineWidth = j ? 2 : 2.5;
    context.stroke();
  });
  for (let j = 0; j <= nt; j += 5) {
    context.beginPath();
    points[j].forEach((x, i) => (i ? context.lineTo(...x.pt) : context.moveTo(...x.pt)));
    context.strokeStyle = "rgba(220,235,241,.28)";
    context.lineWidth = 0.7;
    context.stroke();
  }
  const current = optionMetrics(p.S, p.K, p.T, p.r, p.q, p.v, type),
    ix = (p.S - sLo) / (sHi - sLo),
    marker = project((ix - 0.5) * 1.9, 0.725, current.price / maxZ),
    base = project((ix - 0.5) * 1.9, 0.725, 0);
  context.setLineDash([4, 4]);
  context.strokeStyle = palette.white;
  context.beginPath();
  context.moveTo(...base);
  context.lineTo(...marker);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = palette.amber;
  context.beginPath();
  context.arc(marker[0], marker[1], 5, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#071620";
  context.lineWidth = 2;
  context.stroke();
  context.font = "700 11px Segoe UI, sans-serif";
  context.fillStyle = palette.muted;
  const expiryLeft = points[0][0].pt,
    expiryRight = points[0][nx].pt,
    todayLeft = points[nt][0].pt;
  context.fillText("lower spot", expiryLeft[0] - 14, expiryLeft[1] + 24);
  context.fillText("higher spot", expiryRight[0] - 35, expiryRight[1] + 24);
  context.fillStyle = palette.white;
  context.fillText("EXPIRY PAYOFF", expiryLeft[0], expiryLeft[1] - 13);
  context.fillStyle = palette.amber;
  context.fillText("TODAY", todayLeft[0], todayLeft[1] - 13);
}

function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    const job = latestJob;
    latestJob = null;
    if (job) {
      drawSurface(job);
      self.postMessage({ action: "rendered", frame: job.frame });
    }
    renderQueued = false;
    if (latestJob) queueRender();
  }, 0);
}

self.onmessage = (event: MessageEvent<InitMessage | DrawMessage>) => {
  if (event.data.action === "init") {
    canvas = event.data.canvas;
    ctx = canvas.getContext("2d");
    return;
  }
  if (event.data.action === "draw") {
    latestJob = event.data;
    queueRender();
  }
};
