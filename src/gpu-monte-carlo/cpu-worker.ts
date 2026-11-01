import { simulateBatch, type McParams } from "./engine";

export interface CpuBatchRequest {
  id: number;
  params: McParams;
  offset: number;
  count: number;
}

self.onmessage = (event: MessageEvent<CpuBatchRequest>) => {
  const { id, params, offset, count } = event.data;
  const started = performance.now();
  const sums = simulateBatch(params, offset, count);
  self.postMessage({ id, sums, milliseconds: performance.now() - started });
};
