// Offline study: download packs and sync offline actions back. Design and conflict rules: docs/OFFLINE.md.
import type { Collection } from "./collection";
import type { CardRow, DeckConfig } from "./types";
import { CardType, Queue } from "./types";
import { answerCard } from "./sched/queue";
import { assert, clamp, HttpError, intervalLabel, joinTags, localOffsetSecs, nowSecs, parseTags, stripHtml } from "./util";
import { fieldMediaRefs, notetypeMediaRefs } from "./maintenance";

// ---------------------------------------------------------------- versions

export function syncVersion(col: Collection): number {
  return col.db.query<{ version: number }, []>("SELECT version FROM sync_state WHERE id = 1").get()!.version;
}
/** Start a new version: returns the current one (which now covers everything so far) and moves on. */
function nextVersion(col: Collection): number {
  const v = syncVersion(col);
  col.db.query("UPDATE sync_state SET version = ? WHERE id = 1").run(v + 1);
  return v;
}
type SyncedCard = CardRow & { usn: number };

// ---------------------------------------------------------------- download

export interface RenderedCard {
  question: string;
  answer: string;
  hasTypeAnswer: boolean;
  questionText: string;
}

/** Cards, pages, options and media list for studying the given decks offline for `days` days. */
export function buildPack(col: Collection, opts: { deckIds: number[]; days?: number }, render: (c: CardRow) => RenderedCard, mediaBase: string) {
  assert(Array.isArray(opts.deckIds) && opts.deckIds.length > 0, "Choose at least one deck");
  const days = clamp(Math.round(opts.days ?? 7), 1, 30);
  const now = nowSecs();
  const today = col.today(now);
  const deckIds = new Set<number>();
  for (const id of opts.deckIds) {
    const d = col.deck(Number(id));
    assert(d, "Deck not found", 404);
    for (const t of col.deckAndChildren(d.id)) if (col.deck(t)?.kind === 0) deckIds.add(t);
  }
  assert(deckIds.size > 0, "Filtered decks can't be studied offline");
  const decks = [...deckIds].map((id) => col.deck(id)!);
  const inDecks = [...deckIds].join(",");

  // learning and buried cards, reviews due within the window, and each deck's next new cards for the window
  const rows: CardRow[] = col.db
    .query<CardRow, [number]>(
      `SELECT * FROM cards WHERE odid = 0 AND did IN (${inDecks}) AND (queue IN (1, 3, -2, -3) OR (queue = 2 AND due <= ?)) ORDER BY id`,
    )
    .all(today + days);
  for (const d of decks) {
    const conf = col.deckConfig(d.configId);
    const perDay = d.newLimit ?? conf.newPerDay;
    if (perDay <= 0) continue;
    rows.push(...col.db.query<CardRow, [number, number]>("SELECT * FROM cards WHERE did = ? AND queue = 0 ORDER BY due, ord LIMIT ?").all(d.id, perDay * days));
  }

  const media = new Set<string>();
  const seenNotetypes = new Set<number>();
  const cards = rows.map((c) => {
    const note = col.note(c.nid)!;
    fieldMediaRefs(note.flds, media);
    if (!seenNotetypes.has(note.ntid)) {
      seenNotetypes.add(note.ntid);
      notetypeMediaRefs(col.notetype(note.ntid)!, media);
    }
    const page = render(c);
    return {
      ...schedulingOf(c),
      nid: c.nid,
      ord: c.ord,
      usn: (c as SyncedCard).usn,
      marked: parseTags(note.tags).some((t) => t.toLowerCase() === "marked"),
      ...page,
    };
  });
  const sizes = new Map(col.db.query<{ fname: string; size: number }, []>("SELECT fname, size FROM media").all().map((m) => [m.fname, m.size]));
  const configIds = [...new Set(decks.map((d) => d.configId))];
  const base = nextVersion(col);
  return {
    base,
    serverTime: Date.now(),
    tzOffsetSecs: localOffsetSecs(now),
    today,
    days,
    config: { fsrs: col.config.fsrs, rolloverHour: col.config.rolloverHour, learnAheadMins: col.config.learnAheadMins, timeboxMins: col.config.timeboxMins },
    roots: opts.deckIds.map(Number),
    decks: decks.map((d) => ({ id: d.id, name: d.name, configId: d.configId, newLimit: d.newLimit ?? null, reviewLimit: d.reviewLimit ?? null, desiredRetention: d.desiredRetention ?? null })),
    deckConfigs: configIds.map((id) => col.deckConfig(id)) as DeckConfig[],
    deckToday: col.db
      .query<{ did: number; new_done: number; rev_done: number; extend_new: number; extend_rev: number; ms: number }, [number]>(
        `SELECT did, new_done, rev_done, extend_new, extend_rev, ms FROM deck_today WHERE day = ? AND did IN (${inDecks})`,
      )
      .all(today),
    cards,
    mediaBase,
    media: [...media].filter((f) => sizes.has(f)).map((name) => ({ name, size: sizes.get(name)! })),
  };
}

