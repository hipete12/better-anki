import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection } from "../src/collection";
import { duplicateNotes, type DuplicatePlacement } from "../src/layouts";
import { cardAction } from "../src/ops";
import { answerCard, undo as studyUndo } from "../src/sched/queue";
import { recordStep, undoStep, redoStep, historyStatus, clearHistory } from "../src/history";
import { splitFields } from "../src/util";
import { randomKey } from "../src/crypto/aead";

const KEY = randomKey();
let dir: string;
let col: Collection;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ba-hist-"));
  col = new Collection(dir, KEY, { autoFlush: false });
  clearHistory();
});
afterEach(() => {
  col.close();
  rmSync(dir, { recursive: true, force: true });
});

const basic = () => col.notetypeByName("Basic")!;
/** Six notes "1".."6" in a fresh deck; returns the deck id and each note's card id. */
function deckOfSix() {
  const did = col.ensureDeck("Six").id;
  const cards: Record<string, number> = {};
  for (const f of ["1", "2", "3", "4", "5", "6"]) {
    const { id } = col.addNote(basic().id, [f, `back ${f}`], [], did);
    cards[f] = col.cardsOfNote(id)[0].id;
  }
  return { did, cards };
}
const front = (nid: number) => splitFields(col.note(nid)!.flds)[0];
/** Fronts in the deck's "#" order; copies are marked with ′. */
function hashOrder(did: number, copies: Set<number>) {
  return col.db
    .query<{ id: number }, [number]>("SELECT n.id id FROM notes n WHERE n.id IN (SELECT nid FROM cards WHERE did=?) ORDER BY COALESCE(n.sort_pos, n.id), n.id")
    .all(did)
    .map((r) => front(r.id) + (copies.has(r.id) ? "′" : ""));
}
/** Fronts in new-card queue order. */
function queueOrder(did: number, copies: Set<number>) {
  return col.db
    .query<{ nid: number }, [number]>("SELECT nid FROM cards WHERE did=? AND type=0 ORDER BY due, id")
    .all(did)
    .map((r) => front(r.nid) + (copies.has(r.nid) ? "′" : ""));
}

describe("duplicate placement", () => {
  const cases: [DuplicatePlacement, string[]][] = [
    ["end", ["1", "2", "3", "4", "5", "6", "2′", "4′", "5′"]],
    ["after", ["1", "2", "2′", "3", "4", "4′", "5", "5′", "6"]],
    ["start", ["2′", "4′", "5′", "1", "2", "3", "4", "5", "6"]],
    ["afterLast", ["1", "2", "3", "4", "5", "2′", "4′", "5′", "6"]],
  ];
  for (const [place, want] of cases)
    test(`${place}: sets the # order and the new-card queue`, () => {
      const { did, cards } = deckOfSix();
      // select out of order: placement follows the deck's order, not the selection's
      const r = duplicateNotes(col, { cardIds: [cards["5"], cards["2"], cards["4"]], place });
      const copies = new Set(r.noteIds);
      expect(r.cardIds.length).toBe(3);
      expect(hashOrder(did, copies)).toEqual(want);
      expect(queueOrder(did, copies)).toEqual(want);
    });

  test("after: an original that's been studied goes before the next new card", () => {
    const { did, cards } = deckOfSix();
    answerCard(col, cards["2"], 3, 1000, undefined, { undo: false });
    const r = duplicateNotes(col, { cardIds: [cards["2"]], place: "after" });
    const copies = new Set(r.noteIds);
    expect(hashOrder(did, copies)).toEqual(["1", "2", "2′", "3", "4", "5", "6"]);
    expect(queueOrder(did, copies)).toEqual(["1", "2′", "3", "4", "5", "6"]);
  });

  test("other decks' new cards keep their relative order", () => {
    const { cards } = deckOfSix();
    const other = col.ensureDeck("Other").id;
    const a = col.addNote(basic().id, ["a", "b"], [], other).id;
    const b = col.addNote(basic().id, ["c", "d"], [], other).id;
    duplicateNotes(col, { cardIds: [cards["1"]], place: "start" });
    const dues = [a, b].map((n) => col.cardsOfNote(n)[0].due);
    expect(dues[0]).toBeLessThan(dues[1]);
  });
});

