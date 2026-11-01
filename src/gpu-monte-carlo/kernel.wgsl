// Worst-of knock-in put: one GPU thread simulates one complete path.
//
// Each path is priced twice in the same loop: as the plain barrier reverse
// convertible, and with the lock-in and autocall terms switched on, so the
// difference between the two is the features and not sampling noise.
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
  callEvery: u32,   // steps between quarterly autocall observations
  pad0: u32,
  drift: f32,       // (r - sigma^2 / 2) dt
  volSqrtDt: f32,   // sigma sqrt(dt)
  logBarrier: f32,  // ln(barrier / initial)
  strike: f32,      // % of initial
  bridgeScale: f32, // 2 / (sigma^2 dt)
  logLock: f32,     // ln(lock-in level); 1e9 when there is no lock-in
  pad1: f32,
  pad2: f32,
  chol: array<vec4<f32>, 3>, // rows of the Cholesky factor of the correlation matrix
  logTriggers: vec4<f32>,    // ln(autocall trigger) per quarter; 1e9 when off
}

// Three vec4 per path, summed per workgroup:
//   0: payoff, payoff^2, knock-in that bites, 1        (with lock-in and autocall)
//   1: payoff, payoff^2, knock-in, locked              (plain note; lock count)
//   2: called at quarter 1, 2, 3, unused
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> partials: array<vec4<f32>>;

var<workgroup> scratch0: array<vec4<f32>, 256>;
var<workgroup> scratch1: array<vec4<f32>, 256>;
var<workgroup> scratch2: array<vec4<f32>, 256>;
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
  var featured = vec4<f32>(0.0);
  var plain = vec4<f32>(0.0);
  var calls = vec4<f32>(0.0);

  if (gid.x < params.pathCount) {
    rngState = pcgHash((params.pathOffset + gid.x) ^ pcgHash(params.seed));

    var x = vec3<f32>(0.0);  // log performance of each underlying
    var survive = 1.0;       // probability the barrier has not been touched
    var locked = false;
    var calledAt = 0u;       // quarter of an early call, 0 if none

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
      var worstToday = next.x;
      if (params.assets >= 2u) { worstToday = min(worstToday, next.y); }
      if (params.assets == 3u) { worstToday = min(worstToday, next.z); }

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

      // Lock-in on any daily close; autocall on the quarterly closes. After a
      // call the note is gone, so later days no longer change it.
      let day = step + 1u;
      if (calledAt == 0u) {
        if (worstToday >= params.logLock) { locked = true; }
        let quarter = day / params.callEvery;
        if (day % params.callEvery == 0u && quarter < 4u && worstToday >= params.logTriggers[quarter - 1u]) {
          calledAt = quarter;
        }
      }
    }

    var worst = x.x;
    if (params.assets >= 2u) { worst = min(worst, x.y); }
    if (params.assets == 3u) { worst = min(worst, x.z); }

    let knockIn = 1.0 - survive;
    let payoff = max(params.strike - 100.0 * exp(worst), 0.0) * knockIn;
    let live = calledAt == 0u && !locked;
    let finalTrigger = calledAt == 0u && worst >= params.logTriggers.w;
    let bites = select(0.0, 1.0, live);
    let featuredPayoff = select(0.0, payoff, live && !finalTrigger);
    featured = vec4<f32>(featuredPayoff, featuredPayoff * featuredPayoff, knockIn * bites, 1.0);
    plain = vec4<f32>(payoff, payoff * payoff, knockIn, select(0.0, 1.0, locked && calledAt == 0u));
    if (calledAt > 0u) { calls[calledAt - 1u] = 1.0; }
  }

  // Tree reduction in workgroup memory: 256 -> 128 -> ... -> 1.
  scratch0[lid] = featured;
  scratch1[lid] = plain;
  scratch2[lid] = calls;
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride >>= 1u) {
    if (lid < stride) {
      scratch0[lid] += scratch0[lid + stride];
      scratch1[lid] += scratch1[lid + stride];
      scratch2[lid] += scratch2[lid + stride];
    }
    workgroupBarrier();
  }
  if (lid == 0u) {
    partials[wid.x * 3u] = scratch0[0];
    partials[wid.x * 3u + 1u] = scratch1[0];
    partials[wid.x * 3u + 2u] = scratch2[0];
  }
}
