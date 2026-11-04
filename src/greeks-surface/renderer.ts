import { SPOT_MAX, SPOT_MIN, type SurfaceGrid } from "./engine";
import { VERTEX_BYTES, VERTEX_FLOATS, viewProjection, type Camera, type Mesh } from "./mesh";
import shaderSource from "./surface.wgsl?raw";

export { shaderSource };

export type RendererKind = "webgpu" | "webgl" | "canvas";

export interface Scene {
  grid: SurfaceGrid;
  values: Float64Array;
  mesh: Mesh;
  /** Bumped whenever mesh changes, so GPU buffers are uploaded only then. */
  version: number;
  camera: Camera;
  barrier: number;
  strike: number;
  /** Selected time slice as a fraction of tenor. */
  slice: number;
  markerSpot: number;
  markerTime: number;
}

export interface Renderer {
  readonly kind: RendererKind;
  readonly label: string;
  /** True when the surface is drawn in 3D and labels/picking use the camera. */
  readonly threeD: boolean;
  /** True when clip-space depth runs 0..1 (WebGPU) rather than -1..1. */
  readonly zeroToOne: boolean;
  draw(scene: Scene, width: number, height: number, dpr: number): void;
  /** Present for flat renderers: maps CSS pixels to spot and time fraction. */
  pick?(x: number, y: number, width: number, height: number): { spot: number; time: number } | null;
}

const BACKGROUND = { r: 1, g: 1, b: 1 };
const LIGHT = [-0.45, 0.85, 0.35, 0.42];
const MARKER_RADIUS = 1.6;

function uniformData(scene: Scene, aspect: number, zeroToOne: boolean): Float32Array {
  const data = new Float32Array(32);
  data.set(viewProjection(scene.camera, aspect, zeroToOne), 0);
  data.set(LIGHT, 16);
  data.set([scene.barrier, scene.strike, scene.slice, 0], 20);
  data.set([scene.markerSpot, scene.markerTime, MARKER_RADIUS, 0], 24);
  return data;
}

// ---------------------------------------------------------------------------
// WebGPU

const BUFFER_VERTEX = 0x0020;
const BUFFER_INDEX = 0x0010;
const BUFFER_UNIFORM = 0x0040;
const BUFFER_COPY_DST = 0x0008;
const BUFFER_MAP_READ = 0x0001;
const MAP_READ = 0x0001;
const TEXTURE_COPY_SRC = 0x01;
const TEXTURE_RENDER_ATTACHMENT = 0x10;
const SAMPLES = 4;