describe("browse history", () => {
  test("undo and redo a card action; study undo isn't touched", async () => {
    const { cards } = deckOfSix();
    await recordStep(col, "Suspend", () => cardAction(col, { action: "suspend", cardIds: [cards["1"], cards["2"]] }));
    expect(historyStatus()).toEqual({ undo: "Suspend", redo: null });
    expect(studyUndo(col)).toBeNull(); // Browse actions stay out of the study undo stack
    expect(undoStep(col).done).toBe("Suspend");
    expect(col.card(cards["1"])!.queue).toBe(0);
    expect(historyStatus()).toEqual({ undo: null, redo: "Suspend" });
    expect(redoStep(col).done).toBe("Suspend");
    expect(col.card(cards["2"])!.queue).toBe(-1);
  });

  test("undo removes duplicates and redo brings them back; others stay where they moved", async () => {
    const { did, cards } = deckOfSix();
    const r = await recordStep(col, "Duplicate", () => duplicateNotes(col, { cardIds: [cards["2"]], place: "after" }));
    const copy = r.noteIds[0];
    const before = queueOrder(did, new Set([copy]));
    undoStep(col);
    expect(col.note(copy)).toBeUndefined();
    expect(col.cardsOfNote(copy)).toEqual([]);
    expect(queueOrder(did, new Set())).toEqual(["1", "2", "3", "4", "5", "6"]);
    redoStep(col);
    expect(front(copy)).toBe("2");
    expect(queueOrder(did, new Set([copy]))).toEqual(before);
    expect(hashOrder(did, new Set([copy]))).toEqual(["1", "2", "2′", "3", "4", "5", "6"]);
  });

  test("undo deleted notes and edits", async () => {
    const { cards } = deckOfSix();
    const nid = col.card(cards["3"])!.nid;
    await recordStep(col, "Edit note", () => col.updateNote(nid, ["three", "back"], ["t"]));
    await recordStep(col, "Delete notes", () => col.removeNotes([nid]));
    undoStep(col);
    expect(front(nid)).toBe("three");
    expect(col.card(cards["3"])).toBeTruthy();
    undoStep(col);
    expect(front(nid)).toBe("3");
    expect(col.note(nid)!.tags).toBe("");
  });

  test("a new action clears redo; nothing changed records nothing", async () => {
    const { cards } = deckOfSix();
    await recordStep(col, "Flag", () => cardAction(col, { action: "flag", cardIds: [cards["1"]], flag: 1 }));
    undoStep(col);
    await recordStep(col, "Unsuspend", () => cardAction(col, { action: "unsuspend", cardIds: [cards["1"]] })); // not suspended: no change
    expect(historyStatus()).toEqual({ undo: null, redo: "Flag" });
    await recordStep(col, "Bury", () => cardAction(col, { action: "bury", cardIds: [cards["1"]] }));
    expect(historyStatus()).toEqual({ undo: "Bury", redo: null });
  });

  test("refuses to undo over a later change, and drops the step", async () => {
    const { cards } = deckOfSix();
    await recordStep(col, "Flag", () => cardAction(col, { action: "flag", cardIds: [cards["1"]], flag: 2 }));
    answerCard(col, cards["1"], 3, 1000, undefined, { undo: false }); // studied since
    expect(() => undoStep(col)).toThrow(/changed since/);
    expect(historyStatus().undo).toBeNull();
    expect(col.card(cards["1"])!.flags & 7).toBe(2);
  });

  test("a failed action records nothing and leaves no triggers behind", async () => {
    deckOfSix();
    await expect(recordStep(col, "Change deck", () => cardAction(col, { action: "setDeck", cardIds: [col.db.query<{ id: number }, []>("SELECT id FROM cards LIMIT 1").get()!.id], deckId: 999 }))).rejects.toThrow();
    expect(historyStatus().undo).toBeNull();
    expect(col.db.query("SELECT name FROM sqlite_temp_master WHERE type='trigger'").all()).toEqual([]);
  });
});
