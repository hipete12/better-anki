// Runs the FSRS optimizer off the main thread so the server stays responsive.
import { optimize, type Sequence } from "./optimizer";

declare const self: Worker;

self.onmessage = (e: MessageEvent<{ seqs: Sequence[]; init: number[] }>) => {
  const res = optimize(e.data.seqs, e.data.init, {
    onProgress: (p) => self.postMessage({ progress: p }),
  });
  self.postMessage({ done: true, result: res });
};
