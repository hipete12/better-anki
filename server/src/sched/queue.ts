// Study queues: deck limits, counts, next-card selection, answering, burying, undo.
import type { Collection } from "../collection";
import type { CardRow, Deck, DeckConfig } from "../types";
import { CardType, Queue } from "../types";
import { computeOutcomes, type Rating } from "./scheduler";
import { dayNumber, joinTags, newId, nowSecs, parseTags, seededRandom, shuffleSeeded, HttpError } from "../util";
import { FSRS } from "./fsrs";

interface Limits {
  newLeft: number;
  revLeft: number;
}

function deckToday(col: Collection, did: number, day: number) {
  return (
    col.db
      .query<{ new_done: number; rev_done: number; extend_new: number; extend_rev: number; ms: number }, [number, number]>(
        "SELECT new_done, rev_done, extend_new, extend_rev, ms FROM deck_today WHERE did=? AND day=?",
      )
      .get(did, day) ?? { new_done: 0, rev_done: 0, extend_new: 0, extend_rev: 0, ms: 0 }
  );
}

export function deckLimits(col: Collection, deck: Deck, day = col.today()): Limits {
  const conf = col.deckConfig(deck.configId);
  const t = deckToday(col, deck.id, day);
  const newLimit = deck.newLimit ?? conf.newPerDay;
  const revLimit = deck.reviewLimit ?? conf.reviewsPerDay;
  return {
    newLeft: Math.max(0, newLimit + t.extend_new - t.new_done),
    revLeft: Math.max(0, revLimit + t.extend_rev - t.rev_done),
  };
}

export function extendLimits(col: Collection, did: number, newDelta: number, revDelta: number) {
  const day = col.today();
  col.db
    .query(
      `INSERT INTO deck_today(did,day,extend_new,extend_rev) VALUES (?,?,?,?)
       ON CONFLICT(did,day) DO UPDATE SET extend_new=extend_new+excluded.extend_new, extend_rev=extend_rev+excluded.extend_rev`,
    )
    .run(did, day, newDelta, revDelta);
  col.emit("study", [did]);
}

function reviewOrderSql(order: number): string {
  switch (order) {
    case 3:
      return "ivl ASC";
    case 4:
      return "ivl DESC";
    case 5:
      return "factor ASC";
    case 6:
      return "factor DESC";
    case 9:
      return "nid ASC, ord ASC";
    case 10:
      return "nid DESC, ord ASC";
    default:
      return "due ASC";
  }
}

function newOrderSql(priority: number): string {
  switch (priority) {
    case 2:
      return "due DESC, ord ASC";
    default:
      return "due ASC, ord ASC";
  }
}

interface Gathered {
  learnNow: CardRow[]; // intraday learning due within learn-ahead
  dayLearn: CardRow[];
  reviews: CardRow[];
  news: CardRow[];
}

