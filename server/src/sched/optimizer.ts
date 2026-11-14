// FSRS parameter optimizer: fits the 21 FSRS-6 parameters to a user's review
// history by minimising log-loss with Adam (finite-difference gradients).
import { FSRS, FSRS6_DEFAULT_PARAMS, PARAM_BOUNDS, clipParams } from "./fsrs";

/** One card's history: [deltaDays, rating] pairs, first entry is the first review. */
export type Sequence = [number, number][];

export interface OptimizeResult {
  params: number[];
  logLoss: number;
  rmse: number;
  defaultLogLoss: number;
  defaultRmse: number;
  reviews: number;
  sequences: number;
  improved: boolean;
}

function evalSequences(params: number[], seqs: Sequence[]): { loss: number; n: number; preds: [number, number][] } {
  const f = new FSRS(params);
  let loss = 0;
  let n = 0;
  const preds: [number, number][] = [];
  for (const seq of seqs) {
    let mem = null as { stability: number; difficulty: number } | null;
    for (let i = 0; i < seq.length; i++) {
      const [dt, rating] = seq[i];
      if (mem && dt > 0) {
        const r = Math.min(Math.max(f.retrievability(dt, mem.stability), 1e-4), 1 - 1e-4);
        const y = rating > 1 ? 1 : 0;
        loss += -(y * Math.log(r) + (1 - y) * Math.log(1 - r));
        n++;
        preds.push([r, y]);
      }
      mem = f.nextState(mem, i === 0 ? 0 : dt, rating);
    }
  }
  return { loss: n ? loss / n : 0, n, preds };
}

function rmseBins(preds: [number, number][]): number {
  const bins = new Map<number, { p: number; y: number; n: number }>();
  for (const [p, y] of preds) {
    const k = Math.round(p * 20);
    const b = bins.get(k) ?? { p: 0, y: 0, n: 0 };
    b.p += p;
    b.y += y;
    b.n++;
    bins.set(k, b);
  }
  let se = 0,
    total = 0;
  for (const b of bins.values()) {
    se += Math.pow(b.p / b.n - b.y / b.n, 2) * b.n;
    total += b.n;
  }
  return total ? Math.sqrt(se / total) : 0;
}

export function evaluate(params: number[], seqs: Sequence[]) {
  const e = evalSequences(params, seqs);
  return { logLoss: e.loss, rmse: rmseBins(e.preds), reviews: e.n };
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function optimize(seqs: Sequence[], init: number[] = [...FSRS6_DEFAULT_PARAMS], opts: { steps?: number; batch?: number; onProgress?: (p: number) => void } = {}): OptimizeResult {
  const usable = seqs.filter((s) => s.length >= 2 && s.slice(1).some(([dt]) => dt > 0));
  const reviews = usable.reduce((a, s) => a + s.slice(1).filter(([dt]) => dt > 0).length, 0);
  const base = evaluate([...FSRS6_DEFAULT_PARAMS], usable);
  if (reviews < 100) {
    return { params: [...init], logLoss: base.logLoss, rmse: base.rmse, defaultLogLoss: base.logLoss, defaultRmse: base.rmse, reviews, sequences: usable.length, improved: false };
  }
  const rand = mulberry(42);
  const steps = opts.steps ?? 160;
  const batch = Math.min(opts.batch ?? 600, usable.length);
  let p = clipParams([...init]);
  const m = new Array(21).fill(0);
  const v = new Array(21).fill(0);
  const lr = 0.04;
  const b1 = 0.9,
    b2 = 0.999,
    eps = 1e-8;
  const prior = [...FSRS6_DEFAULT_PARAMS];
  const reg = 0.0005;
  const lossFn = (params: number[], sample: Sequence[]) =>
    evalSequences(params, sample).loss + reg * params.reduce((a, x, i) => a + Math.pow((x - prior[i]) / Math.max(0.1, PARAM_BOUNDS[i][1] - PARAM_BOUNDS[i][0]), 2), 0);
  for (let step = 1; step <= steps; step++) {
    const sample: Sequence[] = [];
    for (let i = 0; i < batch; i++) sample.push(usable[Math.floor(rand() * usable.length)]);
    const grad = new Array(21).fill(0);
    for (let i = 0; i < 21; i++) {
      const range = PARAM_BOUNDS[i][1] - PARAM_BOUNDS[i][0];
      const h = Math.max(1e-4, range * 1e-3);
      const up = [...p];
      const dn = [...p];
      up[i] = Math.min(PARAM_BOUNDS[i][1], p[i] + h);
      dn[i] = Math.max(PARAM_BOUNDS[i][0], p[i] - h);
      if (up[i] === dn[i]) continue;
      grad[i] = (lossFn(up, sample) - lossFn(dn, sample)) / (up[i] - dn[i]);
    }
    const lrStep = lr * (0.5 * (1 + Math.cos((Math.PI * step) / steps))); // cosine decay
    for (let i = 0; i < 21; i++) {
      m[i] = b1 * m[i] + (1 - b1) * grad[i];
      v[i] = b2 * v[i] + (1 - b2) * grad[i] * grad[i];
      const mh = m[i] / (1 - Math.pow(b1, step));
      const vh = v[i] / (1 - Math.pow(b2, step));
      const scale = Math.max(0.05, PARAM_BOUNDS[i][1] - PARAM_BOUNDS[i][0]) * 0.1;
      p[i] -= lrStep * scale * (mh / (Math.sqrt(vh) + eps));
    }
    p = clipParams(p);
    if (opts.onProgress && step % 10 === 0) opts.onProgress(step / steps);
  }
  const fin = evaluate(p, usable);
  const improved = fin.logLoss < base.logLoss;
  const rounded = (improved ? p : [...FSRS6_DEFAULT_PARAMS]).map((x) => Math.round(x * 10000) / 10000);
  return {
    params: rounded,
    logLoss: improved ? fin.logLoss : base.logLoss,
    rmse: improved ? fin.rmse : base.rmse,
    defaultLogLoss: base.logLoss,
    defaultRmse: base.rmse,
    reviews,
    sequences: usable.length,
    improved,
  };
}