/** The scheduling fields of a card: what a device keeps as its base copy and what sync restores. */
function schedulingOf(c: CardRow) {
  return {
    id: c.id,
    did: c.did,
    odid: c.odid,
    type: c.type,
    queue: c.queue,
    due: c.due,
    odue: c.odue,
    ivl: c.ivl,
    factor: c.factor,
    reps: c.reps,
    lapses: c.lapses,
    left: c.left,
    flags: c.flags,
    stability: c.stability,
    difficulty: c.difficulty,
    last_review: c.last_review,
  };
}
export type BaseCard = ReturnType<typeof schedulingOf>;

// ---------------------------------------------------------------- sync

export type Resolution = "merge" | "offline" | "server";
export const RESOLUTIONS: Resolution[] = ["merge", "offline", "server"];
type EventKind = "answer" | "bury" | "buryNote" | "suspend" | "suspendNote" | "flag" | "mark";
const KINDS = new Set<EventKind>(["answer", "bury", "buryNote", "suspend", "suspendNote", "flag", "mark"]);

export interface OfflineEvent {
  id: string;
  kind: EventKind;
  cardId: number;
  /** Device clock, ms. */
  at: number;
  ease?: number;
  timeMs?: number;
  flag?: number;
  marked?: boolean;
}

export interface SyncRequest {
  /** Client-chosen id for this sync; a retry with the same id returns the stored result. */
  syncId: string;
  /** Sync version the device downloaded (or last synced) at. */
  base: number;
  /** Server time of that download (ms), from the pack. Event times are never moved before it. */
  packTime: number;
  /** Device clock when sending (ms), for clock correction. */
  deviceNow: number;
  events: OfflineEvent[];
  /** The device's base copy of every card the events touch. */
  baseCards: BaseCard[];
  /** Choice per conflicting card id. */
  resolutions?: Record<string, Resolution>;
  /** Only report what would happen. */
  dryRun?: boolean;
  /** Every card in the device's pack: the result returns those that changed, so the pack stays current. */
  packCardIds?: number[];
}

/** An event on the server's timeline: corrected time, and whether it's a server review being replayed (merge). */
type TimedEvent = OfflineEvent & { seq: number; fromServer?: boolean };

const EASE = ["", "Again", "Hard", "Good", "Easy"];
const FLAG = ["", "Red", "Orange", "Green", "Blue", "Pink", "Turquoise", "Purple"];
const ROLLBACK = Symbol("rollback");

function validate(req: SyncRequest) {
  assert(req && typeof req.syncId === "string" && req.syncId.length > 0 && req.syncId.length <= 100, "Missing sync id");
  for (const k of ["base", "packTime", "deviceNow"] as const) assert(Number.isFinite(req[k]), `Missing ${k}`);
  assert(Array.isArray(req.events) && req.events.length <= 50_000, "Invalid events");
  assert(Array.isArray(req.baseCards ?? []), "Invalid base cards");
  for (const e of req.events) {
    assert(e && KINDS.has(e.kind) && Number.isFinite(e.cardId) && Number.isFinite(e.at), "Invalid event");
    if (e.kind === "answer") assert([1, 2, 3, 4].includes(e.ease!), "Invalid ease");
    if (e.kind === "flag") assert(Number.isInteger(e.flag) && e.flag! >= 0 && e.flag! <= 7, "Invalid flag");
  }
  for (const r of Object.values(req.resolutions ?? {})) assert(RESOLUTIONS.includes(r), "Invalid resolution");
}

/**
 * Apply offline actions. Without a choice for every conflicting card (or with dryRun), nothing is changed and the
 * conflicts are returned with what happened on each side and the card's state under each choice.
 */
