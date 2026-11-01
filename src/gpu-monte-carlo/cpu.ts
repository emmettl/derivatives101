import type { BatchSums, McParams } from "./engine";

/** Runs the double-precision path loop in a background thread, one batch at a time. */
export class CpuPricer {
  private readonly worker: Worker;
  private nextId = 0;
  private readonly pending = new Map<number, (sums: BatchSums) => void>();

  constructor() {
    this.worker = new Worker(new URL("./cpu-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<{ id: number; sums: BatchSums }>) => {
      const resolve = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      resolve?.(event.data.sums);
    };
  }

  run(params: McParams, offset: number, count: number): Promise<BatchSums> {
    const id = (this.nextId += 1);
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, params, offset, count });
    });
  }
}
