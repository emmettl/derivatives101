import { compress, SPOT_MAX, SPOT_MIN, type Metric, type SurfaceGrid } from "./engine";

/**
 * Turns a grid of numbers into a triangle mesh in a [-1, 1] box:
 * x is spot, z is time to maturity (maturity at the front, z = +1),
 * y is the metric. Shared by the WebGPU and WebGL renderers.
 */

/** Floats per vertex: position 3, normal 3, colour 3, grid 2. */
export const VERTEX_FLOATS = 11;
export const VERTEX_BYTES = VERTEX_FLOATS * 4;

export interface Mesh {
  vertices: Float32Array;
  indices: Uint32Array;
  /** Axis lines, same vertex layout, drawn as a line list. */
  lines: Float32Array;
  /** Model-space height of the metric's zero, or of the value floor. */
  zeroY: number;
  /** Converts a metric value to model-space height. */
  height: (value: number) => number;
  /** Colour of a metric value as [r, g, b] in 0..1. */
  color: (value: number) => [number, number, number];
  /** Height range shown, in metric units. */
  low: number;
  high: number;
}

export interface MeshOptions {
  metric: Metric;
  compressed: boolean;
  tenor: number;
}

/** Spread used by the asinh compression, per metric: roughly the size of a typical value. */
export const COMPRESS_SCALE: Record<Metric, number> = {
  value: 1,
  delta: 0.25,
  gamma: 0.02,
  vega: 0.1,
};

const HEIGHT = 0.75;

export const spotToX = (spot: number) => ((spot - SPOT_MIN) / (SPOT_MAX - SPOT_MIN)) * 2 - 1;
export const timeToZ = (fraction: number) => 1 - 2 * fraction;

function hex(color: string): [number, number, number] {
  const value = parseInt(color.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

const PALETTE = {
  deep: hex("#123b54"),
  steel: hex("#2c5670"),
  jade: hex("#3e8e7e"),
  pale: hex("#e9eef1"),
  amber: hex("#e4a340"),
  brick: hex("#b5443a"),
  ink: hex("#0b1e2d"),
  muted: hex("#8ba0ad"),
};

function lerp(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((v, index) => v + (b[index] - v) * t) as [number, number, number];
}

function ramp(stops: [number, number, number][], t: number): [number, number, number] {
  const clamped = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const index = Math.min(Math.floor(clamped), stops.length - 2);
  return lerp(stops[index], stops[index + 1], clamped - index);
}

export function metricValues(grid: SurfaceGrid, metric: Metric): Float64Array {
  return grid[metric];
}

export function buildMesh(grid: SurfaceGrid, options: MeshOptions): Mesh {
  const values = metricValues(grid, options.metric);
  const columns = grid.spots.length;
  const rows = grid.times.length;
  const signed = options.metric !== "value";
  const scale = COMPRESS_SCALE[options.metric];
  const shape = (value: number) => (options.compressed && signed ? compress(value, scale) : value);

  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  let height: (value: number) => number;
  let color: (value: number) => [number, number, number];
  let zeroY: number;
  if (signed) {
    const reach = Math.max(Math.abs(shape(low)), Math.abs(shape(high)), 1e-9);
    height = (value) => (shape(value) / reach) * HEIGHT;
    zeroY = 0;
    color = (value) => {
      const t = shape(value) / reach;
      return t >= 0
        ? ramp([PALETTE.pale, PALETTE.jade, PALETTE.deep], t)
        : ramp([PALETTE.pale, PALETTE.amber, PALETTE.brick], -t);
    };
  } else {
    const span = Math.max(high - low, 1e-9);
    height = (value) => -HEIGHT + ((value - low) / span) * 2 * HEIGHT;
    zeroY = -HEIGHT;
    color = (value) =>
      ramp([PALETTE.brick, PALETTE.amber, PALETTE.pale, PALETTE.jade], (value - low) / span);
  }

  const positionY = new Float32Array(columns * rows);
  for (let cell = 0; cell < values.length; cell += 1) positionY[cell] = height(values[cell]);

  const vertices = new Float32Array(columns * rows * VERTEX_FLOATS);
  for (let j = 0; j < rows; j += 1) {
    const fraction = grid.times[j] / options.tenor;
    const z = timeToZ(fraction);
    for (let i = 0; i < columns; i += 1) {
      const cell = j * columns + i;
      const x = spotToX(grid.spots[i]);
      // Normal from neighbouring heights (one-sided at the edges).
      const left = positionY[j * columns + Math.max(i - 1, 0)];
      const right = positionY[j * columns + Math.min(i + 1, columns - 1)];
      const back = positionY[Math.max(j - 1, 0) * columns + i];
      const front = positionY[Math.min(j + 1, rows - 1) * columns + i];
      const dx =
        spotToX(grid.spots[Math.min(i + 1, columns - 1)]) - spotToX(grid.spots[Math.max(i - 1, 0)]);
      const dz =
        timeToZ(grid.times[Math.min(j + 1, rows - 1)] / options.tenor) -
        timeToZ(grid.times[Math.max(j - 1, 0)] / options.tenor);
      let nx = -(right - left) / (dx || 1);
      let ny = 1;
      let nz = -(front - back) / (dz || 1);
      const length = Math.hypot(nx, ny, nz);
      nx /= length;
      ny /= length;
      nz /= length;
      const [r, g, b] = color(values[cell]);
      vertices.set(
        [x, positionY[cell], z, nx, ny, nz, r, g, b, grid.spots[i], fraction],
        cell * VERTEX_FLOATS,
      );
    }
  }

  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let k = 0;
  for (let j = 0; j < rows - 1; j += 1) {
    for (let i = 0; i < columns - 1; i += 1) {
      const a = j * columns + i;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }

  return { vertices, indices, lines: axisLines(zeroY), zeroY, height, color, low, high };
}

/** Floor frame, zero plane outline and vertical axis, as a line list. */
function axisLines(zeroY: number): Float32Array {
  const segments: [number, number, number, number, number, number][] = [];
  const floor = -HEIGHT;
  const top = HEIGHT;
  const frame = (y: number) => {
    segments.push(
      [-1, y, -1, 1, y, -1],
      [1, y, -1, 1, y, 1],
      [1, y, 1, -1, y, 1],
      [-1, y, 1, -1, y, -1],
    );
  };
  frame(floor);
  if (zeroY !== floor) frame(zeroY);
  segments.push([-1, floor, -1, -1, top, -1]);
  for (let spot = 50; spot < SPOT_MAX; spot += 10)
    segments.push([spotToX(spot), zeroY, 1, spotToX(spot), zeroY, 1.04]);
  const lines = new Float32Array(segments.length * 2 * VERTEX_FLOATS);
  const [r, g, b] = PALETTE.muted;
  segments.forEach((segment, index) => {
    lines.set(
      [segment[0], segment[1], segment[2], 0, 1, 0, r, g, b, -1, -1],
      index * 2 * VERTEX_FLOATS,
    );
    lines.set(
      [segment[3], segment[4], segment[5], 0, 1, 0, r, g, b, -1, -1],
      (index * 2 + 1) * VERTEX_FLOATS,
    );
  });
  return lines;
}

// ---------------------------------------------------------------------------
// Camera maths, column-major as both WGSL and GLSL expect.

export type Mat4 = Float32Array;

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1)
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  return out;
}

/** Perspective projection; depth maps to [0, 1] for WebGPU or [-1, 1] for WebGL. */
export function perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
  zeroToOne: boolean,
): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[11] = -1;
  if (zeroToOne) {
    out[10] = far / (near - far);
    out[14] = (far * near) / (near - far);
  } else {
    out[10] = (far + near) / (near - far);
    out[14] = (2 * far * near) / (near - far);
  }
  return out;
}

