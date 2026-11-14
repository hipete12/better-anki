// Answering cards: SM-2 (Anki v3 semantics) and FSRS-6 scheduling, learning
// steps, lapses/leeches, fuzz, load balancing and filtered-deck preview.
import type { Collection } from "../collection";
import type { CardRow, DeckConfig } from "../types";
import { CardType, Queue, RevlogType } from "../types";
import { FSRS, memoryFromSm2, type MemoryState } from "./fsrs";
import { clamp, dayNumber, intervalLabel, nowSecs, seededRandom } from "../util";

export type Rating = 1 | 2 | 3 | 4;

export interface Outcome {
  rating: Rating;
  card: CardRow; // resulting card state
  revlog: { ease: number; ivl: number; lastIvl: number; factor: number; type: number };
  /** Seconds until the card is next due (for button labels). */
  dueInSecs: number;
  leech: boolean;
  returnHome: boolean; // leave filtered deck after answering
  previewReturn?: boolean; // non-rescheduling filtered deck: restore original scheduling
}

interface Ctx {
  col: Collection;
  card: CardRow;
  conf: DeckConfig;
  now: number;
  today: number;
  fsrs: FSRS | null;
  dr: number;
  elapsedDays: number;
  prevMem: MemoryState | null;
  inFiltered: boolean;
  reschedule: boolean;
  previewSecs: [number, number, number];
}

function makeCtx(col: Collection, card: CardRow, now: number): Ctx {
  const conf = col.configForCard(card);
  const today = col.today(now);
  const home = col.deck(card.odid || card.did);
  const filteredDeck = card.odid ? col.deck(card.did) : undefined;
  const fsrs = col.config.fsrs ? new FSRS(conf.fsrsParams) : null;
  const dr = home?.desiredRetention ?? conf.desiredRetention;
  const due = card.odid && card.odue ? card.odue : card.due;
  let elapsedDays = 0;
  if (card.last_review) elapsedDays = Math.max(0, today - dayNumber(card.last_review, col.config.rolloverHour));
  else if (card.type === CardType.Review) elapsedDays = Math.max(0, card.ivl - (due - today));
  let prevMem: MemoryState | null = null;
  if (fsrs) {
    if (card.stability != null && card.difficulty != null && card.stability > 0) prevMem = { stability: card.stability, difficulty: card.difficulty };
    else if ((card.type === CardType.Review || card.type === CardType.Relearn) && card.ivl > 0)
      prevMem = memoryFromSm2(card.ivl, card.factor, dr, fsrs);
  }
  const f = filteredDeck?.filtered;
  return {
    col,
    card,
    conf,
    now,
    today,
    fsrs,
    dr,
    elapsedDays,
    prevMem,
    inFiltered: !!card.odid,
    reschedule: f ? f.reschedule : true,
    previewSecs: f ? [f.previewAgainSecs, f.previewHardSecs, f.previewGoodSecs] : [60, 600, 0],
  };
}

const FUZZ_RANGES: [number, number, number][] = [
  [2.5, 7.0, 0.15],
  [7.0, 20.0, 0.1],
  [20.0, Infinity, 0.05],
];

export function fuzzBounds(ivl: number, minimum: number, maximum: number): [number, number] {
  if (ivl < 2.5) {
    const v = clamp(Math.round(ivl), minimum, maximum);
    return [v, v];
  }
  let delta = 1.0;
  for (const [start, end, factor] of FUZZ_RANGES) delta += factor * Math.max(0, Math.min(ivl, end) - start);
  let lo = Math.round(ivl - delta);
  let hi = Math.round(ivl + delta);
  lo = clamp(lo, minimum, maximum);
  hi = clamp(hi, minimum, maximum);
  if (lo > hi) lo = hi;
  return [lo, hi];
}

