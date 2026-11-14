// Import Anki packages (.apkg / .colpkg): legacy (collection.anki2 / .anki21,
// JSON media map) and latest (collection.anki21b, zstd + protobuf, schema 18).
import { Database } from "bun:sqlite";
import { unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Collection } from "../collection";
import { sortFieldValue } from "../collection";
import type { DeckConfig, FieldDef, FilteredConfig, Notetype, TemplateDef } from "../types";
import { CardType, Queue } from "../types";
import { ProtoMsg } from "./protobuf";
import { dayNumber, fieldChecksum, newId, nowSecs, sha1Hex, splitFields, joinFields, parseTags } from "../util";
import { defaultDeckConfig } from "../stock";
import { clearUndo } from "../sched/queue";

export interface ImportOptions {
  includeScheduling?: boolean; // default true
  updateNotes?: "ifNewer" | "always" | "never"; // default ifNewer
  targetDeckId?: number | null; // put all cards in this deck instead
}

export interface ImportResult {
  notesAdded: number;
  notesUpdated: number;
  notesSkipped: number;
  cardsAdded: number;
  decks: string[];
  notetypes: string[];
  media: number;
  revlog: number;
  warnings: string[];
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
function isZstd(b: Uint8Array) {
  return b.length > 4 && ZSTD_MAGIC.every((m, i) => b[i] === m);
}
function maybeZstd(b: Uint8Array): Uint8Array {
  return isZstd(b) ? new Uint8Array(Bun.zstdDecompressSync(b)) : b;
}

interface SrcNotetype extends Notetype {}
interface SrcDeck {
  id: number;
  name: string;
  dyn: boolean;
  confId: number;
  desc: string;
  filtered?: FilteredConfig;
}

export function importApkg(col: Collection, data: Uint8Array, opts: ImportOptions = {}): ImportResult {
  const includeSched = opts.includeScheduling !== false;
  const updateMode = opts.updateNotes ?? "ifNewer";
  const res: ImportResult = { notesAdded: 0, notesUpdated: 0, notesSkipped: 0, cardsAdded: 0, decks: [], notetypes: [], media: 0, revlog: 0, warnings: [] };

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch (e) {
    throw new Error("Not a valid Anki package (zip could not be read)");
  }
  let colBytes: Uint8Array | undefined;
  if (files["collection.anki21b"]) colBytes = maybeZstd(files["collection.anki21b"]);
  else if (files["collection.anki21"]) colBytes = files["collection.anki21"];
  else if (files["collection.anki2"]) colBytes = files["collection.anki2"];
  if (!colBytes) throw new Error("No collection found inside package");

  // media map
  const mediaMap = new Map<string, string>(); // zip entry -> filename
  if (files["media"]) {
    const raw = maybeZstd(files["media"]);
    const text = new TextDecoder().decode(raw);
    if (text.trim().startsWith("{")) {
      for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, string>)) mediaMap.set(k, v);
    } else {
      const m = new ProtoMsg(raw);
      m.msgs(1).forEach((e, i) => {
        const idx = e.has(255) ? e.num(255) : i;
        mediaMap.set(String(idx), e.str(1));
      });
    }
  }

  // Decode entirely in memory: no plaintext copy of the deck touches the disk.
  const src = Database.deserialize(patchCustomCollations(colBytes));
  try {
    const colRow = src.query<{ crt: number; ver: number; models: string; decks: string; dconf: string }, []>("SELECT crt, ver, models, decks, dconf FROM col").get();
    if (!colRow) throw new Error("Collection is empty or corrupt");
    const crt = colRow.crt;
    const modern = colRow.ver >= 18 || !!src.query("SELECT name FROM sqlite_master WHERE name='notetypes'").get();
    const ntList: SrcNotetype[] = modern ? readModernNotetypes(src) : readLegacyNotetypes(colRow.models);
    const deckList: SrcDeck[] = modern ? readModernDecks(src) : readLegacyDecks(colRow.decks);
    const confList: DeckConfig[] = modern ? readModernConfigs(src) : readLegacyConfigs(colRow.dconf);

    // detect "please update Anki" dummy collections
    const noteCount = src.query<{ n: number }, []>("SELECT count(*) n FROM notes").get()!.n;
    if (noteCount === 1 && !files["collection.anki21b"]) {
      const n = src.query<{ flds: string }, []>("SELECT flds FROM notes").get();
      if (n && /update to the latest Anki/i.test(n.flds)) throw new Error("This package requires a newer format that wasn't included.");
    }

    // ---- media (first, so we can rename clashing files in note fields) ----
    const renames = new Map<string, string>();
    for (const [entry, fname] of mediaMap) {
      const bytes0 = files[entry];
      if (!bytes0 || !fname) continue;
      const bytes = maybeZstd(bytes0);
      const safe = fname.replace(/[\\/]/g, "_");
      const sha = sha1Hex(bytes);
      let target = safe;
      const existing = col.db.query<{ sha1: string }, [string]>("SELECT sha1 FROM media WHERE fname=?").get(safe);
      if (existing && existing.sha1 !== sha) {
        const ext = extname(safe);
        target = `${safe.slice(0, safe.length - ext.length)}-${sha.slice(0, 8)}${ext}`;
        renames.set(safe, target);
      }
      if (!existing || existing.sha1 !== sha) {
        col.media.write(target, bytes);
        col.db.query("INSERT OR REPLACE INTO media(fname,sha1,size,mtime) VALUES (?,?,?,?)").run(target, sha, bytes.length, nowSecs());
        res.media++;
      }
    }

    col.tx(() => {
      // ---- notetypes ----
      const ntMap = new Map<number, Notetype>();
      for (const snt of ntList) {
        const existing = col.notetype(snt.id) ?? (snt.originalId ? col.notetype(snt.originalId) : undefined);
        const sameShape = (a: Notetype) =>
          a.kind === snt.kind &&
          a.fields.length === snt.fields.length &&
          a.fields.every((f, i) => f.name === snt.fields[i].name) &&
          a.templates.length === snt.templates.length;
        let target: Notetype | undefined;
        if (existing && sameShape(existing)) target = existing;
        else {
          const byName = col.notetypes().find((n) => n.name === snt.name && sameShape(n) && n.css === snt.css && n.templates.every((t, i) => t.qfmt === snt.templates[i].qfmt && t.afmt === snt.templates[i].afmt));
          if (byName) target = byName;
        }
        if (target) {
          // refresh templates/css if the incoming notetype is newer
          if (snt.mtime > target.mtime && target.id === snt.id) {
            const upd = { ...target, css: snt.css, templates: snt.templates.map((t, i) => ({ ...t, ord: i })) };
            col.saveNotetypeRow(upd);
            target = col.notetype(target.id)!;
          }
        } else {
          const id = col.notetype(snt.id) ? newId() : snt.id;
          const nt: Notetype = { ...snt, id, name: col.uniqueNotetypeName(snt.name), originalId: snt.id, mtime: nowSecs() };
          col.saveNotetypeRow(nt);
          target = col.notetype(id)!;
          res.notetypes.push(target.name);
        }
        ntMap.set(snt.id, target);
      }

      // ---- deck configs & decks ----
      const confMap = new Map<number, number>();
      const deckMap = new Map<number, number>();
      const srcDeckById = new Map(deckList.map((d) => [d.id, d]));
      for (const d of deckList) {
        if (d.dyn) continue; // filtered decks: cards return to home decks
        const isDefault = d.id === 1;
        if (isDefault) {
          const used = src.query("SELECT 1 FROM cards WHERE did=1 OR odid=1 LIMIT 1").get();
          if (!used) continue;
        }
        const existed = !!col.deckByName(d.name);
        const deck = col.ensureDeck(d.name);
        deckMap.set(d.id, deck.id);
        if (!existed) {
          res.decks.push(deck.name);
          const sconf = confList.find((c) => c.id === d.confId);
          if (sconf && sconf.id !== 1) {
            let cid = confMap.get(sconf.id);
            if (!cid) {
              const match = col.allDeckConfigs().find((c) => c.name === sconf.name);
              cid = match ? match.id : col.saveDeckConfig({ ...sconf, id: col.deckConfig(sconf.id).id === sconf.id ? newId() : sconf.id }).id;
              confMap.set(sconf.id, cid);
            }
            col.updateDeck(deck.id, { configId: cid, description: d.desc });
          } else if (d.desc) col.updateDeck(deck.id, { description: d.desc });
        }
      }
      const fallbackDeck = opts.targetDeckId && col.deck(opts.targetDeckId)?.kind === 0 ? opts.targetDeckId : null;
      const mapDeck = (did: number, odid: number): number => {
        if (fallbackDeck) return fallbackDeck;
        const home = odid || did;
        const m = deckMap.get(home);
        if (m) return m;
        const sd = srcDeckById.get(home);
        if (sd && !sd.dyn) {
          const deck = col.ensureDeck(sd.name);
          deckMap.set(home, deck.id);
          return deck.id;
        }
        return 1;
      };

      // ---- notes ----
      const ourToday = col.today();
      const roll = col.config.rolloverHour;
      const convDay = (d: number) => dayNumber(crt + d * 86400 + 6 * 3600, roll);
      const notes = src.query<{ id: number; guid: string; mid: number; mod: number; tags: string; flds: string }, []>("SELECT id, guid, mid, mod, tags, flds FROM notes").all();
      const noteIdMap = new Map<number, number>();
      const newNoteIds = new Set<number>();
      const insNote = col.db.query("INSERT INTO notes(id,guid,ntid,mtime,tags,flds,sfld,csum) VALUES (?,?,?,?,?,?,?,?)");
      const renameRefs = (flds: string) => {
        if (!renames.size) return flds;
        for (const [a, b] of renames) flds = flds.split(a).join(b);
        return flds;
      };
      const allTags = new Set<string>();
      for (const n of notes) {
        const nt = ntMap.get(n.mid);
        if (!nt) {
          res.warnings.push(`Note ${n.id} skipped: missing notetype`);
          continue;
        }
        const flds = renameRefs(n.flds);
        const f = splitFields(flds);
        while (f.length < nt.fields.length) f.push("");
        const fixed = joinFields(f.slice(0, nt.fields.length));
        for (const t of parseTags(n.tags)) allTags.add(t);
        const existing = col.db.query<{ id: number; mtime: number; ntid: number }, [string]>("SELECT id, mtime, ntid FROM notes WHERE guid=?").get(n.guid);
        if (existing) {
          noteIdMap.set(n.id, existing.id);
          const shouldUpdate = existing.ntid === nt.id && (updateMode === "always" || (updateMode === "ifNewer" && n.mod > existing.mtime));
          if (shouldUpdate) {
            col.db
              .query("UPDATE notes SET flds=?, tags=?, sfld=?, csum=?, mtime=? WHERE id=?")
              .run(fixed, n.tags, sortFieldValue(f[nt.sortIdx] ?? ""), fieldChecksum(f[0] ?? ""), n.mod, existing.id);
            res.notesUpdated++;
          } else res.notesSkipped++;
          continue;
        }
        const id = col.db.query("SELECT 1 FROM notes WHERE id=?").get(n.id) ? newId() : n.id;
        insNote.run(id, n.guid, nt.id, n.mod, n.tags, fixed, sortFieldValue(f[nt.sortIdx] ?? ""), fieldChecksum(f[0] ?? ""));
        noteIdMap.set(n.id, id);
        newNoteIds.add(id);
        res.notesAdded++;
      }
      col.registerTags([...allTags]);

      // ---- cards ----
      const cards = src
        .query<
          { id: number; nid: number; did: number; ord: number; mod: number; type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number; left: number; odue: number; odid: number; flags: number; data: string },
          []
        >("SELECT id, nid, did, ord, mod, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data FROM cards ORDER BY due")
        .all();
      const lastReview = new Map<number, number>();
      for (const r of src.query<{ cid: number; m: number }, []>("SELECT cid, max(id) m FROM revlog WHERE ease > 0 GROUP BY cid").all()) lastReview.set(r.cid, Math.floor(r.m / 1000));
      const posBase = Math.max(0, (col.db.query<{ m: number | null }, []>("SELECT max(due) m FROM cards WHERE type=0").get()?.m ?? 0) + 1);
      const minSrcPos = Math.min(...cards.filter((c) => c.type === 0).map((c) => c.due), Infinity);
      let maxPos = posBase;
      const cardIdMap = new Map<number, number>();
      const insCard = col.db.query(
        `INSERT INTO cards(id,nid,did,ord,mtime,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,stability,difficulty,last_review,custom_data)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?)`,
      );
      for (const c of cards) {
        const nid = noteIdMap.get(c.nid);
        if (!nid) continue;
        if (col.db.query("SELECT 1 FROM cards WHERE nid=? AND ord=?").get(nid, c.ord)) continue;
        const did = mapDeck(c.did, c.odid);
        let { type, queue, due, ivl, factor, reps, lapses } = c;
        let left = c.left % 1000;
        if (c.odid) due = c.odue || due;
        let stability: number | null = null;
        let difficulty: number | null = null;
        let lrt: number | null = lastReview.get(c.id) ?? null;
        let customData: string | null = null;
        if (c.data) {
          try {
            const d = JSON.parse(c.data);
            if (typeof d.s === "number") stability = d.s;
            if (typeof d.d === "number") difficulty = d.d;
            if (typeof d.lrt === "number") lrt = d.lrt;
            if (d.cd) customData = typeof d.cd === "string" ? d.cd : JSON.stringify(d.cd);
          } catch {}
        }
        if (!includeSched || type === CardType.New) {
          type = 0;
          queue = c.queue === Queue.Suspended && includeSched ? Queue.Suspended : 0;
          due = c.type === 0 && Number.isFinite(minSrcPos) ? posBase + (c.due - minSrcPos) : maxPos;
          ivl = 0;
          factor = 0;
          left = 0;
          if (!includeSched) {
            reps = 0;
            lapses = 0;
          }
          stability = difficulty = lrt = null;
          maxPos = Math.max(maxPos, due + 1);
        } else {
          if (queue === Queue.Review || queue === Queue.DayLearn || (queue < 0 && (type === CardType.Review || (type !== CardType.New && due < 1e9)))) due = convDay(due);
          if (queue === Queue.Preview) queue = type === CardType.Review ? Queue.Review : Queue.New;
          if (queue === Queue.SchedBuried || queue === Queue.UserBuried) {
            /* keep buried */
          }
          if (!lrt && type === CardType.Review) {
            // estimate last review from due/ivl
            const lastDay = due - ivl;
            lrt = (lastDay - ourToday) * 86400 + nowSecs();
          }
        }
        const id = col.db.query("SELECT 1 FROM cards WHERE id=?").get(c.id) ? newId() : c.id;
        insCard.run(id, nid, did, c.ord, c.mod, type, queue, due, ivl, factor, reps, lapses, left, c.flags & 7, stability, difficulty, lrt, customData);
        cardIdMap.set(c.id, id);
        res.cardsAdded++;
      }
      col.setKV("nextPos", maxPos + 1);

      // generate any cards the source didn't have (e.g. templates added)
      for (const nid of newNoteIds) {
        const note = col.note(nid)!;
        res.cardsAdded += col.generateCards(note, undefined, undefined);
      }

      // ---- revlog ----
      if (includeSched) {
        const ins = col.db.query("INSERT OR IGNORE INTO revlog(id,cid,ease,ivl,last_ivl,factor,time,type) VALUES (?,?,?,?,?,?,?,?)");
        for (const r of src.query<{ id: number; cid: number; ease: number; ivl: number; lastIvl: number; factor: number; time: number; type: number }, []>("SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog").all()) {
          const cid = cardIdMap.get(r.cid);
          if (!cid) continue;
          ins.run(r.id, cid, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type);
          res.revlog++;
        }
      }
    });
  } finally {
    src.close();
  }
  clearUndo();
  col.emit("import");
  return res;
}