export class WebGpuRenderer implements Renderer {
  readonly kind = "webgpu";
  readonly threeD = true;
  readonly zeroToOne = true;
  private vertexBuffer: GPUBuffer | null = null;
  private indexBuffer: GPUBuffer | null = null;
  private lineBuffer: GPUBuffer | null = null;
  private indexCount = 0;
  private lineCount = 0;
  private version = -1;
  private colorTexture: GPUTexture | null = null;
  private depthTexture: GPUTexture | null = null;
  private offscreen: GPUTexture | null = null;
  private size = "";
  lost = false;
  /** Called once if the GPU device is lost or rejects a command, so the page can fall back. */
  onLost: (() => void) | null = null;

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext | null,
    private readonly format: GPUTextureFormat,
    private readonly surfacePipeline: GPURenderPipeline,
    private readonly linePipeline: GPURenderPipeline,
    private readonly uniformBuffer: GPUBuffer,
    private readonly bindGroup: GPUBindGroup,
    readonly label: string,
  ) {
    const fail = (reason: string) => {
      if (this.lost) return;
      console.info(`WebGPU renderer stopped: ${reason}`);
      this.lost = true;
      this.onLost?.();
    };
    device.lost.then((info) => fail(info.message || info.reason));
    device.addEventListener("uncapturederror", (event) =>
      fail((event as GPUUncapturedErrorEvent).error.message),
    );
  }

  /**
   * With a canvas, draws to it. With null, draws to an offscreen texture that
   * readPixels returns, which lets tests check the shader without a display.
   */
  static async create(canvas: HTMLCanvasElement | null): Promise<WebGpuRenderer | null> {
    try {
      if (!("gpu" in navigator) || !navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      let context: GPUCanvasContext | null = null;
      let format: GPUTextureFormat = "rgba8unorm";
      if (canvas) {
        context = canvas.getContext("webgpu") as GPUCanvasContext | null;
        if (!context) return null;
        format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: "opaque" });
      }
      const module = device.createShaderModule({ code: shaderSource });
      const vertex: GPUVertexState = {
        module,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: VERTEX_BYTES,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
              { shaderLocation: 2, offset: 24, format: "float32x3" },
              { shaderLocation: 3, offset: 36, format: "float32x2" },
            ],
          },
        ],
      };
      const shared = {
        layout: "auto" as const,
        vertex,
        fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
        depthStencil: {
          format: "depth24plus" as GPUTextureFormat,
          depthWriteEnabled: true,
          depthCompare: "less" as GPUCompareFunction,
        },
        multisample: { count: SAMPLES },
      };
      const surfacePipeline = await device.createRenderPipelineAsync({
        ...shared,
        primitive: { topology: "triangle-list", cullMode: "none" },
      });
      const linePipeline = await device.createRenderPipelineAsync({
        ...shared,
        primitive: { topology: "line-list" },
      });
      const uniformBuffer = device.createBuffer({
        size: 128,
        usage: BUFFER_UNIFORM | BUFFER_COPY_DST,
      });
      // "auto" layouts are per pipeline, so each pipeline gets its own bind group.
      const bindGroup = device.createBindGroup({
        layout: surfacePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      const info = adapter.info;
      const label =
        [info?.vendor, info?.architecture].filter(Boolean).join(" ") || info?.description || "";
      const renderer = new WebGpuRenderer(
        device,
        context,
        format,
        surfacePipeline,
        linePipeline,
        uniformBuffer,
        bindGroup,
        label,
      );
      renderer.lineBindGroup = device.createBindGroup({
        layout: linePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
      });
      return renderer;
    } catch {
      return null;
    }
  }

  private lineBindGroup: GPUBindGroup | null = null;

  private upload(scene: Scene): void {
    if (scene.version === this.version) return;
    this.version = scene.version;
    const make = (data: Float32Array | Uint32Array, usage: number, old: GPUBuffer | null) => {
      if (old && old.size >= data.byteLength) {
        this.device.queue.writeBuffer(old, 0, data);
        return old;
      }
      old?.destroy();
      const buffer = this.device.createBuffer({
        size: data.byteLength,
        usage: usage | BUFFER_COPY_DST,
      });
      this.device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    };
    this.vertexBuffer = make(scene.mesh.vertices, BUFFER_VERTEX, this.vertexBuffer);
    this.indexBuffer = make(scene.mesh.indices, BUFFER_INDEX, this.indexBuffer);
    this.lineBuffer = make(scene.mesh.lines, BUFFER_VERTEX, this.lineBuffer);
    this.indexCount = scene.mesh.indices.length;
    this.lineCount = scene.mesh.lines.length / VERTEX_FLOATS;
  }

  private targets(width: number, height: number): void {
    const key = `${width}x${height}`;
    if (key === this.size && this.colorTexture && this.depthTexture) return;
    this.size = key;
    this.colorTexture?.destroy();
    this.depthTexture?.destroy();
    this.offscreen?.destroy();
    this.offscreen = this.context
      ? null
      : this.device.createTexture({
          size: [width, height],
          format: this.format,
          usage: TEXTURE_RENDER_ATTACHMENT | TEXTURE_COPY_SRC,
        });
    this.colorTexture = this.device.createTexture({
      size: [width, height],
      sampleCount: SAMPLES,
      format: this.format,
      usage: TEXTURE_RENDER_ATTACHMENT,
    });
    this.depthTexture = this.device.createTexture({
      size: [width, height],
      sampleCount: SAMPLES,
      format: "depth24plus",
      usage: TEXTURE_RENDER_ATTACHMENT,
    });
  }

  draw(scene: Scene, width: number, height: number, dpr: number): void {
    if (this.lost) return;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    const canvas = this.context?.canvas as HTMLCanvasElement | undefined;
    if (canvas && (canvas.width !== pixelWidth || canvas.height !== pixelHeight)) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    this.upload(scene);
    this.targets(pixelWidth, pixelHeight);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData(scene, width / height, true));
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.colorTexture!.createView(),
          resolveTarget: (this.context?.getCurrentTexture() ?? this.offscreen!).createView(),
          clearValue: { ...BACKGROUND, a: 1 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture!.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    pass.setPipeline(this.surfacePipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer!);
    pass.setIndexBuffer(this.indexBuffer!, "uint32");
    pass.drawIndexed(this.indexCount);
    pass.setPipeline(this.linePipeline);
    pass.setBindGroup(0, this.lineBindGroup!);
    pass.setVertexBuffer(0, this.lineBuffer!);
    pass.draw(this.lineCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** RGBA bytes of the last offscreen draw. */
  async readPixels(): Promise<{ width: number; height: number; data: Uint8Array }> {
    const texture = this.offscreen;
    if (!texture) throw new Error("readPixels needs an offscreen renderer");
    const { width, height } = texture;
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
    const buffer = this.device.createBuffer({
      size: bytesPerRow * height,
      usage: BUFFER_COPY_DST | BUFFER_MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(MAP_READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const data = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row += 1)
      data.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + width * 4), row * width * 4);
    buffer.unmap();
    buffer.destroy();
    return { width, height, data };
  }
}

// ---------------------------------------------------------------------------
// WebGL 2: the same mesh and the same shading, written in GLSL.

const GLSL_VERTEX = `#version 300 es
uniform mat4 u_mvp;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;
layout(location = 3) in vec2 a_grid;
out vec3 v_normal;
out vec3 v_color;
out vec2 v_grid;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_normal = a_normal;
  v_color = a_color;
  v_grid = a_grid;
}`;

const GLSL_FRAGMENT = `#version 300 es
precision highp float;
uniform vec4 u_light;
uniform vec4 u_lines;
uniform vec4 u_marker;
in vec3 v_normal;
in vec3 v_color;
in vec2 v_grid;
out vec4 color_out;
float line_at(float value, float level, float width) {
  float d = abs(value - level) / max(fwidth(value), 1e-6);
  return 1.0 - smoothstep(width - 0.5, width + 0.5, d);
}
float grid_line(float value, float step, float width) {
  float scaled = value / step;
  float d = abs(fract(scaled - 0.5) - 0.5) / max(fwidth(scaled), 1e-6);
  return 1.0 - smoothstep(width - 0.5, width + 0.5, d);
}
void main() {
  float spotGrid = grid_line(v_grid.x, 10.0, 0.6);
  float timeGrid = grid_line(v_grid.y, 0.25, 0.6);
  float barrier = line_at(v_grid.x, u_lines.x, 1.2);
  float strike = line_at(v_grid.x, u_lines.y, 0.9);
  float slice = line_at(v_grid.y, u_lines.z, 1.3);
  if (v_grid.x < 0.0) { color_out = vec4(v_color, 1.0); return; }
  vec3 n = normalize(v_normal);
  float diffuse = abs(dot(n, normalize(u_light.xyz)));
  vec3 color = v_color * (u_light.w + (1.0 - u_light.w) * diffuse);
  color = mix(color, color * 0.72, max(spotGrid, timeGrid) * 0.6);
  color = mix(color, vec3(0.043, 0.118, 0.176), strike * 0.75);
  color = mix(color, vec3(0.710, 0.267, 0.227), barrier);
  color = mix(color, vec3(0.894, 0.639, 0.251), slice);
  vec2 offset = vec2((v_grid.x - u_marker.x) / u_marker.z, (v_grid.y - u_marker.y) * 100.0 / u_marker.z);
  float r = length(offset);
  color = mix(color, vec3(0.043, 0.118, 0.176), 1.0 - smoothstep(0.75, 1.0, r));
  color = mix(color, vec3(1.0), 1.0 - smoothstep(0.35, 0.5, r));
  color_out = vec4(color, 1.0);
}`;

export class WebGlRenderer implements Renderer {
  readonly kind = "webgl";
  readonly threeD = true;
  readonly zeroToOne = false;
  private version = -1;
  private indexCount = 0;
  private lineCount = 0;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private readonly surfaceVao: WebGLVertexArrayObject;
  private readonly lineVao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly lineBuffer: WebGLBuffer;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly program: WebGLProgram,
    readonly label: string,
  ) {
    this.uniforms = Object.fromEntries(
      ["u_mvp", "u_light", "u_lines", "u_marker"].map((name) => [
        name,
        gl.getUniformLocation(program, name),
      ]),
    );
    this.vertexBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;
    this.lineBuffer = gl.createBuffer()!;
    this.surfaceVao = this.vao(this.vertexBuffer, this.indexBuffer);
    this.lineVao = this.vao(this.lineBuffer, null);
  }

  static create(canvas: HTMLCanvasElement): WebGlRenderer | null {
    try {
      const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
      if (!gl) return null;
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed to compile");
        return shader;
      };
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, GLSL_VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, GLSL_FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const label = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
      return new WebGlRenderer(gl, program, label);
    } catch {
      return null;
    }
  }

  private vao(buffer: WebGLBuffer, indices: WebGLBuffer | null): WebGLVertexArrayObject {
    const { gl } = this;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    [3, 3, 3, 2].reduce((offset, size, location) => {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, VERTEX_BYTES, offset * 4);
      return offset + size;
    }, 0);
    if (indices) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bindVertexArray(null);
    return vao;
  }

  draw(scene: Scene, width: number, height: number, dpr: number): void {
    const { gl } = this;
    if (gl.isContextLost()) return;
    const canvas = gl.canvas as HTMLCanvasElement;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    if (scene.version !== this.version) {
      this.version = scene.version;
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, scene.mesh.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.mesh.indices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, scene.mesh.lines, gl.STATIC_DRAW);
      this.indexCount = scene.mesh.indices.length;
      this.lineCount = scene.mesh.lines.length / VERTEX_FLOATS;
    }
    const data = uniformData(scene, width / height, false);
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clearColor(BACKGROUND.r, BACKGROUND.g, BACKGROUND.b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.u_mvp, false, data.subarray(0, 16));
    gl.uniform4fv(this.uniforms.u_light, data.subarray(16, 20));
    gl.uniform4fv(this.uniforms.u_lines, data.subarray(20, 24));
    gl.uniform4fv(this.uniforms.u_marker, data.subarray(24, 28));
    gl.bindVertexArray(this.surfaceVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(this.lineVao);
    gl.drawArrays(gl.LINES, 0, this.lineCount);
    gl.bindVertexArray(null);
  }
}