/** Gather today's cards for a deck tree respecting per-deck limits (Anki v3 style). */
export function gather(col: Collection, deckId: number, now = nowSecs(), forCounts = false): Gathered {
  const deck = col.deck(deckId);
  if (!deck) throw new HttpError(404, "Deck not found");
  const today = col.today(now);
  const learnAhead = now + col.config.learnAheadMins * 60;
  const dayEnd = now + 86400; // upper bound; intraday learning shown only when due <= learnAhead

  if (deck.kind === 1) {
    const all = col.db.query<CardRow, [number]>("SELECT * FROM cards WHERE did=? ORDER BY due, ord").all(deckId);
    return {
      learnNow: all.filter((c) => (c.queue === Queue.Learn || c.queue === Queue.Preview) && c.due <= learnAhead).sort((a, b) => a.due - b.due),
      dayLearn: all.filter((c) => c.queue === Queue.DayLearn && c.due <= today),
      reviews: all.filter((c) => c.queue === Queue.Review),
      news: all.filter((c) => c.queue === Queue.New),
    };
  }
  void dayEnd;

  const tree = col.deckAndChildren(deckId).map((id) => col.deck(id)!).filter((d) => d.kind === 0);
  const treeIds = tree.map((d) => d.id);
  const ph = treeIds.map(() => "?").join(",");
  const learnNow = col.db
    .query<CardRow, number[]>(`SELECT * FROM cards WHERE did IN (${ph}) AND queue IN (1,4) AND due <= ? ORDER BY due`)
    .all(...treeIds, learnAhead);

  // remaining limits per deck
  const remaining = new Map<number, Limits>();
  for (const d of tree) remaining.set(d.id, deckLimits(col, d, today));
  const chain = (d: Deck): number[] => {
    const ids = [d.id];
    if (d.id === deckId) return ids;
    for (const p of col.deckParents(d.id)) {
      ids.push(p.id);
      if (p.id === deckId) break;
    }
    return ids.filter((id) => remaining.has(id));
  };
  const avail = (ids: number[], key: keyof Limits) => Math.min(...ids.map((id) => remaining.get(id)![key]));
  const take = (ids: number[], key: keyof Limits, n: number) => {
    for (const id of ids) remaining.get(id)![key] -= n;
  };

  const rootConf = col.deckConfig(deck.configId);
  const dayLearn: CardRow[] = [];
  const reviews: CardRow[] = [];
  const news: CardRow[] = [];
  // interday learning + reviews (share review limit; interday learning first like Anki)
  for (const d of tree) {
    const ids = chain(d);
    const conf = col.deckConfig(d.configId);
    let cap = avail(ids, "revLeft");
    if (cap <= 0) continue;
    const dl = col.db
      .query<CardRow, [number, number, number]>("SELECT * FROM cards WHERE did=? AND queue=3 AND due<=? ORDER BY due LIMIT ?")
      .all(d.id, today, cap);
    dayLearn.push(...dl);
    take(ids, "revLeft", dl.length);
    cap -= dl.length;
    if (cap <= 0) continue;
    const rv = col.db
      .query<CardRow, [number, number, number]>(
        `SELECT * FROM cards WHERE did=? AND queue=2 AND due<=? ORDER BY ${reviewOrderSql(conf.reviewOrder)}, id LIMIT ?`,
      )
      .all(d.id, today, rootConf.reviewOrder === 7 || rootConf.reviewOrder === 11 || rootConf.reviewOrder === 12 ? 100000 : cap);
    const rvSorted = sortReviews(col, rv, rootConf.reviewOrder, today).slice(0, cap);
    reviews.push(...rvSorted);
    take(ids, "revLeft", rvSorted.length);
  }
  for (const d of tree) {
    const ids = chain(d);
    const conf = col.deckConfig(d.configId);
    let cap = avail(ids, "newLeft");
    if (!conf.newIgnoreReviewLimit) cap = Math.min(cap, avail(ids, "revLeft"));
    if (cap <= 0) continue;
    const nw = col.db
      .query<CardRow, [number, number]>(`SELECT * FROM cards WHERE did=? AND queue=0 ORDER BY ${newOrderSql(conf.newGatherPriority)} LIMIT ?`)
      .all(d.id, conf.newGatherPriority === 3 || conf.newGatherPriority === 4 || conf.newGatherPriority === 5 ? 100000 : cap);
    let picked = nw;
    if (conf.newGatherPriority === 3 || conf.newGatherPriority === 5) {
      // random notes, siblings kept together
      const byNote = new Map<number, CardRow[]>();
      for (const c of nw) byNote.set(c.nid, [...(byNote.get(c.nid) ?? []), c]);
      picked = shuffleSeeded([...byNote.keys()], today + d.id).flatMap((n) => byNote.get(n)!);
    } else if (conf.newGatherPriority === 4) picked = shuffleSeeded(nw, today + d.id);
    picked = picked.slice(0, cap);
    news.push(...picked);
    take(ids, "newLeft", picked.length);
    if (!conf.newIgnoreReviewLimit) take(ids, "revLeft", picked.length);
  }
  if (!forCounts) sortNew(news, rootConf, today);
  if (!forCounts && rootConf.reviewOrder === 0) {
    // due date, then random within the day
    reviews.sort((a, b) => a.due - b.due || seededRandom(a.id, today) - seededRandom(b.id, today));
  }
  return { learnNow, dayLearn, reviews, news };
}