/** Choose an interval within the fuzz range; with load balancing, prefer quieter days. */
function fuzzedInterval(ctx: Ctx, ivl: number, minimum: number, rating: number): number {
  const maximum = Math.max(minimum, ctx.conf.maxIvl);
  minimum = Math.min(Math.max(1, minimum), maximum);
  const [lo, hi] = fuzzBounds(ivl, minimum, maximum);
  if (lo === hi) return lo;
  const rnd = seededRandom(ctx.card.id, ctx.card.reps, rating);
  if (!ctx.col.config.loadBalancer || hi - lo > 60) return lo + Math.floor(rnd * (hi - lo + 1));
  // Load balancer: weight days by inverse workload (and easy-days preference).
  const rows = ctx.col.db
    .query<{ due: number; n: number }, [number, number]>(
      "SELECT due, count(*) n FROM cards WHERE queue=2 AND due BETWEEN ? AND ? GROUP BY due",
    )
    .all(ctx.today + lo, ctx.today + hi);
  const counts = new Map(rows.map((r) => [r.due, r.n]));
  const weights: number[] = [];
  for (let d = lo; d <= hi; d++) {
    const n = counts.get(ctx.today + d) ?? 0;
    const weekday = (new Date((ctx.today + d) * 86400 * 1000).getUTCDay() + 6) % 7; // Mon=0
    const easy = ctx.conf.easyDays?.[weekday] ?? 1;
    const distancePenalty = 1 / (1 + Math.abs(d - ivl) / Math.max(1, ivl));
    weights.push((easy <= 0 ? 0.0001 : easy) * distancePenalty / Math.pow(n + 1, 2));
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rnd * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return lo + i;
  }
  return hi;
}

function learnHardDelayMins(steps: number[], idx: number): number {
  if (idx === 0) {
    if (steps.length > 1) return (steps[0] + steps[1]) / 2;
    return Math.min(steps[0] * 1.5, steps[0] + 1440);
  }
  return steps[idx];
}

