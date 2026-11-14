// Higher-level collection operations: deck tree, filtered decks, custom study,
// bulk card actions (with undo).
import type { Collection } from "./collection";
import type { CardRow, Deck, FilteredConfig } from "./types";
import { CardType, Queue, RevlogType } from "./types";
import { countsFor, extendLimits, pushUndo, snapshotCards, deckLimits } from "./sched/queue";
import { searchRows } from "./search";
import { assert, dayNumber, nowSecs, seededRandom, HttpError } from "./util";
import { FSRS } from "./sched/fsrs";

export interface DeckNode {
  id: number;
  name: string; // full name
  shortName: string;
  kind: 0 | 1;
  collapsed: boolean;
  configId: number;
  counts: { new: number; learn: number; review: number };
  total: number;
  children: DeckNode[];
}

export function deckTree(col: Collection): DeckNode[] {
  const decks = col.decks();
  const nodes = new Map<string, DeckNode>();
  const roots: DeckNode[] = [];
  const totals = new Map(
    col.db.query<{ did: number; n: number }, []>("SELECT did, count(*) n FROM cards GROUP BY did").all().map((r) => [r.did, r.n]),
  );
  for (const d of decks) {
    const node: DeckNode = {
      id: d.id,
      name: d.name,
      shortName: d.name.split("::").pop()!,
      kind: d.kind,
      collapsed: d.collapsed,
      configId: d.configId,
      counts: countsFor(col, d.id),
      total: totals.get(d.id) ?? 0,
      children: [],
    };
    nodes.set(d.name.toLowerCase(), node);
    const parentName = d.name.split("::").slice(0, -1).join("::").toLowerCase();
    const parent = parentName ? nodes.get(parentName) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sum = (n: DeckNode): number => (n.total += n.children.reduce((a, c) => a + sum(c), 0), n.total);
  roots.forEach(sum);
  // hide an empty, child-less Default deck like Anki does when other decks exist
  return roots.filter((r) => !(r.id === 1 && r.total === 0 && r.children.length === 0 && roots.length > 1));
}

// ---------------- filtered decks ----------------
const FILTER_BASE = -100000;

function orderFiltered(col: Collection, rows: CardRow[], order: number): CardRow[] {
  const today = col.today();
  const fsrs = new FSRS();
  const retr = (c: CardRow) =>
    c.stability && c.last_review ? fsrs.retrievability(today - dayNumber(c.last_review, col.config.rolloverHour), c.stability) : c.type === CardType.New ? 1 : 0.9;
  const sorted = [...rows];
  switch (order) {
    case 0:
      return sorted.sort((a, b) => (a.last_review ?? 0) - (b.last_review ?? 0));
    case 1:
      return sorted.sort((a, b) => seededRandom(a.id, Date.now() >> 10) - seededRandom(b.id, Date.now() >> 10));
    case 2:
      return sorted.sort((a, b) => a.ivl - b.ivl);
    case 3:
      return sorted.sort((a, b) => b.ivl - a.ivl);
    case 4:
      return sorted.sort((a, b) => b.lapses - a.lapses);
    case 5:
      return sorted.sort((a, b) => a.nid - b.nid || a.ord - b.ord);
    case 6:
      return sorted.sort((a, b) => a.type - b.type || a.due - b.due);
    case 7:
      return sorted.sort((a, b) => b.nid - a.nid || a.ord - b.ord);
    case 8:
      return sorted.sort((a, b) => retr(a) - retr(b));
    case 9:
      return sorted.sort((a, b) => retr(b) - retr(a));
    case 10:
      return sorted.sort((a, b) => (today - b.due) / Math.max(1, b.ivl) - (today - a.due) / Math.max(1, a.ivl));
  }
  return sorted;
}

export function rebuildFiltered(col: Collection, did: number): number {
  const deck = col.deck(did);
  assert(deck && deck.kind === 1 && deck.filtered, "Not a filtered deck");
  let pos = 0;
  col.tx(() => {
    col.emptyFiltered(did);
    const taken = new Set<number>();
    for (const term of deck.filtered!.terms) {
      if (term.limit <= 0) continue;
      const rows = searchRows(col, term.search || "").filter(
        (r) => r.odid === 0 && r.queue >= 0 && !taken.has(r.id) && col.deck(r.did)?.kind === 0,
      );
      const picked = orderFiltered(col, rows, term.order).slice(0, term.limit);
      const upd = col.db.query("UPDATE cards SET odid=did, odue=due, did=?, due=?, mtime=? WHERE id=?");
      const updLearn = col.db.query("UPDATE cards SET odid=did, odue=due, did=?, mtime=? WHERE id=?");
      for (const c of picked) {
        taken.add(c.id);
        if (c.queue === Queue.Learn || c.queue === Queue.DayLearn) updLearn.run(did, nowSecs(), c.id);
        else upd.run(did, FILTER_BASE + pos, nowSecs(), c.id);
        pos++;
      }
    }
  });
  col.emit("decks", [did]);
  return pos;
}

export function createFiltered(col: Collection, name: string, cfg: Partial<FilteredConfig>, opts: { rebuild?: boolean } = {}): Deck {
  let deck = col.deckByName(name);
  if (deck && deck.kind !== 1) throw new HttpError(400, "A regular deck with that name exists");
  if (!deck) deck = col.ensureDeck(name, true);
  const filtered: FilteredConfig = {
    terms: cfg.terms?.length ? cfg.terms : [{ search: "is:due", limit: 100, order: 6 }],
    reschedule: cfg.reschedule ?? true,
    previewAgainSecs: cfg.previewAgainSecs ?? 60,
    previewHardSecs: cfg.previewHardSecs ?? 600,
    previewGoodSecs: cfg.previewGoodSecs ?? 0,
  };
  col.updateDeck(deck.id, { filtered });
  if (opts.rebuild !== false) rebuildFiltered(col, deck.id);
  return col.deck(deck.id)!;
}

export type CustomStudy =
  | { mode: "newLimit"; deckId: number; value: number }
  | { mode: "reviewLimit"; deckId: number; value: number }
  | { mode: "forgotten"; deckId: number; days: number }
  | { mode: "ahead"; deckId: number; days: number }
  | { mode: "previewNew"; deckId: number; days: number }
  | {
      mode: "cram";
      deckId: number;
      kind: "new" | "due" | "review" | "all";
      limit: number;
      tagsInclude?: string[];
      tagsExclude?: string[];
    };

export function customStudy(col: Collection, cs: CustomStudy): { deckId: number } {
  const deck = col.deck(cs.deckId);
  assert(deck, "Deck not found", 404);
  if (cs.mode === "newLimit") {
    extendLimits(col, deck.id, cs.value, 0);
    return { deckId: deck.id };
  }
  if (cs.mode === "reviewLimit") {
    extendLimits(col, deck.id, 0, cs.value);
    return { deckId: deck.id };
  }
  const dq = `deck:"${deck.name.replace(/"/g, '\\"')}"`;
  let terms: FilteredConfig["terms"];
  let reschedule = true;
  switch (cs.mode) {
    case "forgotten":
      terms = [{ search: `${dq} rated:${cs.days}:1`, limit: 9999, order: 1 }];
      break;
    case "ahead":
      terms = [{ search: `${dq} prop:due<=${cs.days} -is:new`, limit: 9999, order: 6 }];
      break;
    case "previewNew":
      terms = [{ search: `${dq} is:new added:${cs.days}`, limit: 9999, order: 5 }];
      reschedule = false;
      break;
    case "cram": {
      const tags = [
        ...(cs.tagsInclude?.length ? [`(${cs.tagsInclude.map((t) => `tag:"${t}"`).join(" or ")})`] : []),
        ...(cs.tagsExclude ?? []).map((t) => `-tag:"${t}"`),
      ].join(" ");
      const state = cs.kind === "new" ? "is:new" : cs.kind === "due" ? "is:due" : cs.kind === "review" ? "-is:new" : "";
      terms = [{ search: `${dq} ${state} ${tags}`.trim(), limit: cs.limit, order: cs.kind === "new" ? 5 : cs.kind === "due" ? 6 : 1 }];
      reschedule = cs.kind !== "all";
      break;
    }
  }
  const existing = col.deckByName("Custom Study Session");
  if (existing && existing.kind === 1) col.emptyFiltered(existing.id);
  const fd = createFiltered(col, "Custom Study Session", { terms, reschedule });
  return { deckId: fd.id };
}

// ---------------- bulk card actions ----------------
export type CardAction =
  | { action: "suspend" | "unsuspend" | "bury" | "unbury" | "forget" | "delete"; cardIds: number[]; resetCounts?: boolean }
  | { action: "flag"; cardIds: number[]; flag: number }
  | { action: "setDeck"; cardIds: number[]; deckId: number }
  | { action: "setDue"; cardIds: number[]; days: string } // "0", "1-7", "3!" (! = set interval too)
  | { action: "reposition"; cardIds: number[]; start: number; step: number; randomize?: boolean; shift?: boolean };

export function cardAction(col: Collection, a: CardAction): { changed: number } {
  const ids = a.cardIds;
  if (!ids.length) return { changed: 0 };
  const now = nowSecs();
  const label: Record<string, string> = {
    suspend: "Suspend",
    unsuspend: "Unsuspend",
    bury: "Bury",
    unbury: "Unbury",
    forget: "Forget",
    delete: "Delete",
    flag: "Flag",
    setDeck: "Change Deck",
    setDue: "Set Due Date",
    reposition: "Reposition",
  };
  if (a.action === "delete") {
    col.removeCards(ids);
    return { changed: ids.length };
  }
  const before = snapshotCards(col, ids);
  col.tx(() => {
    const ph = (arr: number[]) => arr.map(() => "?").join(",");
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      switch (a.action) {
        case "suspend":
          col.db.query(`UPDATE cards SET queue=-1, mtime=? WHERE id IN (${ph(chunk)})`).run(now, ...chunk);
          break;
        case "bury":
          col.db.query(`UPDATE cards SET queue=-3, mtime=? WHERE queue>=0 AND id IN (${ph(chunk)})`).run(now, ...chunk);
          break;
        case "unsuspend":
        case "unbury":
          col.db
            .query(
              `UPDATE cards SET queue=(CASE WHEN type=0 THEN 0 WHEN type=2 THEN 2 WHEN type IN (1,3) THEN (CASE WHEN due > 1000000000 THEN 1 ELSE 3 END) ELSE type END), mtime=?
               WHERE queue ${a.action === "unsuspend" ? "= -1" : "IN (-2,-3)"} AND id IN (${ph(chunk)})`,
            )
            .run(now, ...chunk);
          break;
        case "flag":
          col.db.query(`UPDATE cards SET flags=(flags & ~7) | ?, mtime=? WHERE id IN (${ph(chunk)})`).run(a.flag & 7, now, ...chunk);
          break;
        case "setDeck": {
          const d = col.deck(a.deckId);
          assert(d && d.kind === 0, "Choose a regular deck");
          // cards in filtered decks move their home deck
          col.db.query(`UPDATE cards SET did=?, mtime=? WHERE odid=0 AND id IN (${ph(chunk)})`).run(a.deckId, now, ...chunk);
          col.db.query(`UPDATE cards SET odid=?, mtime=? WHERE odid!=0 AND id IN (${ph(chunk)})`).run(a.deckId, now, ...chunk);
          break;
        }
        case "forget":
          break;
        default:
          break;
      }
    }
    if (a.action === "forget") col.forgetCards(ids, !!a.resetCounts);
    if (a.action === "setDue") setDueDate(col, ids, a.days);
    if (a.action === "reposition") reposition(col, ids, a.start, a.step, !!a.randomize, !!a.shift);
  });
  pushUndo({ label: label[a.action] ?? a.action, cards: before });
  col.emit("cards", ids);
  return { changed: ids.length };
}