function sortNew(news: CardRow[], conf: DeckConfig, today: number) {
  switch (conf.newSortOrder) {
    case 0: // template, then gather order
      news.splice(0, news.length, ...stableSort(news, (a, b) => a.ord - b.ord));
      break;
    case 2: {
      const shuffled = shuffleSeeded(news, today);
      news.splice(0, news.length, ...stableSort(shuffled, (a, b) => a.ord - b.ord));
      break;
    }
    case 3: {
      const notes = shuffleSeeded([...new Set(news.map((c) => c.nid))], today);
      const rank = new Map(notes.map((n, i) => [n, i]));
      news.sort((a, b) => rank.get(a.nid)! - rank.get(b.nid)! || a.ord - b.ord);
      break;
    }
    case 4:
      news.splice(0, news.length, ...shuffleSeeded(news, today));
      break;
    default:
      break; // no sort
  }
}

function stableSort<T>(arr: T[], cmp: (a: T, b: T) => number): T[] {
  return arr.map((v, i) => [v, i] as const).sort((a, b) => cmp(a[0], b[0]) || a[1] - b[1]).map((x) => x[0]);
}

function sortReviews(col: Collection, cards: CardRow[], order: number, today: number): CardRow[] {
  if (order === 8) return shuffleSeeded(cards, today);
  if (order === 7 || order === 11 || order === 12) {
    const fsrs = new FSRS();
    const r = (c: CardRow) => {
      if (c.stability && c.last_review) return fsrs.retrievability(today - dayNumber(c.last_review, col.config.rolloverHour), c.stability);
      const overdue = today - c.due;
      return c.ivl > 0 ? Math.pow(0.9, (c.ivl + overdue) / c.ivl) : 1;
    };
    const rel = (c: CardRow) => (today - c.due + c.ivl) / Math.max(1, c.ivl);
    if (order === 12) return [...cards].sort((a, b) => rel(b) - rel(a));
    return [...cards].sort((a, b) => (order === 7 ? r(a) - r(b) : r(b) - r(a)));
  }
  return cards;
}

export interface Counts {
  new: number;
  learn: number;
  review: number;
}

export function countsFor(col: Collection, deckId: number, now = nowSecs()): Counts {
  const g = gather(col, deckId, now, true);
  return { new: g.news.length, learn: g.learnNow.length + g.dayLearn.length, review: g.reviews.length };
}

export interface NextCard {
  card: CardRow;
  queue: "new" | "learn" | "review";
}

/** Pick the next card to study. */
export function nextCard(col: Collection, deckId: number, now = nowSecs()): { next: NextCard | null; counts: Counts; nextLearnDue: number | null } {
  const g = gather(col, deckId, now);
  const counts: Counts = { new: g.news.length, learn: g.learnNow.length + g.dayLearn.length, review: g.reviews.length };
  const dueLearn = g.learnNow.filter((c) => c.due <= now);
  if (dueLearn.length) return { next: { card: dueLearn[0], queue: "learn" }, counts, nextLearnDue: null };

  const deck = col.deck(deckId)!;
  const conf = col.deckConfig(deck.kind === 0 ? deck.configId : 1);
  // main queue: interday learning mixed with reviews, plus new cards per mix setting
  const revLike: { c: CardRow; q: "learn" | "review" }[] = [];
  if (conf.interdayLearningMix === 2) revLike.push(...g.dayLearn.map((c) => ({ c, q: "learn" as const })), ...g.reviews.map((c) => ({ c, q: "review" as const })));
  else if (conf.interdayLearningMix === 1) revLike.push(...g.reviews.map((c) => ({ c, q: "review" as const })), ...g.dayLearn.map((c) => ({ c, q: "learn" as const })));
  else {
    // mix: interleave evenly
    const a = g.dayLearn.map((c) => ({ c, q: "learn" as const }));
    const b = g.reviews.map((c) => ({ c, q: "review" as const }));
    const total = a.length + b.length;
    let ia = 0,
      ib = 0;
    for (let i = 0; i < total; i++) {
      if (ia < a.length && (ib >= b.length || (ia + 1) / (a.length + 1) <= (ib + 1) / (b.length + 1))) revLike.push(a[ia++]);
      else revLike.push(b[ib++]);
    }
  }
  let pick: NextCard | null = null;
  if (g.news.length && revLike.length) {
    if (conf.newMix === 1) pick = { card: revLike[0].c, queue: revLike[0].q };
    else if (conf.newMix === 2) pick = { card: g.news[0], queue: "new" };
    else {
      const t = deckToday(col, deckId, col.today(now));
      const done = t.new_done + t.rev_done;
      const modulus = Math.max(2, Math.floor((g.news.length + revLike.length) / g.news.length));
      pick = (done + 1) % modulus === 0 ? { card: g.news[0], queue: "new" } : { card: revLike[0].c, queue: revLike[0].q };
    }
  } else if (revLike.length) pick = { card: revLike[0].c, queue: revLike[0].q };
  else if (g.news.length) pick = { card: g.news[0], queue: "new" };
  if (pick) return { next: pick, counts, nextLearnDue: null };

  if (g.learnNow.length) return { next: { card: g.learnNow[0], queue: "learn" }, counts, nextLearnDue: null };

  // nothing left: when is the next learning card due?
  const ids = deck.kind === 1 ? [deckId] : col.deckAndChildren(deckId);
  const nl = col.db
    .query<{ m: number | null }, number[]>(`SELECT min(due) m FROM cards WHERE did IN (${ids.map(() => "?").join(",")}) AND queue IN (1,4)`)
    .get(...ids);
  return { next: null, counts, nextLearnDue: nl?.m ?? null };
}

