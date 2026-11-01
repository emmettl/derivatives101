// Draws the Greeks surface: one vertex per (spot, time) grid point, lit from
// above-left, with spot and time grid lines, the barrier and strike, the
// selected time slice and the selected point drawn in the fragment shader.

struct Uniforms {
  mvp: mat4x4<f32>,
  // xyz: direction towards the light, w: ambient share.
  light: vec4<f32>,
  // barrier spot, strike spot, slice time (fraction of tenor), unused.
  lines: vec4<f32>,
  // marker spot, marker time, marker radius in spot units, unused.
  marker: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  // x: spot in % of initial, y: time to maturity as a fraction of tenor.
  // Axis lines carry x < 0 and are drawn flat.
  @location(3) grid: vec2<f32>,
};

struct VertexOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec3<f32>,
  @location(2) grid: vec2<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.clip = u.mvp * vec4<f32>(input.position, 1.0);
  out.normal = input.normal;
  out.color = input.color;
  out.grid = input.grid;
  return out;
}

// 1 on a line of the given half-width (in pixels) through value == level.
fn line_at(value: f32, level: f32, width: f32) -> f32 {
  let d = abs(value - level) / max(fwidth(value), 1e-6);
  return 1.0 - smoothstep(width - 0.5, width + 0.5, d);
}

// 1 on any multiple of step.
fn grid_line(value: f32, step: f32, width: f32) -> f32 {
  let scaled = value / step;
  let d = abs(fract(scaled - 0.5) - 0.5) / max(fwidth(scaled), 1e-6);
  return 1.0 - smoothstep(width - 0.5, width + 0.5, d);
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  // Derivatives first, while control flow is still uniform.
  let spotGrid = grid_line(input.grid.x, 10.0, 0.6);
  let timeGrid = grid_line(input.grid.y, 0.25, 0.6);
  let barrier = line_at(input.grid.x, u.lines.x, 1.2);
  let strike = line_at(input.grid.x, u.lines.y, 0.9);
  let slice = line_at(input.grid.y, u.lines.z, 1.3);

  if (input.grid.x < 0.0) {
    return vec4<f32>(input.color, 1.0);
  }

  let n = normalize(input.normal);
  let diffuse = abs(dot(n, normalize(u.light.xyz)));
  var color = input.color * (u.light.w + (1.0 - u.light.w) * diffuse);
  color = mix(color, color * 0.72, max(spotGrid, timeGrid) * 0.6);
  color = mix(color, vec3<f32>(0.043, 0.118, 0.176), strike * 0.75);
  color = mix(color, vec3<f32>(0.710, 0.267, 0.227), barrier);
  color = mix(color, vec3<f32>(0.894, 0.639, 0.251), slice);

  let offset = vec2<f32>((input.grid.x - u.marker.x) / u.marker.z, (input.grid.y - u.marker.y) * 100.0 / u.marker.z);
  let r = length(offset);
  let ring = 1.0 - smoothstep(0.75, 1.0, r);
  color = mix(color, vec3<f32>(0.043, 0.118, 0.176), ring);
  color = mix(color, vec3<f32>(1.0, 1.0, 1.0), 1.0 - smoothstep(0.35, 0.5, r));
  return vec4<f32>(color, 1.0);
}