function setDueDate(col: Collection, ids: number[], spec: string) {
  const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*(!)?\s*$/.exec(spec);
  assert(m, "Use a number of days like 0, 3, 1-7, or 5! (to also set the interval)");
  const lo = Number(m[1]);
  const hi = m[2] ? Number(m[2]) : lo;
  const setIvl = !!m[3];
  const today = col.today();
  const now = nowSecs();
  const rl = col.db.query("INSERT INTO revlog(id,cid,ease,ivl,last_ivl,factor,time,type) VALUES (?,?,0,?,?,?,0,?)");
  let rid = Date.now();
  for (const id of ids) {
    const c = col.card(id);
    if (!c) continue;
    const days = lo + Math.floor(Math.random() * (hi - lo + 1));
    const conf = col.configForCard(c);
    let ivl = c.ivl;
    if (setIvl || c.type !== CardType.Review) ivl = Math.max(1, days);
    else if (c.type === CardType.Review) {
      // keep interval but account for the shift, like Anki
      const elapsed = c.last_review ? today - dayNumber(c.last_review, col.config.rolloverHour) : c.ivl;
      ivl = Math.max(1, elapsed + days);
    }
    const factor = c.factor || Math.round(conf.initialEase * 1000);
    const homeOnly = c.odid ? ", did=odid, odid=0, odue=0" : "";
    col.db
      .query(`UPDATE cards SET type=2, queue=2, due=?, ivl=?, factor=?, left=0, mtime=?${homeOnly} WHERE id=?`)
      .run(today + days, ivl, factor, now, id);
    rl.run(rid++, id, ivl, c.ivl, factor, RevlogType.Rescheduled);
  }
}