// ---------------- undo ----------------
interface UndoEntry {
  id: number;
  label: string;
  cards: CardRow[]; // rows to restore
  deleteCards: number[];
  notes: { id: number; tags: string; mtime: number; flds?: string }[];
  revlog: number[];
  deckToday: { did: number; day: number; row: ReturnType<typeof deckToday> | null }[];
  reviewedCardId?: number;
}

const undoStack: UndoEntry[] = [];
const UNDO_LIMIT = 50;

export function undoStatus() {
  const top = undoStack[undoStack.length - 1];
  return top ? { label: top.label, available: true } : { label: null, available: false };
}

export function snapshotCards(col: Collection, cids: number[]): CardRow[] {
  if (!cids.length) return [];
  const out: CardRow[] = [];
  for (let i = 0; i < cids.length; i += 500) {
    const chunk = cids.slice(i, i + 500);
    out.push(...col.db.query<CardRow, number[]>(`SELECT * FROM cards WHERE id IN (${chunk.map(() => "?").join(",")})`).all(...chunk));
  }
  return out;
}

export function pushUndo(entry: Omit<UndoEntry, "id" | "deleteCards" | "notes" | "revlog" | "deckToday"> & Partial<UndoEntry>) {
  undoStack.push({ id: newId(), deleteCards: [], notes: [], revlog: [], deckToday: [], ...entry });
  while (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

export function clearUndo() {
  undoStack.length = 0;
}

function restoreCard(col: Collection, c: CardRow) {
  col.db
    .query(
      `INSERT OR REPLACE INTO cards(id,nid,did,ord,mtime,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,stability,difficulty,last_review,custom_data)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(c.id, c.nid, c.did, c.ord, c.mtime, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.odue, c.odid, c.flags, c.stability, c.difficulty, c.last_review, c.custom_data);
}

export function undo(col: Collection): { label: string; cardId?: number } | null {
  const e = undoStack.pop();
  if (!e) return null;
  col.tx(() => {
    for (const c of e.cards) restoreCard(col, c);
    for (const cid of e.deleteCards) col.db.query("DELETE FROM cards WHERE id=?").run(cid);
    for (const n of e.notes) {
      if (n.flds !== undefined && col.note(n.id)) col.updateNote(n.id, n.flds.split("\x1f"), parseTags(n.tags));
      col.db.query("UPDATE notes SET tags=?, mtime=? WHERE id=?").run(n.tags, n.mtime, n.id);
    }
    for (const r of e.revlog) col.db.query("DELETE FROM revlog WHERE id=?").run(r);
    for (const t of e.deckToday) {
      if (t.row)
        col.db
          .query("INSERT OR REPLACE INTO deck_today(did,day,new_done,rev_done,extend_new,extend_rev,ms) VALUES (?,?,?,?,?,?,?)")
          .run(t.did, t.day, t.row.new_done, t.row.rev_done, t.row.extend_new, t.row.extend_rev, t.row.ms);
      else col.db.query("DELETE FROM deck_today WHERE did=? AND day=?").run(t.did, t.day);
    }
  });
  col.emit("undo", e.cards.map((c) => c.id));
  return { label: e.label, cardId: e.reviewedCardId };
}

// ---------------- answering ----------------
/**
 * Answer a card. `now` is the review time (secs). Offline-sync replay passes the review's real time plus
 * `revlogId` (its ms timestamp, made unique) and turns off undo/emit.
 */
export function answerCard(col: Collection, cardId: number, rating: Rating, timeMs: number, now = nowSecs(), opts: { revlogId?: number; undo?: boolean; emit?: boolean; countToday?: boolean } = {}) {
  const card = col.card(cardId);
  if (!card) throw new HttpError(404, "Card not found");
  if (card.queue < 0) throw new HttpError(409, "Card is suspended or buried");
  const conf = col.configForCard(card);
  const outcomes = computeOutcomes(col, card, now);
  const o = outcomes[rating];
  const day = col.today(now);
  const homeDid = card.odid || card.did;
  const affectedDecks = [homeDid, ...col.deckParents(homeDid).map((d) => d.id)];
  if (card.odid) affectedDecks.push(card.did);
  const entry: UndoEntry = {
    id: newId(),
    label: "Review",
    cards: [card],
    deleteCards: [],
    notes: [],
    revlog: [],
    deckToday: affectedDecks.map((did) => ({
      did,
      day,
      row: col.db.query<ReturnType<typeof deckToday>, [number, number]>("SELECT new_done, rev_done, extend_new, extend_rev, ms FROM deck_today WHERE did=? AND day=?").get(did, day) ?? null,
    })),
    reviewedCardId: cardId,
  };
  const ms = Math.min(Math.max(0, Math.round(timeMs)), Math.max(1, conf.capAnswerSecs) * 1000);
  col.tx(() => {
    const c = o.card;
    if (o.returnHome && c.odid) {
      if (o.previewReturn) {
        // preview finished: restore original scheduling
        c.queue = c.type === CardType.New ? Queue.New : c.type === CardType.Review ? Queue.Review : (c.odue || c.due) > 1e9 ? Queue.Learn : Queue.DayLearn;
        c.due = c.odue || c.due;
      }
      c.did = c.odid;
      c.odid = 0;
      c.odue = 0;
    }
    if (o.leech) {
      const note = col.note(c.nid)!;
      entry.notes.push({ id: note.id, tags: note.tags, mtime: note.mtime });
      col.db.query("UPDATE notes SET tags=?, mtime=? WHERE id=?").run(joinTags([...parseTags(note.tags), "leech"]), now, note.id);
      col.registerTags(["leech"]);
      if (conf.leechAction === 0) c.queue = Queue.Suspended;
    }
    restoreCard(col, c);
    let rid = opts.revlogId ?? Date.now();
    while (col.db.query("SELECT 1 FROM revlog WHERE id=?").get(rid)) rid++;
    col.db
      .query("INSERT INTO revlog(id,cid,ease,ivl,last_ivl,factor,time,type) VALUES (?,?,?,?,?,?,?,?)")
      .run(rid, cardId, o.revlog.ease, o.revlog.ivl, o.revlog.lastIvl, o.revlog.factor, ms, o.revlog.type);
    entry.revlog.push(rid);
    const wasNew = card.type === CardType.New;
    const wasReview = card.queue === Queue.Review || card.queue === Queue.DayLearn;
    const upd = col.db.query(
      `INSERT INTO deck_today(did,day,new_done,rev_done,ms) VALUES (?,?,?,?,?)
       ON CONFLICT(did,day) DO UPDATE SET new_done=new_done+excluded.new_done, rev_done=rev_done+excluded.rev_done, ms=ms+excluded.ms`,
    );
    if (opts.countToday !== false) for (const did of affectedDecks) upd.run(did, day, wasNew ? 1 : 0, wasReview ? 1 : 0, ms);
    // bury siblings
    const buryTypes: number[] = [];
    if (conf.buryNew) buryTypes.push(Queue.New);
    if (conf.buryReviews) buryTypes.push(Queue.Review);
    if (conf.buryInterday) buryTypes.push(Queue.DayLearn);
    if (buryTypes.length) {
      const sibs = col.db
        .query<CardRow, [number, number]>(`SELECT * FROM cards WHERE nid=? AND id!=? AND queue IN (${buryTypes.join(",")})`)
        .all(card.nid, cardId)
        .filter((s) => s.queue !== Queue.Review || s.due <= day)
        .filter((s) => s.queue !== Queue.DayLearn || s.due <= day);
      for (const s of sibs) {
        entry.cards.push(s);
        col.db.query("UPDATE cards SET queue=-2, mtime=? WHERE id=?").run(now, s.id);
      }
    }
  });
  if (opts.undo !== false) {
    undoStack.push(entry);
    while (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }
  if (opts.emit !== false) col.emit("review", [cardId]);
  return { card: col.card(cardId)!, leech: o.leech };
}

/** Unbury cards buried on previous days (called lazily on day change). */
export function unburyIfNewDay(col: Collection) {
  const day = col.today();
  const last = col.getKV<number>("lastUnburiedDay", 0);
  if (last === day) return;
  col.db.query("UPDATE cards SET queue=(CASE WHEN type=0 THEN 0 WHEN type=2 THEN 2 WHEN type IN (1,3) THEN (CASE WHEN due > 1000000000 THEN 1 ELSE 3 END) ELSE type END) WHERE queue IN (-2,-3)").run();
  // preview cards left in queue 4 from previous days
  col.setKV("lastUnburiedDay", day);
  col.db.query("DELETE FROM deck_today WHERE day < ?").run(day - 60);
}

export function unburyDeck(col: Collection, deckId: number) {
  const ids = col.deckAndChildren(deckId);
  col.db
    .query(
      `UPDATE cards SET queue=(CASE WHEN type=0 THEN 0 WHEN type=2 THEN 2 WHEN type IN (1,3) THEN (CASE WHEN due > 1000000000 THEN 1 ELSE 3 END) ELSE type END), mtime=? WHERE queue IN (-2,-3) AND did IN (${ids.join(",")})`,
    )
    .run(nowSecs());
  col.emit("cards");
}

export function buriedCount(col: Collection, deckId: number): number {
  const ids = col.deckAndChildren(deckId);
  return col.db.query<{ n: number }, []>(`SELECT count(*) n FROM cards WHERE queue IN (-2,-3) AND did IN (${ids.join(",")})`).get()?.n ?? 0;
}

export function studiedToday(col: Collection) {
  const day = col.today();
  const roll = col.config.rolloverHour;
  let start = day * 86400 + roll * 3600;
  start -= -new Date(start * 1000).getTimezoneOffset() * 60;
  const r = col.db
    .query<{ n: number; t: number; again: number; lrn: number; rev: number; rel: number; filt: number; mature: number; matureCorrect: number }, [number]>(
      `SELECT count(*) n, coalesce(sum(time),0) t, coalesce(sum(ease=1),0) again,
        coalesce(sum(type=0),0) lrn, coalesce(sum(type=1),0) rev, coalesce(sum(type=2),0) rel, coalesce(sum(type=3),0) filt,
        coalesce(sum(type=1 AND last_ivl>=21),0) mature, coalesce(sum(type=1 AND last_ivl>=21 AND ease>1),0) matureCorrect
       FROM revlog WHERE id >= ? AND ease > 0 AND type != 4`,
    )
    .get(start * 1000)!;
  return { cards: r.n, timeMs: r.t, again: r.again, learn: r.lrn, review: r.rev, relearn: r.rel, filtered: r.filt, mature: r.mature, matureCorrect: r.matureCorrect, since: start };
}