/**
 * Anki's schema-18 collections declare columns with a custom "unicase"
 * collation that bun:sqlite can't register. On our temporary read-only copy,
 * rewrite "collate unicase" to the same-length "collate nocase " in place.
 */
function patchCustomCollations(bytes: Uint8Array): Uint8Array {
  const needle = new TextEncoder().encode("collate unicase");
  const repl = new TextEncoder().encode("collate nocase ");
  const out = bytes.slice();
  const lower = (b: number) => (b >= 65 && b <= 90 ? b + 32 : b);
  outer: for (let i = 0; i <= out.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (lower(out[i + j]) !== needle[j]) continue outer;
    out.set(repl, i);
    i += needle.length - 1;
  }
  // WAL-mode databases can't be deserialized; switch header to rollback journal.
  if (out.length > 100 && out[18] === 2) {
    out[18] = 1;
    out[19] = 1;
  }
  return out;
}

// ---------------- legacy (schema 11) ----------------
function readLegacyNotetypes(json: string): SrcNotetype[] {
  const models = JSON.parse(json || "{}") as Record<string, any>;
  return Object.values(models).map((m: any) => ({
    id: Number(m.id),
    name: String(m.name),
    kind: m.type === 1 ? 1 : 0,
    css: m.css ?? "",
    sortIdx: m.sortf ?? 0,
    fields: (m.flds ?? []).map((f: any, i: number): FieldDef => ({
      name: f.name,
      ord: i,
      sticky: !!f.sticky,
      rtl: !!f.rtl,
      font: f.font,
      size: f.size,
      description: f.description ?? "",
      plainText: !!f.plainText,
      collapsed: !!f.collapsed,
      excludeFromSearch: !!f.excludeFromSearch,
    })),
    templates: (m.tmpls ?? []).map((t: any, i: number): TemplateDef => ({
      name: t.name,
      ord: i,
      qfmt: t.qfmt ?? "",
      afmt: t.afmt ?? "",
      bqfmt: t.bqfmt ?? "",
      bafmt: t.bafmt ?? "",
      targetDeckId: t.did ?? undefined,
    })),
    latexPre: m.latexPre ?? "",
    latexPost: m.latexPost ?? "",
    mtime: m.mod ?? 0,
    originalId: m.originalId ?? null,
  }));
}

