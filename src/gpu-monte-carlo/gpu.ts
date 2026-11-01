import { emptySums, kernelConstants, type BatchSums, type McParams } from "./engine";
import kernelSource from "./kernel.wgsl?raw";

export { kernelSource };

const WORKGROUP_SIZE = 256;
/** Largest dispatch: short enough that a slow GPU never trips the OS watchdog. */
export const MAX_GPU_BATCH = 262_144;
const MAX_WORKGROUPS = MAX_GPU_BATCH / WORKGROUP_SIZE;
const PARAM_BYTES = 128;
/** Bytes written per workgroup: three vec4<f32> partial sums. */
const PARTIAL_BYTES = 48;

// WebGPU usage flags (spelled out so the module does not depend on globals at load time).
const BUFFER_MAP_READ = 0x0001;
const BUFFER_COPY_SRC = 0x0004;
const BUFFER_COPY_DST = 0x0008;
const BUFFER_UNIFORM = 0x0040;
const BUFFER_STORAGE = 0x0080;
const MAP_READ = 0x0001;

export interface AdapterLabel {
  vendor: string;
  architecture: string;
  description: string;
}

/** Packs the uniform block exactly as `struct Params` lays it out in kernel.wgsl. */
export function packParams(params: McParams, offset: number, count: number): ArrayBuffer {
  const buffer = new ArrayBuffer(PARAM_BYTES);
  const u32 = new Uint32Array(buffer);
  const f32 = new Float32Array(buffer);
  const constants = kernelConstants(params);
  u32[0] = offset;
  u32[1] = count;
  u32[2] = params.assets;
  u32[3] = params.steps;
  u32[4] = params.seed >>> 0;
  u32[5] = params.monitoring === "continuous" ? 1 : 0;
  u32[6] = constants.callEvery;
  f32[8] = constants.drift;
  f32[9] = constants.volSqrtDt;
  f32[10] = constants.logBarrier;
  f32[11] = params.strike;
  f32[12] = constants.bridgeScale;
  f32[13] = constants.logLock;
  for (let row = 0; row < 3; row += 1)
    for (let column = 0; column < 3; column += 1)
      f32[16 + row * 4 + column] = constants.chol[row * 3 + column];
  for (let quarter = 0; quarter < 4; quarter += 1)
    f32[28 + quarter] = constants.logTriggers[quarter];
  return buffer;
}

export class GpuPricer {
  private chain: Promise<unknown> = Promise.resolve();
  lost = false;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    private readonly paramBuffer: GPUBuffer,
    private readonly partialBuffer: GPUBuffer,
    private readonly readBuffer: GPUBuffer,
    private readonly bindGroup: GPUBindGroup,
    readonly adapter: AdapterLabel,
  ) {
    device.lost.then(() => {
      this.lost = true;
    });
  }

  /** Resolves to null whenever WebGPU, an adapter or a device is unavailable. */
  static async create(): Promise<GpuPricer | null> {
    try {
      if (!("gpu" in navigator) || !navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const module = device.createShaderModule({ code: kernelSource });
      const pipeline = await device.createComputePipelineAsync({
        layout: "auto",
        compute: { module, entryPoint: "main" },
      });
      const paramBuffer = device.createBuffer({
        size: PARAM_BYTES,
        usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
      });
      const partialBytes = MAX_WORKGROUPS * PARTIAL_BYTES;
      const partialBuffer = device.createBuffer({
        size: partialBytes,
        usage: BUFFER_STORAGE | BUFFER_COPY_SRC,
      });
      const readBuffer = device.createBuffer({
        size: partialBytes,
        usage: BUFFER_MAP_READ | BUFFER_COPY_DST,
      });
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramBuffer } },
          { binding: 1, resource: { buffer: partialBuffer } },
        ],
      });
      const info = adapter.info;
      return new GpuPricer(device, pipeline, paramBuffer, partialBuffer, readBuffer, bindGroup, {
        vendor: info?.vendor ?? "",
        architecture: info?.architecture ?? "",
        description: info?.description ?? "",
      });
    } catch {
      return null;
    }
  }

  /** Simulates paths [offset, offset + count). Calls are queued, never interleaved. */
  run(params: McParams, offset: number, count: number): Promise<BatchSums> {
    const job = this.chain.then(() => this.dispatch(params, offset, count));
    this.chain = job.catch(() => undefined);
    return job;
  }

  private async dispatch(params: McParams, offset: number, count: number): Promise<BatchSums> {
    if (this.lost) throw new Error("GPU device lost");
    if (count > MAX_GPU_BATCH) throw new Error("Batch too large");
    const workgroups = Math.ceil(count / WORKGROUP_SIZE);
    const bytes = workgroups * PARTIAL_BYTES;
    this.device.queue.writeBuffer(this.paramBuffer, 0, packParams(params, offset, count));
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
    encoder.copyBufferToBuffer(this.partialBuffer, 0, this.readBuffer, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    await this.readBuffer.mapAsync(MAP_READ, 0, bytes);
    const partials = new Float32Array(this.readBuffer.getMappedRange(0, bytes).slice(0));
    this.readBuffer.unmap();
    const sums = emptySums();
    for (let index = 0; index < workgroups; index += 1) {
      const at = index * 12;
      sums.sumPayoff += partials[at];
      sums.sumPayoffSq += partials[at + 1];
      sums.sumKnockIn += partials[at + 2];
      sums.baseSumPayoff += partials[at + 4];
      sums.baseSumPayoffSq += partials[at + 5];
      sums.baseSumKnockIn += partials[at + 6];
      sums.sumLocked += partials[at + 7];
      sums.sumCalled[0] += partials[at + 8];
      sums.sumCalled[1] += partials[at + 9];
      sums.sumCalled[2] += partials[at + 10];
    }
    sums.paths = count;
    return sums;
  }
}
