// Test vectors for the Android offline scheduler port: the server's computeOutcomes over many card states
// and option sets. Usage: bun scripts/sched-vectors.ts ../android/app/src/test/resources/sched_vectors.json
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection } from "../src/collection";
import { randomKey } from "../src/crypto/aead";
import { computeOutcomes, type Rating } from "../src/sched/scheduler";
import type { CardRow, DeckConfig } from "../src/types";
import { localOffsetSecs } from "../src/util";

const out = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), "ba-vectors-"));
const col = new Collection(dir, randomKey(), { autoFlush: false });
col.setConfig({ loadBalancer: false, rolloverHour: 4 });
const deck = col.ensureDeck("Vectors");
col.addNote(col.notetypeByName("Basic")!.id, ["q", "a"], [], deck.id);
const base = col.db.query<CardRow, []>("SELECT * FROM cards").get()!;

const NOW = 1_800_000_000 + 13 * 3600; // a fixed afternoon
const DAY = 86400;
const confs: Partial<DeckConfig>[] = [
  {},
  { learnSteps: [1, 10, 60], relearnSteps: [10, 1440], graduatingIvl: 3, easyIvl: 6 },
  { learnSteps: [], relearnSteps: [], minLapseIvl: 2, lapseMult: 0.5 },
  { learnSteps: [25], hardMult: 1.5, easyMult: 1.5, ivlMult: 0.8, maxIvl: 60, initialEase: 2.3 },
  { leechThreshold: 2, desiredRetention: 0.85 },
  { fsrsParams: [0.3, 1.1, 3.0, 12.0, 6.2, 0.7, 2.8, 0.01, 1.6, 0.15, 0.9, 1.3, 0.07, 0.3, 1.5, 0.5, 2.0, 0.6, 0.1, 0.07, 0.2] },
];
const cards: Partial<CardRow>[] = [
  { type: 0, queue: 0, reps: 0 },
  { type: 1, queue: 1, left: 2, reps: 1, due: NOW - 30 },
  { type: 1, queue: 1, left: 1, reps: 2, due: NOW - 30 },
  { type: 1, queue: 3, left: 1, reps: 2, stability: 2.5, difficulty: 5.1, last_review: NOW - DAY },
  { type: 2, queue: 2, ivl: 1, factor: 2500, reps: 3 },
  { type: 2, queue: 2, ivl: 10, factor: 2500, reps: 6, lapses: 1 },
  { type: 2, queue: 2, ivl: 120, factor: 1300, reps: 12, lapses: 4 },
  { type: 2, queue: 2, ivl: 8, factor: 2650, reps: 5, overdue: 5 } as Partial<CardRow>,
  { type: 2, queue: 2, ivl: 30, factor: 2500, reps: 9, stability: 28.4, difficulty: 6.3, last_review: NOW - 31 * DAY },
  { type: 2, queue: 2, ivl: 4, factor: 2500, reps: 4, stability: 3.9, difficulty: 7.7, last_review: NOW - 2 * DAY, lapses: 1 },
  { type: 3, queue: 1, left: 1, ivl: 5, factor: 2300, reps: 8, lapses: 2, due: NOW - 10 },
  { type: 3, queue: 1, left: 2, ivl: 12, factor: 2100, reps: 10, lapses: 3, stability: 4.2, difficulty: 8.1, last_review: NOW - 600 },
];

const vectors = [];
let id = 0;
for (const fsrs of [false, true]) {
  col.setConfig({ fsrs });
  for (const [ci, conf] of confs.entries()) {
    const full = col.saveDeckConfig({ ...col.deckConfig(1), ...conf, id: 1 });
    for (const c of cards) {
      const today = col.today(NOW);
      const { overdue, ...fields } = c as Partial<CardRow> & { overdue?: number };
      const card: CardRow = { ...base, id: base.id + ++id, stability: null, difficulty: null, last_review: null, left: 0, lapses: 0, ivl: 0, factor: 0, due: 0, ...fields };
      if (card.type === 2) card.due = today - (overdue ?? 0);
      if (card.type === 1 && card.queue === 3) card.due = today;
      const o = computeOutcomes(col, card, NOW);
      vectors.push({
        name: `${fsrs ? "fsrs" : "sm2"} conf${ci} ${JSON.stringify(c)}`,
        fsrs,
        rolloverHour: 4,
        tzOffsetSecs: localOffsetSecs(NOW),
        now: NOW,
        today,
        conf: full,
        card,
        outcomes: Object.fromEntries(
          ([1, 2, 3, 4] as Rating[]).map((r) => {
            const x = o[r];
            return [r, { type: x.card.type, queue: x.card.queue, due: x.card.due, ivl: x.card.ivl, factor: x.card.factor, left: x.card.left, reps: x.card.reps, lapses: x.card.lapses, stability: x.card.stability, difficulty: x.card.difficulty, dueInSecs: x.dueInSecs, revlogIvl: x.revlog.ivl, revlogType: x.revlog.type, leech: x.leech }];
          }),
        ),
      });
    }
  }
}
writeFileSync(out, JSON.stringify(vectors, null, 1));
console.log(`${vectors.length} vectors -> ${out}`);
col.close();
rmSync(dir, { recursive: true, force: true });