function readLegacyDecks(json: string): SrcDeck[] {
  const decks = JSON.parse(json || "{}") as Record<string, any>;
  return Object.values(decks).map((d: any) => ({
    id: Number(d.id),
    name: String(d.name),
    dyn: !!d.dyn,
    confId: Number(d.conf ?? 1),
    desc: d.desc ?? "",
  }));
}

function readLegacyConfigs(json: string): DeckConfig[] {
  const confs = JSON.parse(json || "{}") as Record<string, any>;
  return Object.values(confs).map((c: any) => {
    const base = defaultDeckConfig(Number(c.id), String(c.name));
    return {
      ...base,
      newPerDay: c.new?.perDay ?? base.newPerDay,
      learnSteps: c.new?.delays ?? base.learnSteps,
      graduatingIvl: c.new?.ints?.[0] ?? base.graduatingIvl,
      easyIvl: c.new?.ints?.[1] ?? base.easyIvl,
      initialEase: (c.new?.initialFactor ?? 2500) / 1000,
      newInsertOrder: c.new?.order === 0 ? 1 : 0,
      buryNew: !!c.new?.bury,
      reviewsPerDay: c.rev?.perDay ?? base.reviewsPerDay,
      easyMult: c.rev?.ease4 ?? base.easyMult,
      ivlMult: c.rev?.ivlFct ?? base.ivlMult,
      maxIvl: c.rev?.maxIvl ?? base.maxIvl,
      hardMult: c.rev?.hardFactor ?? base.hardMult,
      buryReviews: !!c.rev?.bury,
      relearnSteps: c.lapse?.delays ?? base.relearnSteps,
      lapseMult: c.lapse?.mult ?? base.lapseMult,
      minLapseIvl: c.lapse?.minInt ?? base.minLapseIvl,
      leechThreshold: c.lapse?.leechFails ?? base.leechThreshold,
      leechAction: c.lapse?.leechAction ?? base.leechAction,
      showTimer: !!c.timer,
      capAnswerSecs: c.maxTaken ?? base.capAnswerSecs,
      disableAutoplay: c.autoplay === false,
      skipQuestionWhenReplayingAnswer: c.replayq === false,
      desiredRetention: c.desiredRetention ?? base.desiredRetention,
      fsrsParams: c.fsrsParams6?.length ? c.fsrsParams6 : c.fsrsParams5?.length ? c.fsrsParams5 : c.fsrsWeights?.length ? c.fsrsWeights : base.fsrsParams,
    };
  });
}