export function lookAt(eye: number[], centre: number[], up: number[]): Mat4 {
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const norm = (a: number[]) => {
    const length = Math.hypot(...a);
    return a.map((v) => v / length);
  };
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, centre));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
}

export interface Camera {
  /** Rotation about the vertical axis, radians. */
  yaw: number;
  /** Elevation above the floor, radians. */
  pitch: number;
  distance: number;
}

export const DEFAULT_CAMERA: Camera = { yaw: -0.55, pitch: 0.5, distance: 5 };

export function viewProjection(camera: Camera, aspect: number, zeroToOne: boolean): Mat4 {
  const { yaw, pitch, distance } = camera;
  const eye = [
    distance * Math.cos(pitch) * Math.sin(yaw),
    distance * Math.sin(pitch),
    distance * Math.cos(pitch) * Math.cos(yaw),
  ];
  // Narrow screens need a wider lens to keep the whole box in frame.
  // Keep the horizontal field of a 16:9 view on narrow screens, so the whole box stays in frame.
  const fov = 2 * Math.atan(Math.max(Math.tan(0.31), (Math.tan(0.31) * 1.2) / aspect));
  return multiply(
    perspective(fov, aspect, 0.1, 20, zeroToOne),
    lookAt(eye, [0, -0.12, 0.05], [0, 1, 0]),
  );
}

/** Projects a model-space point to CSS pixels; depth is clip w (larger is further). */
export function project(
  matrix: Mat4,
  point: [number, number, number],
  width: number,
  height: number,
): { x: number; y: number; depth: number } {
  const [x, y, z] = point;
  const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const cw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  return { x: ((cx / cw + 1) / 2) * width, y: ((1 - cy / cw) / 2) * height, depth: cw };
}