export function syncOffline(col: Collection, req: SyncRequest) {
  validate(req);
  const done = col.getKV<Record<string, SyncResult>>("offlineSyncs", {});
  if (!req.dryRun && done[req.syncId]) return { ...done[req.syncId], repeated: true };

  // clock correction: move device times onto the server clock, never before the download or after now
  const now = Date.now();
  const offset = now - req.deviceNow;
  const lo = Math.min(req.packTime, now);
  const events: TimedEvent[] = req.events
    .map((e, i) => ({ ...e, cardId: Number(e.cardId), at: clamp(Math.round(e.at + offset), lo, now), seq: i }))
    .sort((a, b) => a.at - b.at || a.seq - b.seq);
  const baseById = new Map((req.baseCards ?? []).map((c) => [Number(c.id), c]));

  const touched = [...new Set(events.map((e) => e.cardId))];
  const conflicts: number[] = [];
  const deleted: number[] = [];
  for (const id of touched) {
    const c = col.card(id) as SyncedCard | undefined;
    if (!c) deleted.push(id);
    else if (c.usn > req.base) conflicts.push(id);
  }
  for (const id of conflicts) assert(baseById.has(id), "The device didn't send its copy of a changed card; download again and retry");
  const plan: Plan = { base: req.base, events, conflicts, deleted, baseById };
  const counts = { reviews: events.filter((e) => e.kind === "answer" && !deleted.includes(e.cardId)).length, touched: touched.length - deleted.length };
  const dropped = deleted.map((cardId) => ({ cardId, reason: "deleted" as const, actions: events.filter((e) => e.cardId === cardId).length }));

  const resolutions = req.resolutions ?? {};
  const unresolved = conflicts.filter((id) => !resolutions[id]);
  if (req.dryRun || unresolved.length) {
    return { status: req.dryRun ? ("preview" as const) : ("conflicts" as const), conflicts: describeConflicts(col, plan), autoMerged: touched.length - conflicts.length - deleted.length, ...counts, dropped };
  }

  let result!: SyncResult;
  col.tx(() => {
    apply(col, plan, resolutions);
    const newBase = nextVersion(col);
    const packIds = [...new Set((req.packCardIds ?? []).map(Number).filter(Number.isFinite))];
    const changed: BaseCard[] = [];
    const missing: number[] = [];
    for (let i = 0; i < packIds.length; i += 500) {
      const chunk = packIds.slice(i, i + 500);
      const rows = col.db.query<SyncedCard, []>(`SELECT * FROM cards WHERE id IN (${chunk.join(",")})`).all();
      const found = new Set(rows.map((r) => r.id));
      for (const r of rows) if (r.usn > req.base) changed.push(schedulingOf(r));
      for (const id of chunk) if (!found.has(id)) missing.push(id);
    }
    result = {
      status: "ok",
      newBase,
      cards: changed,
      missing,
      ...counts,
      autoMerged: touched.length - conflicts.length - deleted.length,
      resolved: conflicts.map((cardId) => ({ cardId, resolution: resolutions[cardId] })),
      dropped,
    };
    // remember recent results so a retried request isn't applied twice
    const keep = Object.entries({ ...done, [req.syncId]: result }).slice(-50);
    col.setKV("offlineSyncs", Object.fromEntries(keep));
  });
  col.emit("cards", touched);
  return result;
}

interface SyncResult {
  status: "ok";
  newBase: number;
  /** Current scheduling of pack cards that changed since the base (including the ones just synced). */
  cards: BaseCard[];
  /** Pack cards that no longer exist. */
  missing: number[];
  reviews: number;
  /** Cards the offline actions touched (that still exist). */
  touched: number;
  autoMerged: number;
  resolved: { cardId: number; resolution: Resolution }[];
  dropped: { cardId: number; reason: "deleted"; actions: number }[];
}

interface Plan {
  base: number;
  events: TimedEvent[];
  conflicts: number[];
  deleted: number[];
  baseById: Map<number, BaseCard>;
}