function reposition(col: Collection, ids: number[], start: number, step: number, randomize: boolean, shift: boolean) {
  const cards = snapshotCards(col, ids).filter((c) => c.type === CardType.New);
  let order = [...cards].sort((a, b) => a.due - b.due || a.ord - b.ord);
  if (randomize) order = order.sort(() => Math.random() - 0.5);
  // keep siblings together: assign positions per note
  const notePos = new Map<number, number>();
  let next = start;
  if (shift && order.length) {
    const span = new Set(order.map((c) => c.nid)).size * step;
    col.db.query("UPDATE cards SET due=due+? WHERE type=0 AND due>=? AND id NOT IN (" + ids.join(",") + ")").run(span, start);
  }
  const upd = col.db.query("UPDATE cards SET due=?, mtime=? WHERE id=?");
  for (const c of order) {
    let p = notePos.get(c.nid);
    if (p === undefined) {
      p = next;
      notePos.set(c.nid, p);
      next += step;
    }
    upd.run(p, nowSecs(), c.id);
  }
  const maxPos = col.db.query<{ m: number | null }, []>("SELECT max(due) m FROM cards WHERE type=0").get()?.m ?? 0;
  col.setKV("nextPos", maxPos + 1);
}

export function deckOverview(col: Collection, deckId: number) {
  const deck = col.deck(deckId);
  assert(deck, "Deck not found", 404);
  const counts = countsFor(col, deckId);
  const ids = col.deckAndChildren(deckId);
  const totals = col.db
    .query<{ total: number; new: number; suspended: number; buried: number; young: number; mature: number; learning: number }, []>(
      `SELECT count(*) total, coalesce(sum(type=0 AND queue>=0),0) new, coalesce(sum(queue=-1),0) suspended,
       coalesce(sum(queue IN (-2,-3)),0) buried, coalesce(sum(type=2 AND ivl<21 AND queue>=0),0) young,
       coalesce(sum(type=2 AND ivl>=21 AND queue>=0),0) mature, coalesce(sum(type IN (1,3) AND queue>=0),0) learning
       FROM cards WHERE did IN (${ids.join(",")})`,
    )
    .get()!;
  const limits = deck.kind === 0 ? deckLimits(col, deck) : null;
  const conf = deck.kind === 0 ? col.deckConfig(deck.configId) : null;
  return { deck, counts, totals, limits, configName: conf?.name ?? null };
}

export function setCardQueueLabel(c: CardRow): string {
  if (c.queue === Queue.Suspended) return "Suspended";
  if (c.queue === Queue.UserBuried || c.queue === Queue.SchedBuried) return "Buried";
  return ["New", "Learning", "Review", "Relearning"][c.type] ?? "?";
}