// ---------------- modern (schema 18) ----------------
function readModernNotetypes(src: Database): SrcNotetype[] {
  const nts = src.query<{ id: number; name: string; mtime_secs: number; config: Uint8Array }, []>("SELECT id, name, mtime_secs, config FROM notetypes").all();
  return nts.map((n) => {
    const cfg = new ProtoMsg(n.config);
    const fields = src
      .query<{ ord: number; name: string; config: Uint8Array }, [number]>("SELECT ord, name, config FROM fields WHERE ntid=? ORDER BY ord")
      .all(n.id)
      .map((f, i): FieldDef => {
        const fc = new ProtoMsg(f.config);
        return {
          name: f.name,
          ord: i,
          sticky: fc.bool(1),
          rtl: fc.bool(2),
          font: fc.str(3, "Arial"),
          size: fc.num(4, 20),
          description: fc.str(5),
          plainText: fc.bool(6),
          collapsed: fc.bool(7),
          excludeFromSearch: fc.bool(8),
        };
      });
    const templates = src
      .query<{ ord: number; name: string; config: Uint8Array }, [number]>("SELECT ord, name, config FROM templates WHERE ntid=? ORDER BY ord")
      .all(n.id)
      .map((t, i): TemplateDef => {
        const tc = new ProtoMsg(t.config);
        const target = tc.int(5);
        return { name: t.name, ord: i, qfmt: tc.str(1), afmt: tc.str(2), bqfmt: tc.str(3), bafmt: tc.str(4), targetDeckId: target || undefined };
      });
    return {
      id: n.id,
      name: n.name,
      kind: cfg.num(1) === 1 ? 1 : 0,
      sortIdx: cfg.num(2),
      css: cfg.str(3),
      latexPre: cfg.str(5),
      latexPost: cfg.str(6),
      fields,
      templates,
      mtime: n.mtime_secs,
      originalId: cfg.has(10) ? cfg.int(10) : null,
    } as SrcNotetype;
  });
}

