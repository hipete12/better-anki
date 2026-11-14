// Export to an Anki-compatible .apkg (schema 11 "collection.anki21" + JSON media map),
// importable by Anki desktop, AnkiDroid and AnkiMobile.
import { Database } from "bun:sqlite";
import { zipSync, strToU8 } from "fflate";
import type { Collection } from "../collection";
import type { CardRow, NoteRow } from "../types";
import { Queue } from "../types";
import { dayNumber, splitFields } from "../util";

const SCHEMA11 = `
create table col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
create table notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
create table cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
create table revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
create table graves (usn integer not null, oid integer not null, type integer not null);
create index ix_notes_usn on notes (usn);
create index ix_cards_usn on cards (usn);
create index ix_revlog_usn on revlog (usn);
create index ix_cards_nid on cards (nid);
create index ix_cards_sched on cards (did, queue, due);
create index ix_revlog_cid on revlog (cid);
create index ix_notes_csum on notes (csum);
`;

export interface ExportOptions {
  deckId?: number | null; // null = whole collection
  noteIds?: number[];
  includeScheduling?: boolean;
  includeMedia?: boolean;
}

export function exportApkg(col: Collection, opts: ExportOptions): Uint8Array {
  const sched = !!opts.includeScheduling;
  let cards: CardRow[];
  if (opts.noteIds?.length) {
    cards = col.db.query<CardRow, []>(`SELECT * FROM cards WHERE nid IN (${opts.noteIds.join(",")})`).all();
  } else if (opts.deckId) {
    const ids = col.deckAndChildren(opts.deckId);
    cards = col.db.query<CardRow, []>(`SELECT * FROM cards WHERE did IN (${ids.join(",")}) OR odid IN (${ids.join(",")})`).all();
  } else cards = col.db.query<CardRow, []>("SELECT * FROM cards").all();
  const nids = [...new Set(cards.map((c) => c.nid))];
  const notes: NoteRow[] = [];
  for (let i = 0; i < nids.length; i += 500)
    notes.push(...col.db.query<NoteRow, []>(`SELECT * FROM notes WHERE id IN (${nids.slice(i, i + 500).join(",")})`).all());

  const roll = col.config.rolloverHour;
  const today = col.today();
  const minDue = Math.min(today, ...cards.filter((c) => c.queue === Queue.Review || c.queue === Queue.DayLearn).map((c) => (c.odid ? c.odue : c.due)));
  const baseDay = Math.min(minDue, dayNumber(col.config.collectionCreated, roll)) - 1;
  let crt = baseDay * 86400 + roll * 3600;
  crt -= -new Date(crt * 1000).getTimezoneOffset() * 60;

  // decks used (with parents)
  const deckIds = new Set<number>([1]);
  for (const c of cards) {
    const home = c.odid || c.did;
    deckIds.add(home);
    for (const p of col.deckParents(home)) deckIds.add(p.id);
  }
  const decksJson: Record<string, unknown> = {};
  const confIds = new Set<number>([1]);
  for (const id of deckIds) {
    const d = col.deck(id);
    if (!d || d.kind === 1) continue;
    confIds.add(d.configId);
    decksJson[id] = {
      id,
      name: d.name,
      mod: d.mtime,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: d.collapsed,
      browserCollapsed: false,
      desc: d.description,
      dyn: 0,
      conf: d.configId,
      extendNew: 0,
      extendRev: 0,
    };
  }
  const dconfJson: Record<string, unknown> = {};
  for (const id of confIds) {
    const c = col.deckConfig(id);
    dconfJson[id] = {
      id,
      name: c.name,
      mod: c.mtime,
      usn: -1,
      maxTaken: c.capAnswerSecs,
      autoplay: !c.disableAutoplay,
      timer: c.showTimer ? 1 : 0,
      replayq: !c.skipQuestionWhenReplayingAnswer,
      dyn: false,
      new: { bury: c.buryNew, delays: c.learnSteps, initialFactor: Math.round(c.initialEase * 1000), ints: [c.graduatingIvl, c.easyIvl, 7], order: c.newInsertOrder === 1 ? 0 : 1, perDay: c.newPerDay },
      rev: { bury: c.buryReviews, ease4: c.easyMult, ivlFct: c.ivlMult, maxIvl: c.maxIvl, perDay: c.reviewsPerDay, hardFactor: c.hardMult },
      lapse: { delays: c.relearnSteps, leechAction: c.leechAction, leechFails: c.leechThreshold, minInt: c.minLapseIvl, mult: c.lapseMult },
      desiredRetention: c.desiredRetention,
      fsrsParams6: c.fsrsParams,
    };
  }
  const ntIds = new Set(notes.map((n) => n.ntid));
  const modelsJson: Record<string, unknown> = {};
  for (const id of ntIds) {
    const nt = col.notetype(id);
    if (!nt) continue;
    modelsJson[id] = {
      id,
      name: nt.name,
      type: nt.kind,
      mod: nt.mtime,
      usn: -1,
      sortf: nt.sortIdx,
      did: null,
      tmpls: nt.templates.map((t, i) => ({ name: t.name, ord: i, qfmt: t.qfmt, afmt: t.afmt, bqfmt: t.bqfmt ?? "", bafmt: t.bafmt ?? "", did: t.targetDeckId ?? null, bfont: "", bsize: 0 })),
      flds: nt.fields.map((f, i) => ({ name: f.name, ord: i, sticky: !!f.sticky, rtl: !!f.rtl, font: f.font ?? "Arial", size: f.size ?? 20, description: f.description ?? "", plainText: !!f.plainText, collapsed: !!f.collapsed, excludeFromSearch: !!f.excludeFromSearch, media: [] })),
      css: nt.css,
      latexPre: nt.latexPre,
      latexPost: nt.latexPost,
      latexsvg: false,
      req: nt.templates.map((_, i) => [i, "any", nt.fields.map((_f, j) => j)]),
      tags: [],
      vers: [],
      originalId: nt.originalId ?? undefined,
    };
  }

  const db = new Database(":memory:");
  let colBytes: Uint8Array;
  try {
    db.exec(SCHEMA11);
    const conf = { activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, curModel: null, nextPos: 1, sortType: "noteFld", sortBackwards: false, addToCur: true, schedVer: 2 };
    db.query("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)").run(
      crt,
      Date.now(),
      Date.now(),
      JSON.stringify(conf),
      JSON.stringify(modelsJson),
      JSON.stringify(decksJson),
      JSON.stringify(dconfJson),
      "{}",
    );
    const insN = db.query("INSERT INTO notes VALUES (?,?,?,?,-1,?,?,?,?,0,'')");
    for (const n of notes) insN.run(n.id, n.guid, n.ntid, n.mtime, n.tags, n.flds, n.sfld, n.csum);
    const insC = db.query("INSERT INTO cards VALUES (?,?,?,?,?,-1,?,?,?,?,?,?,?,?,0,0,?,?)");
    let pos = 0;
    const newOrder = [...cards].sort((a, b) => a.due - b.due);
    const newPos = new Map<number, number>();
    for (const c of newOrder) if (c.type === 0) newPos.set(c.id, ++pos);
    for (const c of cards) {
      const home = c.odid || c.did;
      let due = c.odid ? c.odue || c.due : c.due;
      if (!sched || c.type === 0) {
        const q = sched && c.queue < 0 ? c.queue : 0;
        insC.run(c.id, c.nid, home, c.ord, c.mtime, 0, q, newPos.get(c.id) ?? ++pos, 0, 0, 0, 0, 0, c.flags, "{}");
        continue;
      }
      let queue = c.queue === Queue.Preview ? c.type : c.queue;
      if (queue === Queue.Review || queue === Queue.DayLearn || (queue < 0 && c.type === 2)) due = due - baseDay;
      else if (queue < 0 && (c.type === 1 || c.type === 3) && due < 1e9) due = due - baseDay;
      const data: Record<string, number> = {};
      if (c.stability != null) data.s = Math.round(c.stability * 10000) / 10000;
      if (c.difficulty != null) data.d = Math.round(c.difficulty * 1000) / 1000;
      if (c.last_review) data.lrt = c.last_review;
      insC.run(c.id, c.nid, home, c.ord, c.mtime, c.type, queue, due, c.ivl, c.factor, c.reps, c.lapses, c.left, c.flags, JSON.stringify(data));
    }
    if (sched) {
      const insR = db.query("INSERT INTO revlog VALUES (?,?,-1,?,?,?,?,?,?)");
      for (let i = 0; i < cards.length; i += 500) {
        const ids = cards.slice(i, i + 500).map((c) => c.id);
        for (const r of col.db
          .query<{ id: number; cid: number; ease: number; ivl: number; last_ivl: number; factor: number; time: number; type: number }, []>(`SELECT * FROM revlog WHERE cid IN (${ids.join(",")})`)
          .all())
          insR.run(r.id, r.cid, r.ease, r.ivl, r.last_ivl, r.factor, r.time, r.type);
      }
    }
    colBytes = new Uint8Array(db.serialize());
  } finally {
    db.close();
  }

  const zipFiles: Record<string, Uint8Array> = { "collection.anki21": colBytes };
  const mediaMap: Record<string, string> = {};
  if (opts.includeMedia !== false) {
    const refs = new Set<string>();
    for (const n of notes)
      for (const f of splitFields(n.flds)) {
        for (const m of f.matchAll(/<(?:img|audio|video|source)\b[^>]*?\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) refs.add(safeDecode(m[1] ?? m[2] ?? m[3]));
        for (const m of f.matchAll(/\[sound:([^\]]+)\]/g)) refs.add(m[1]);
      }
    // template-referenced files (e.g. _fonts.ttf)
    for (const id of ntIds) {
      const nt = col.notetype(id);
      if (!nt) continue;
      const src = nt.css + nt.templates.map((t) => t.qfmt + t.afmt).join("");
      for (const m of src.matchAll(/["'(](_[^"')]+)["')]/g)) refs.add(m[1]);
    }
    let i = 0;
    for (const f of refs) {
      if (!/^[^/\\]+$/.test(f)) continue;
      const data = col.media.read(f);
      if (!data) continue;
      zipFiles[String(i)] = data;
      mediaMap[String(i)] = f;
      i++;
    }
  }
  zipFiles["media"] = strToU8(JSON.stringify(mediaMap));
  return zipSync(zipFiles, { level: 6 });
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
