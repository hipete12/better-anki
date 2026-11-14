// Build FSRS training data from the revlog, recompute memory states, and
// optionally reschedule cards with new parameters.
import type { Collection } from "../collection";
import type { Sequence } from "./optimizer";
import { FSRS, memoryFromSm2 } from "./fsrs";
import { CardType, Queue } from "../types";
import { dayNumber, nowSecs } from "../util";

interface Rev {
  id: number;
  cid: number;
  ease: number;
  type: number;
}

function deckIdsForPreset(col: Collection, configId: number | null): number[] | null {
  if (configId == null) return null;
  return col.decks().filter((d) => d.kind === 0 && d.configId === configId).map((d) => d.id);
}

function cardFilter(col: Collection, configId: number | null): string {
  const ids = deckIdsForPreset(col, configId);
  if (!ids) return "1=1";
  if (!ids.length) return "0=1";
  return `(did IN (${ids.join(",")}) OR odid IN (${ids.join(",")}))`;
}

/** Group revlog entries by card, ordered by time. */
function revlogByCard(col: Collection, configId: number | null, ignoreBeforeMs = 0): Map<number, Rev[]> {
  const where = cardFilter(col, configId);
  const rows = col.db
    .query<Rev, [number]>(
      `SELECT id, cid, ease, type FROM revlog WHERE cid IN (SELECT id FROM cards WHERE ${where}) AND ease BETWEEN 1 AND 4 AND type IN (0,1,2,3) AND id >= ? ORDER BY cid, id`,
    )
    .all(ignoreBeforeMs);
  const map = new Map<number, Rev[]>();
  for (const r of rows) {
    const arr = map.get(r.cid) ?? [];
    arr.push(r);
    map.set(r.cid, arr);
  }
  return map;
}

function toSequence(col: Collection, revs: Rev[]): Sequence {
  const roll = col.config.rolloverHour;
  const seq: Sequence = [];
  let prevDay: number | null = null;
  for (const r of revs) {
    // a filtered-deck review with no rescheduling (preview) shouldn't count
    const day = dayNumber(Math.floor(r.id / 1000), roll);
    seq.push([prevDay === null ? 0 : day - prevDay, r.ease]);
    prevDay = day;
  }
  return seq;
}

export function trainingSequences(col: Collection, configId: number | null): Sequence[] {
  const conf = configId ? col.deckConfig(configId) : null;
  const ignore = conf?.ignoreRevlogsBefore ? Date.parse(conf.ignoreRevlogsBefore) || 0 : 0;
  const out: Sequence[] = [];
  for (const revs of revlogByCard(col, configId, ignore).values()) {
    // require the history to start with a learning review (complete history)
    if (revs[0].type !== 0) continue;
    out.push(toSequence(col, revs));
  }
  return out;
}

/** Recompute FSRS memory state for cards (optionally rescheduling review cards). */
export function recomputeMemory(col: Collection, configId: number | null, reschedule = false): { updated: number; rescheduled: number } {
  const roll = col.config.rolloverHour;
  const today = col.today();
  const presets = configId == null ? col.allDeckConfigs().map((c) => c.id) : [configId];
  let updated = 0;
  let rescheduled = 0;
  col.tx(() => {
    for (const pid of presets) {
      const conf = col.deckConfig(pid);
      const fsrs = new FSRS(conf.fsrsParams);
      const byCard = revlogByCard(col, pid);
      const cards = col.db
        .query<{ id: number; type: number; queue: number; ivl: number; factor: number; due: number; odid: number; odue: number; last_review: number | null }, []>(
          `SELECT id, type, queue, ivl, factor, due, odid, odue, last_review FROM cards WHERE ${cardFilter(col, pid)} AND type != 0`,
        )
        .all();
      const upd = col.db.query("UPDATE cards SET stability=?, difficulty=?, last_review=? WHERE id=?");
      const resched = col.db.query("UPDATE cards SET due=?, ivl=? WHERE id=?");
      for (const c of cards) {
        const revs = byCard.get(c.id);
        let mem: { stability: number; difficulty: number } | null = null;
        let last: number | null = c.last_review;
        if (revs?.length) {
          const startsWithLearning = revs[0].type === 0;
          const seq = toSequence(col, revs);
          if (!startsWithLearning && c.ivl > 0) mem = memoryFromSm2(Math.max(1, c.ivl), c.factor, conf.desiredRetention, fsrs);
          seq.forEach(([dt, r], i) => {
            if (!startsWithLearning && i === 0) return;
            mem = fsrs.nextState(mem, i === 0 ? 0 : dt, r);
          });
          last = Math.floor(revs[revs.length - 1].id / 1000);
        } else if (c.ivl > 0) {
          mem = memoryFromSm2(c.ivl, c.factor, conf.desiredRetention, fsrs);
        }
        if (!mem) continue;
        upd.run(mem.stability, mem.difficulty, last, c.id);
        updated++;
        if (reschedule && c.type === CardType.Review && c.queue === Queue.Review && last) {
          const ivl = fsrs.nextInterval(mem.stability, conf.desiredRetention, conf.maxIvl);
          const lastDay = dayNumber(last, roll);
          const due = Math.max(today, lastDay + ivl);
          if (!c.odid) {
            resched.run(due, ivl, c.id);
            rescheduled++;
          }
        }
      }
    }
  });
  void nowSecs;
  col.emit("cards");
  return { updated, rescheduled };
}