/** Compute the four possible outcomes for a card. */
export function computeOutcomes(col: Collection, card: CardRow, now = nowSecs()): Record<Rating, Outcome> {
  const ctx = makeCtx(col, card, now);
  if (ctx.inFiltered && !ctx.reschedule) return previewOutcomes(ctx);

  const mems: Record<Rating, MemoryState | null> = { 1: null, 2: null, 3: null, 4: null };
  if (ctx.fsrs) for (const r of [1, 2, 3, 4] as Rating[]) mems[r] = ctx.fsrs.nextState(ctx.prevMem, ctx.elapsedDays, r);

  const base = (r: Rating): Outcome => ({
    rating: r,
    card: {
      ...card,
      reps: card.reps + 1,
      last_review: now,
      mtime: now,
      stability: mems[r]?.stability ?? card.stability,
      difficulty: mems[r]?.difficulty ?? card.difficulty,
    },
    revlog: {
      ease: r,
      ivl: 0,
      lastIvl: card.type === CardType.Review || card.type === CardType.Relearn ? card.ivl : 0,
      factor: card.factor,
      type:
        card.type === CardType.New || card.type === CardType.Learn
          ? RevlogType.Learn
          : card.type === CardType.Relearn
            ? RevlogType.Relearn
            : ctx.inFiltered && (card.odue || card.due) > ctx.today
              ? RevlogType.Filtered
              : RevlogType.Review,
    },
    dueInSecs: 0,
    leech: false,
    returnHome: false,
  });

  const out = {} as Record<Rating, Outcome>;
  if (card.type === CardType.New || card.type === CardType.Learn) {
    const steps = ctx.conf.learnSteps.filter((s) => s > 0);
    const idx = card.type === CardType.New ? 0 : clamp(steps.length - card.left, 0, Math.max(0, steps.length - 1));
    // graduation intervals
    let goodIvl: number, easyIvl: number;
    if (ctx.fsrs) {
      goodIvl = fuzzedInterval(ctx, ctx.fsrs.rawInterval(mems[3]!.stability, ctx.dr) * ctx.conf.ivlMult, 1, 3);
      easyIvl = fuzzedInterval(ctx, ctx.fsrs.rawInterval(mems[4]!.stability, ctx.dr) * ctx.conf.ivlMult, goodIvl + 1, 4);
    } else {
      goodIvl = Math.max(1, ctx.conf.graduatingIvl);
      easyIvl = Math.max(goodIvl + 1, ctx.conf.easyIvl);
    }
    const graduate = (r: Rating, ivl: number) => toReview(ctx, base(r), ivl, true);
    if (!steps.length) {
      out[1] = graduate(1, ctx.fsrs ? fuzzedInterval(ctx, ctx.fsrs.rawInterval(mems[1]!.stability, ctx.dr), 1, 1) : 1);
      out[2] = graduate(2, goodIvl);
      out[3] = graduate(3, goodIvl);
      out[4] = graduate(4, easyIvl);
    } else {
      out[1] = toLearning(ctx, base(1), steps[0], steps.length, CardType.Learn);
      out[2] = toLearning(ctx, base(2), learnHardDelayMins(steps, idx), steps.length - idx, CardType.Learn);
      out[3] = idx + 1 < steps.length ? toLearning(ctx, base(3), steps[idx + 1], steps.length - idx - 1, CardType.Learn) : graduate(3, goodIvl);
      out[4] = graduate(4, easyIvl);
    }
  } else if (card.type === CardType.Review) {
    const due = card.odid && card.odue ? card.odue : card.due;
    const daysLate = due - ctx.today; // negative when overdue
    const late = Math.max(0, -daysLate);
    const ease = (card.factor || ctx.conf.initialEase * 1000) / 1000;
    let hard: number, good: number, easy: number;
    if (ctx.fsrs) {
      const iv = (r: Rating) => ctx.fsrs!.rawInterval(mems[r]!.stability, ctx.dr) * ctx.conf.ivlMult;
      hard = fuzzedInterval(ctx, iv(2), 1, 2);
      good = fuzzedInterval(ctx, iv(3), hard + 1, 3);
      easy = fuzzedInterval(ctx, iv(4), good + 1, 4);
    } else if (daysLate > 0) {
      // early review (filtered deck): Anki v3 early-review intervals
      const elapsed = Math.max(0, card.ivl - daysLate);
      const factorHard = Math.max(ctx.conf.hardMult, 1) * ctx.conf.ivlMult;
      hard = fuzzedInterval(ctx, Math.max(elapsed * factorHard, card.ivl * factorHard / 2), 1, 2);
      good = fuzzedInterval(ctx, Math.max(elapsed * ease, card.ivl) * ctx.conf.ivlMult, hard + 1, 3);
      easy = fuzzedInterval(ctx, Math.max(elapsed * ease * ctx.conf.easyMult, card.ivl) * ctx.conf.ivlMult, good + 1, 4);
    } else {
      const hardMin = ctx.conf.hardMult > 1 ? card.ivl + 1 : 1;
      hard = fuzzedInterval(ctx, card.ivl * ctx.conf.hardMult * ctx.conf.ivlMult, hardMin, 2);
      const goodMin = ctx.conf.hardMult > 1 ? hard + 1 : card.ivl + 1;
      good = fuzzedInterval(ctx, (card.ivl + late / 2) * ease * ctx.conf.ivlMult, goodMin, 3);
      easy = fuzzedInterval(ctx, (card.ivl + late) * ease * ctx.conf.easyMult * ctx.conf.ivlMult, good + 1, 4);
    }
    // Again (lapse)
    {
      const o = base(1);
      o.card.lapses = card.lapses + 1;
      let lapseIvl: number;
      if (ctx.fsrs) lapseIvl = Math.max(ctx.conf.minLapseIvl, Math.min(card.ivl, ctx.fsrs.nextInterval(mems[1]!.stability, ctx.dr, ctx.conf.maxIvl)));
      else lapseIvl = Math.max(ctx.conf.minLapseIvl, Math.round(card.ivl * ctx.conf.lapseMult));
      lapseIvl = Math.max(1, lapseIvl);
      if (!ctx.fsrs) o.card.factor = Math.max(1300, (card.factor || 2500) - 200);
      const t = ctx.conf.leechThreshold;
      if (t > 0 && o.card.lapses >= t && (o.card.lapses - t) % Math.max(1, Math.ceil(t / 2)) === 0) o.leech = true;
      const steps = ctx.conf.relearnSteps.filter((s) => s > 0);
      o.card.ivl = lapseIvl;
      out[1] = steps.length ? toLearning(ctx, o, steps[0], steps.length, CardType.Relearn) : toReview(ctx, o, lapseIvl, false);
    }
    const rev = (r: Rating, ivl: number, factorDelta: number) => {
      const o = base(r);
      if (!ctx.fsrs) o.card.factor = Math.max(1300, (card.factor || 2500) + factorDelta);
      return toReview(ctx, o, ivl, false);
    };
    out[2] = rev(2, hard, -150);
    out[3] = rev(3, good, 0);
    out[4] = rev(4, easy, 150);
  } else {
    // Relearning
    const steps = ctx.conf.relearnSteps.filter((s) => s > 0);
    const idx = clamp(steps.length - card.left, 0, Math.max(0, steps.length - 1));
    let goodIvl = Math.max(1, card.ivl);
    let easyIvl = goodIvl + 1;
    if (ctx.fsrs) {
      goodIvl = Math.max(1, ctx.fsrs.nextInterval(mems[3]!.stability, ctx.dr, ctx.conf.maxIvl));
      easyIvl = Math.max(goodIvl + 1, ctx.fsrs.nextInterval(mems[4]!.stability, ctx.dr, ctx.conf.maxIvl));
    }
    if (!steps.length) {
      out[1] = toReview(ctx, base(1), Math.max(1, ctx.conf.minLapseIvl), false);
      out[2] = toReview(ctx, base(2), goodIvl, false);
      out[3] = toReview(ctx, base(3), goodIvl, false);
      out[4] = toReview(ctx, base(4), easyIvl, false);
    } else {
      out[1] = toLearning(ctx, base(1), steps[0], steps.length, CardType.Relearn);
      out[2] = toLearning(ctx, base(2), learnHardDelayMins(steps, idx), steps.length - idx, CardType.Relearn);
      out[3] = idx + 1 < steps.length ? toLearning(ctx, base(3), steps[idx + 1], steps.length - idx - 1, CardType.Relearn) : toReview(ctx, base(3), goodIvl, false);
      out[4] = toReview(ctx, base(4), easyIvl, false);
    }
  }
  return out;
}