/** Replay the plan with the given choices for conflicting cards. */
function apply(col: Collection, plan: Plan, resolutions: Record<string, Resolution>) {
  const deleted = new Set(plan.deleted);
  const skip = new Set(plan.conflicts.filter((id) => resolutions[id] === "server"));
  const replay: TimedEvent[] = plan.events.filter((e) => !deleted.has(e.cardId) && !skip.has(e.cardId));
  const fixups: (() => void)[] = [];
  for (const id of plan.conflicts) {
    const choice = resolutions[id];
    if (choice === "server") continue;
    const server = col.card(id)!;
    const base = plan.baseById.get(id)!;
    if (choice === "merge") {
      // the server's reviews since the download are replayed together with the offline ones
      const revs = col.db
        .query<{ id: number; ease: number; time: number }, [number, number]>("SELECT id, ease, time FROM revlog WHERE cid = ? AND usn > ? AND ease > 0 AND type <= 3 ORDER BY id")
        .all(id, plan.base);
      revs.forEach((r, i) => replay.push({ id: `server-${r.id}`, kind: "answer", cardId: id, ease: r.ease, timeMs: r.time, at: r.id, seq: -1e6 + i, fromServer: true }));
      const offline = plan.events.filter((e) => e.cardId === id);
      fixups.push(() => latestWins(col, id, server, base, offline));
    }
    // the card's history since the download is rebuilt from the replay
    col.db.query("DELETE FROM revlog WHERE cid = ? AND usn > ?").run(id, plan.base);
    restoreBase(col, server, base);
  }
  replay.sort((a, b) => a.at - b.at || a.seq - b.seq);
  for (const e of replay) applyEvent(col, e);
  for (const f of fixups) f();
}

/** Put a card back to the device's base copy (scheduling only; a card the server moved stays in its new deck). */
function restoreBase(col: Collection, server: CardRow, b: BaseCard) {
  const did = server.odid || server.did; // leaving any filtered deck the server put it in
  col.db
    .query(
      `UPDATE cards SET did=?, odid=0, odue=0, type=?, queue=?, due=?, ivl=?, factor=?, reps=?, lapses=?, left=?, flags=?, stability=?, difficulty=?, last_review=?, mtime=? WHERE id=?`,
    )
    .run(did, b.type, b.queue, b.due, b.ivl, b.factor, b.reps, b.lapses, b.left, b.flags, b.stability, b.difficulty, b.last_review, nowSecs(), server.id);
}

/** After a merge, flag and suspend/bury follow whichever side changed them last. */
function latestWins(col: Collection, id: number, server: CardRow, base: BaseCard, offline: TimedEvent[]) {
  const c = col.card(id);
  if (!c) return;
  const lastFlag = offline.filter((e) => e.kind === "flag").at(-1);
  if ((server.flags & 7) !== (base.flags & 7) && (!lastFlag || server.mtime * 1000 >= lastFlag.at)) col.db.query("UPDATE cards SET flags=? WHERE id=?").run(server.flags, id);
  if (server.queue === Queue.Suspended && base.queue !== Queue.Suspended) col.db.query("UPDATE cards SET queue=-1 WHERE id=?").run(id);
  else if ((server.queue === Queue.SchedBuried || server.queue === Queue.UserBuried) && base.queue >= 0 && c.queue >= 0) col.db.query("UPDATE cards SET queue=? WHERE id=?").run(server.queue, id);
}

const UNBURIED_QUEUE = "(CASE WHEN type=0 THEN 0 WHEN type=2 THEN 2 WHEN type IN (1,3) THEN (CASE WHEN due > 1000000000 THEN 1 ELSE 3 END) ELSE type END)";

function applyEvent(col: Collection, e: TimedEvent) {
  const c = col.card(e.cardId);
  if (!c) return;
  const secs = Math.floor(e.at / 1000);
  switch (e.kind) {
    case "answer": {
      // the review happened, so answer even if the replay buried or leech-suspended the card meanwhile
      const wasSuspended = c.queue === Queue.Suspended;
      if (c.queue < 0) col.db.query(`UPDATE cards SET queue=${UNBURIED_QUEUE} WHERE id=?`).run(c.id);
      answerCard(col, c.id, e.ease as 1 | 2 | 3 | 4, e.timeMs ?? 0, secs, { revlogId: e.at, undo: false, emit: false, countToday: !e.fromServer });
      if (wasSuspended) col.db.query("UPDATE cards SET queue=-1 WHERE id=?").run(c.id);
      break;
    }
    case "bury":
    case "buryNote": {
      const ids = e.kind === "bury" ? [c.id] : col.cardsOfNote(c.nid).map((x) => x.id);
      col.db.query(`UPDATE cards SET queue=-3, mtime=? WHERE queue >= 0 AND id IN (${ids.join(",")})`).run(secs);
      break;
    }
    case "suspend":
    case "suspendNote": {
      const ids = e.kind === "suspend" ? [c.id] : col.cardsOfNote(c.nid).map((x) => x.id);
      col.db.query(`UPDATE cards SET queue=-1, mtime=? WHERE id IN (${ids.join(",")})`).run(secs);
      break;
    }
    case "flag":
      col.db.query("UPDATE cards SET flags=(flags & ~7) | ?, mtime=? WHERE id=?").run(e.flag! & 7, secs, c.id);
      break;
    case "mark": {
      const note = col.note(c.nid);
      if (!note) break;
      const tags = parseTags(note.tags).filter((t) => t.toLowerCase() !== "marked");
      if (e.marked) tags.push("marked");
      col.db.query("UPDATE notes SET tags=?, mtime=? WHERE id=?").run(joinTags(tags), secs, note.id);
      if (e.marked) col.registerTags(["marked"]);
      break;
    }
  }
}

