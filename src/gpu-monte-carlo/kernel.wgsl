// Worst-of knock-in put: one GPU thread simulates one complete path.
//
// Every thread draws its own random numbers from a counter-based generator
// seeded by its path number, so no two threads share state and the CPU can
// reproduce any path exactly. Each workgroup of 256 threads then adds up its
// paths in fast on-chip memory and writes a single partial sum, so the CPU
// only reads back one small vector per 256 paths.

struct Params {
  pathOffset: u32,
  pathCount: u32,
  assets: u32,
  steps: u32,
  seed: u32,
  continuous: u32,
  pad0: u32,
  pad1: u32,
  drift: f32,       // (r - sigma^2 / 2) dt
  volSqrtDt: f32,   // sigma sqrt(dt)
  logBarrier: f32,  // ln(barrier / initial)
  strike: f32,      // % of initial
  bridgeScale: f32, // 2 / (sigma^2 dt)
  pad2: f32,
  pad3: f32,
  pad4: f32,
  chol: array<vec4<f32>, 3>, // rows of the Cholesky factor of the correlation matrix
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> partials: array<vec4<f32>>;

var<workgroup> scratch: array<vec4<f32>, 256>;
var<private> rngState: u32;

fn pcgOutput(state: u32) -> u32 {
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn pcgHash(value: u32) -> u32 {
  return pcgOutput(value * 747796405u + 2891336453u);
}

fn uniform01() -> f32 {
  rngState = rngState * 747796405u + 2891336453u;
  return (f32(pcgOutput(rngState) >> 8u) + 0.5) * (1.0 / 16777216.0);
}

// Box-Muller: two uniforms in, two independent standard normals out.
fn normalPair() -> vec2<f32> {
  let u1 = uniform01();
  let u2 = uniform01();
  let radius = sqrt(-2.0 * log(u1));
  let angle = 6.283185307179586 * u2;
  return vec2<f32>(radius * cos(angle), radius * sin(angle));
}

@compute @workgroup_size(256)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_index) lid: u32,
  @builtin(workgroup_id) wid: vec3<u32>,
) {
  var result = vec4<f32>(0.0);

  if (gid.x < params.pathCount) {
    rngState = pcgHash((params.pathOffset + gid.x) ^ pcgHash(params.seed));

    var x = vec3<f32>(0.0);  // log performance of each underlying
    var survive = 1.0;       // probability the barrier has not been touched

    for (var step = 0u; step < params.steps; step++) {
      let first = normalPair();
      var z = vec3<f32>(first, 0.0);
      if (params.assets == 3u) {
        z.z = normalPair().x;
      }
      // Correlate the independent shocks with the Cholesky factor.
      let shock = vec3<f32>(
        dot(params.chol[0].xyz, z),
        dot(params.chol[1].xyz, z),
        dot(params.chol[2].xyz, z),
      );
      let next = x + vec3<f32>(params.drift) + params.volSqrtDt * shock;

      for (var asset = 0u; asset < params.assets; asset++) {
        let before = x[asset] - params.logBarrier;
        let after = next[asset] - params.logBarrier;
        if (after <= 0.0) {
          survive = 0.0; // closed at or below the barrier
        } else if (params.continuous == 1u) {
          // Brownian bridge: chance the path dipped through between closes.
          survive *= 1.0 - exp(-params.bridgeScale * before * after);
        }
      }
      x = next;
    }

    var worst = x.x;
    if (params.assets >= 2u) { worst = min(worst, x.y); }
    if (params.assets == 3u) { worst = min(worst, x.z); }

    let knockIn = 1.0 - survive;
    let payoff = max(params.strike - 100.0 * exp(worst), 0.0) * knockIn;
    result = vec4<f32>(payoff, payoff * payoff, knockIn, 1.0);
  }

  // Tree reduction in workgroup memory: 256 -> 128 -> ... -> 1.
  scratch[lid] = result;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride >>= 1u) {
    if (lid < stride) {
      scratch[lid] += scratch[lid + stride];
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    partials[wid.x] = scratch[0];
  }
}