function toLearning(ctx: Ctx, o: Outcome, delayMins: number, left: number, type: number): Outcome {
  const c = o.card;
  c.type = type;
  c.left = left;
  const secs = Math.round(delayMins * 60);
  if (delayMins >= 1440) {
    const days = Math.max(1, Math.round(delayMins / 1440));
    c.queue = Queue.DayLearn;
    c.due = ctx.today + days;
    o.dueInSecs = days * 86400;
  } else {
    c.queue = Queue.Learn;
    // small fuzz on learning steps (up to 25%, max 5 minutes), deterministic
    const fuzz = Math.floor(seededRandom(c.id, c.reps, delayMins) * Math.min(secs * 0.25, 300));
    c.due = ctx.now + secs + (secs >= 60 ? fuzz : 0);
    o.dueInSecs = secs;
  }
  o.revlog.ivl = -secs;
  o.revlog.factor = c.factor;
  // in a filtered deck, cards stay until they leave learning
  return o;
}

function toReview(ctx: Ctx, o: Outcome, ivl: number, fromLearning: boolean): Outcome {
  const c = o.card;
  ivl = clamp(Math.round(ivl), 1, Math.max(1, ctx.conf.maxIvl));
  c.type = CardType.Review;
  c.queue = Queue.Review;
  c.ivl = ivl;
  c.due = ctx.today + ivl;
  c.left = 0;
  if (fromLearning && !c.factor) c.factor = Math.round(ctx.conf.initialEase * 1000);
  if (!c.factor) c.factor = Math.round(ctx.conf.initialEase * 1000);
  o.revlog.ivl = ivl;
  o.revlog.factor = c.factor;
  o.dueInSecs = ivl * 86400;
  if (ctx.inFiltered) o.returnHome = true;
  return o;
}

function previewOutcomes(ctx: Ctx): Record<Rating, Outcome> {
  const out = {} as Record<Rating, Outcome>;
  const [againS, hardS, goodS] = ctx.previewSecs;
  for (const r of [1, 2, 3, 4] as Rating[]) {
    const secs = r === 1 ? againS : r === 2 ? hardS : r === 3 ? goodS : 0;
    const card: CardRow = { ...ctx.card, mtime: ctx.now };
    const o: Outcome = {
      rating: r,
      card,
      revlog: { ease: r, ivl: -secs, lastIvl: ctx.card.ivl, factor: ctx.card.factor, type: RevlogType.Filtered },
      dueInSecs: secs,
      leech: false,
      returnHome: secs <= 0,
      previewReturn: secs <= 0,
    };
    if (secs > 0) {
      card.queue = Queue.Preview;
      card.due = ctx.now + secs;
    }
    out[r] = o;
  }
  return out;
}

export function buttonLabels(col: Collection, card: CardRow, now = nowSecs()) {
  const o = computeOutcomes(col, card, now);
  return ([1, 2, 3, 4] as Rating[]).map((r) => ({
    ease: r,
    label: o[r].returnHome && o[r].dueInSecs <= 0 ? "End" : intervalLabel(o[r].dueInSecs),
    secs: o[r].dueInSecs,
  }));
}