// ---------------------------------------------------------------------------
// Canvas 2D: a flat heat map of the same numbers when no GPU API is available.

/** Room around the flat heat map for the HTML axis labels. */
export const MAP_MARGIN = { left: 10, right: 64, top: 10, bottom: 44 };

export class CanvasRenderer implements Renderer {
  readonly kind = "canvas";
  readonly label = "";
  readonly threeD = false;
  readonly zeroToOne = false;

  constructor(private readonly context: CanvasRenderingContext2D) {}

  static create(canvas: HTMLCanvasElement): CanvasRenderer | null {
    const context = canvas.getContext("2d");
    return context ? new CanvasRenderer(context) : null;
  }

  pick(x: number, y: number, width: number, height: number) {
    const plotWidth = width - MAP_MARGIN.left - MAP_MARGIN.right;
    const plotHeight = height - MAP_MARGIN.top - MAP_MARGIN.bottom;
    const u = (x - MAP_MARGIN.left) / plotWidth;
    const v = (y - MAP_MARGIN.top) / plotHeight;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { spot: SPOT_MIN + u * (SPOT_MAX - SPOT_MIN), time: 1 - v };
  }

  draw(scene: Scene, width: number, height: number, dpr: number): void {
    const { context } = this;
    const canvas = context.canvas;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    const { grid, values, mesh } = scene;
    const columns = grid.spots.length;
    const rows = grid.times.length;
    const tenor = grid.times[0];
    const plotWidth = width - MAP_MARGIN.left - MAP_MARGIN.right;
    const plotHeight = height - MAP_MARGIN.top - MAP_MARGIN.bottom;
    const x = (spot: number) =>
      MAP_MARGIN.left + ((spot - SPOT_MIN) / (SPOT_MAX - SPOT_MIN)) * plotWidth;
    // Time to maturity runs down the page, maturity at the bottom like the 3D front edge.
    const y = (fraction: number) => MAP_MARGIN.top + (1 - fraction) * plotHeight;
    const cellWidth = plotWidth / (columns - 1) + 0.6;
    for (let j = 0; j < rows; j += 1) {
      const top = y(grid.times[j] / tenor);
      const bottom = j + 1 < rows ? y(grid.times[j + 1] / tenor) : y(0);
      for (let i = 0; i < columns; i += 1) {
        const [r, g, b] = mesh.color(values[j * columns + i]);
        context.fillStyle = `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
        context.fillRect(x(grid.spots[i]) - cellWidth / 2, top, cellWidth, bottom - top + 0.6);
      }
    }
    context.lineWidth = 2;
    context.strokeStyle = "#b5443a";
    context.beginPath();
    context.moveTo(x(scene.barrier), y(1));
    context.lineTo(x(scene.barrier), y(0));
    context.stroke();
    context.strokeStyle = "#0b1e2d";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(x(scene.strike), y(1));
    context.lineTo(x(scene.strike), y(0));
    context.stroke();
    context.strokeStyle = "#e4a340";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x(SPOT_MIN), y(scene.slice));
    context.lineTo(x(SPOT_MAX), y(scene.slice));
    context.stroke();
    context.fillStyle = "#fff";
    context.strokeStyle = "#0b1e2d";
    context.beginPath();
    context.arc(x(scene.markerSpot), y(scene.markerTime), 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

export async function createRenderer(
  canvas: HTMLCanvasElement,
  prefer: RendererKind | null = null,
): Promise<Renderer | null> {
  // A canvas keeps the first context type it hands out, so each attempt gets a fresh one.
  const fresh = () => {
    const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(replacement);
    canvas = replacement;
    return replacement;
  };
  // A canvas that already had a context (say, a WebGPU one that lost its device) can't switch.
  if (prefer) fresh();
  if (prefer !== "webgl" && prefer !== "canvas") {
    const gpu = await WebGpuRenderer.create(canvas);
    if (gpu) return gpu;
    fresh();
  }
  if (prefer !== "canvas") {
    const gl = WebGlRenderer.create(canvas);
    if (gl) return gl;
    fresh();
  }
  return CanvasRenderer.create(canvas);
}
