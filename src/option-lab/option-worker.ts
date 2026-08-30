import { simulatePaths } from "./simulation";
import type { SimulationRequest } from "./types";

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<SimulationRequest>) => void) | null;
  postMessage: (result: ReturnType<typeof simulatePaths>) => void;
};

worker.onmessage = (event) => worker.postMessage(simulatePaths(event.data));