// ---------------------------------------------------------------- describing conflicts

interface Change {
  text: string;
  at?: number;
}

function describeConflicts(col: Collection, plan: Plan) {
  if (!plan.conflicts.length) return [];
  // the card's state under each choice: run the whole sync and roll it back
  const outcomes = new Map<number, Partial<Record<Resolution, string>>>();
  for (const r of RESOLUTIONS) {
    const uniform = Object.fromEntries(plan.conflicts.map((id) => [id, r]));
    try {
      col.tx(() => {
        apply(col, plan, uniform);
        for (const id of plan.conflicts) outcomes.set(id, { ...outcomes.get(id), [r]: stateLabel(col, col.card(id)) });
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
  }
  return plan.conflicts.map((id) => {
    const server = col.card(id)!;
    const note = col.note(server.nid);
    return {
      cardId: id,
      question: note ? stripHtml(note.sfld).slice(0, 80) : "",
      server: serverChanges(col, server, plan.baseById.get(id)!, plan.base),
      offline: plan.events.filter((e) => e.cardId === id).map(offlineChange),
      outcomes: outcomes.get(id)!,
    };
  });
}

function serverChanges(col: Collection, s: CardRow, b: BaseCard, base: number): Change[] {
  const out: Change[] = [];
  for (const r of col.db.query<{ id: number; ease: number; ivl: number; type: number }, [number, number]>("SELECT id, ease, ivl, type FROM revlog WHERE cid = ? AND usn > ? ORDER BY id").all(s.id, base)) {
    if (r.ease > 0 && r.type <= 3) out.push({ text: `Reviewed · ${EASE[r.ease]}`, at: r.id });
    else out.push({ text: r.ivl > 0 ? `Due date changed (${r.ivl}d interval)` : "Rescheduled", at: r.id });
  }
  if (s.type === CardType.New && b.type !== CardType.New) out.push({ text: "Reset to new" });
  if (s.queue === Queue.Suspended && b.queue !== Queue.Suspended) out.push({ text: "Suspended" });
  if ((s.queue === Queue.SchedBuried || s.queue === Queue.UserBuried) && b.queue >= 0) out.push({ text: "Buried" });
  if ((s.flags & 7) !== (b.flags & 7)) out.push({ text: s.flags & 7 ? `Flag: ${FLAG[s.flags & 7]}` : "Flag removed" });
  if (s.odid) out.push({ text: `Moved into filtered deck "${col.deck(s.did)?.name ?? "?"}"` });
  else if (s.did !== b.did) out.push({ text: `Moved to "${col.deck(s.did)?.name ?? "?"}"` });
  if (!out.length) out.push({ text: "Changed on the server" });
  return out;
}

function offlineChange(e: TimedEvent): Change {
  const text =
    e.kind === "answer"
      ? `Reviewed · ${EASE[e.ease!]}`
      : e.kind === "flag"
        ? e.flag
          ? `Flag: ${FLAG[e.flag]}`
          : "Flag removed"
        : e.kind === "mark"
          ? e.marked
            ? "Marked"
            : "Unmarked"
          : { bury: "Buried", buryNote: "Buried with its note", suspend: "Suspended", suspendNote: "Suspended with its note" }[e.kind];
  return { text, at: e.at };
}

/** Short description of where a card stands, e.g. "Review · due in 4d". */
export function stateLabel(col: Collection, c: CardRow | undefined | null): string {
  if (!c) return "Deleted";
  if (c.queue === Queue.Suspended) return "Suspended";
  if (c.queue === Queue.SchedBuried || c.queue === Queue.UserBuried) return "Buried";
  if (c.type === CardType.New) return "New";
  const now = nowSecs();
  const dueIn = c.queue === Queue.Learn ? c.due - now : (c.due - col.today(now)) * 86400;
  const when = dueIn <= 0 ? "due now" : `due in ${intervalLabel(dueIn)}`;
  const kind = c.type === CardType.Relearn ? "Relearning" : c.type === CardType.Learn ? "Learning" : "Review";
  return `${kind} · ${when}`;
}

export { HttpError };
