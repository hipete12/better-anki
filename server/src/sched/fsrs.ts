// FSRS-6 memory model. Formulas follow the reference implementation
// (open-spaced-repetition/ts-fsrs, MIT). Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy.

export const FSRS6_DEFAULT_PARAMS: readonly number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

export const S_MIN = 0.001;
export const S_MAX = 36500;

export const PARAM_BOUNDS: [number, number][] = [
  [S_MIN, 100],
  [S_MIN, 100],
  [S_MIN, 100],
  [S_MIN, 100],
  [1, 10],
  [0.001, 4],
  [0.001, 4],
  [0.001, 0.75],
  [0, 4.5],
  [0, 0.8],
  [0.001, 3.5],
  [0.001, 5],
  [0.001, 0.25],
  [0.001, 0.9],
  [0, 4],
  [0, 1],
  [1, 6],
  [0, 2],
  [0, 2],
  [0.01, 0.8],
  [0.1, 0.8],
];

export interface MemoryState {
  stability: number;
  difficulty: number;
}

const r8 = (x: number) => Math.round(x * 1e8) / 1e8;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Upgrade older parameter sets (FSRS-4.5: 17, FSRS-5: 19) to 21 values. */
export function migrateParams(p: number[] | undefined | null): number[] {
  if (!p || p.length === 0) return [...FSRS6_DEFAULT_PARAMS];
  if (p.length === 21) return [...p];
  if (p.length === 19) return [...p, 0, 0.5];
  if (p.length === 17) {
    const w = [...p];
    // FSRS-4.5 -> 5 conversion used by the reference library
    w[4] = w[5] * 2 + w[4];
    w[5] = Math.log(w[5] * 3 + 1) / 3;
    w[6] = w[6] + 0.5;
    return [...w, 0, 0, 0, 0.5];
  }
  return [...FSRS6_DEFAULT_PARAMS];
}

export function clipParams(p: number[]): number[] {
  return p.map((v, i) => clamp(v, PARAM_BOUNDS[i][0], PARAM_BOUNDS[i][1]));
}

export class FSRS {
  readonly w: number[];
  readonly decay: number;
  readonly factor: number;

  constructor(params?: number[] | null) {
    this.w = migrateParams(params ?? undefined);
    this.decay = -this.w[20];
    this.factor = r8(Math.exp(Math.log(0.9) / this.decay) - 1);
  }

  retrievability(elapsedDays: number, stability: number): number {
    if (stability <= 0) return 0;
    return r8(Math.pow(1 + (this.factor * Math.max(0, elapsedDays)) / stability, this.decay));
  }

  /** Interval (days, unrounded allowed) to hit desired retention. */
  rawInterval(stability: number, desiredRetention: number): number {
    return (stability / this.factor) * (Math.pow(desiredRetention, 1 / this.decay) - 1);
  }

  nextInterval(stability: number, desiredRetention: number, maxIvl = 36500): number {
    return clamp(Math.round(this.rawInterval(stability, desiredRetention)), 1, maxIvl);
  }

  initStability(g: number): number {
    return clamp(this.w[g - 1], S_MIN, S_MAX);
  }

  initDifficulty(g: number): number {
    return r8(this.w[4] - Math.exp((g - 1) * this.w[5]) + 1);
  }

  nextDifficulty(d: number, g: number): number {
    const deltaD = -this.w[6] * (g - 3);
    const nextD = d + r8((deltaD * (10 - d)) / 9);
    const reverted = r8(this.w[7] * this.initDifficulty(4) + (1 - this.w[7]) * nextD);
    return clamp(reverted, 1, 10);
  }

  nextRecallStability(d: number, s: number, r: number, g: number): number {
    const w = this.w;
    const hardPenalty = g === 2 ? w[15] : 1;
    const easyBonus = g === 4 ? w[16] : 1;
    return r8(
      clamp(
        s *
          (1 +
            Math.exp(w[8]) *
              (11 - d) *
              Math.pow(s, -w[9]) *
              (Math.exp((1 - r) * w[10]) - 1) *
              hardPenalty *
              easyBonus),
        S_MIN,
        S_MAX,
      ),
    );
  }

  nextForgetStability(d: number, s: number, r: number): number {
    const w = this.w;
    return r8(
      clamp(w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]), S_MIN, S_MAX),
    );
  }

  nextShortTermStability(s: number, g: number): number {
    const w = this.w;
    const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
    const masked = g >= 2 ? Math.max(sinc, 1) : sinc;
    return r8(clamp(s * masked, S_MIN, S_MAX));
  }

  /** Next memory state after a review with rating g, `elapsedDays` after the last review. */
  nextState(mem: MemoryState | null, elapsedDays: number, g: number): MemoryState {
    if (!mem || (mem.stability === 0 && mem.difficulty === 0)) {
      return { difficulty: clamp(this.initDifficulty(g), 1, 10), stability: this.initStability(g) };
    }
    const d = clamp(mem.difficulty, 1, 10);
    const s = Math.max(mem.stability, S_MIN);
    const t = Math.max(0, elapsedDays);
    const r = this.retrievability(t, s);
    let newS: number;
    if (t === 0) {
      newS = this.nextShortTermStability(s, g);
    } else if (g === 1) {
      const afterFail = this.nextForgetStability(d, s, r);
      const nextSMin = r8(s / Math.exp(this.w[17] * this.w[18]));
      newS = clamp(nextSMin, S_MIN, afterFail);
    } else {
      newS = this.nextRecallStability(d, s, r, g);
    }
    return { difficulty: this.nextDifficulty(d, g), stability: newS };
  }
}

/**
 * Estimate a memory state for a card that has SM-2 history but no FSRS state
 * (e.g. imported from an SM-2 collection): stability ~ interval scaled by retention.
 */
export function memoryFromSm2(ivl: number, factor: number, desiredRetention: number, fsrs: FSRS): MemoryState {
  const s = Math.max(S_MIN, ivl / Math.max(0.01, fsrs.rawInterval(1, desiredRetention)));
  const ease = factor > 0 ? factor / 1000 : 2.5;
  const d = clamp(11 - (ease - 1.3) * 5, 1, 10);
  return { stability: s, difficulty: d };
}