function readModernDecks(src: Database): SrcDeck[] {
  return src
    .query<{ id: number; name: string; kind: Uint8Array }, []>("SELECT id, name, kind FROM decks")
    .all()
    .map((d) => {
      const kind = new ProtoMsg(d.kind);
      const name = d.name.split("\x1f").join("::");
      if (kind.has(2)) {
        const f = kind.msg(2);
        return {
          id: d.id,
          name,
          dyn: true,
          confId: 1,
          desc: "",
          filtered: {
            reschedule: f.bool(1),
            terms: f.msgs(2).map((t) => ({ search: t.str(1), limit: t.num(2), order: t.num(3) })),
            previewAgainSecs: f.num(7),
            previewHardSecs: f.num(5),
            previewGoodSecs: f.num(6),
          },
        };
      }
      const nrm = kind.msg(1);
      return { id: d.id, name, dyn: false, confId: nrm.num(1, 1) || 1, desc: nrm.str(4) };
    });
}

function readModernConfigs(src: Database): DeckConfig[] {
  return src
    .query<{ id: number; name: string; config: Uint8Array }, []>("SELECT id, name, config FROM deck_config")
    .all()
    .map((r) => {
      const c = new ProtoMsg(r.config);
      const base = defaultDeckConfig(r.id, r.name);
      const f = (n: number, d: number) => (c.has(n) ? c.float(n) : d);
      const u = (n: number, d: number) => (c.has(n) ? c.num(n) : d);
      const params6 = c.floats(6);
      const params5 = c.floats(5);
      const params4 = c.floats(3);
      return {
        ...base,
        learnSteps: c.has(1) ? c.floats(1) : base.learnSteps,
        relearnSteps: c.has(2) ? c.floats(2) : base.relearnSteps,
        fsrsParams: params6.length ? params6 : params5.length ? params5 : params4.length ? params4 : base.fsrsParams,
        newPerDay: u(9, base.newPerDay),
        reviewsPerDay: u(10, base.reviewsPerDay),
        initialEase: f(11, base.initialEase),
        easyMult: f(12, base.easyMult),
        hardMult: f(13, base.hardMult),
        lapseMult: f(14, base.lapseMult),
        ivlMult: f(15, base.ivlMult),
        maxIvl: u(16, base.maxIvl),
        minLapseIvl: u(17, base.minLapseIvl),
        graduatingIvl: u(18, base.graduatingIvl),
        easyIvl: u(19, base.easyIvl),
        newInsertOrder: u(20, 0),
        leechAction: u(21, base.leechAction),
        leechThreshold: u(22, base.leechThreshold),
        disableAutoplay: c.bool(23),
        capAnswerSecs: u(24, base.capAnswerSecs),
        showTimer: c.bool(25),
        skipQuestionWhenReplayingAnswer: c.bool(26),
        buryNew: c.bool(27),
        buryReviews: c.bool(28),
        buryInterday: c.bool(29),
        newMix: u(30, 0),
        interdayLearningMix: u(31, 0),
        newSortOrder: u(32, 0),
        reviewOrder: u(33, 0),
        newGatherPriority: u(34, 0),
        desiredRetention: f(37, base.desiredRetention),
        autoAdvanceQuestionSecs: f(41, 0),
        autoAdvanceAnswerSecs: f(42, 0),
        autoAdvanceAnswerAction: u(43, 0),
      };
    });
}

export function readFileBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
