// Check Database, Empty Cards, Check Media, backups.
import type { Collection } from "./collection";
import { sortFieldValue } from "./collection";
import type { NoteRow } from "./types";
import { cardOrdsForNote } from "./render/template";
import { fieldChecksum, joinFields, splitFields, nowSecs, stripHtml } from "./util";
import { clearUndo } from "./sched/queue";
import { clearHistory } from "./history";

export function checkDatabase(col: Collection) {
  const report: string[] = [];
  col.tx(() => {
    const db = col.db;
    const orphanCards = db.query<{ id: number }, []>("SELECT id FROM cards WHERE nid NOT IN (SELECT id FROM notes)").all().map((r) => r.id);
    if (orphanCards.length) {
      col.removeCards(orphanCards, false);
      report.push(`Deleted ${orphanCards.length} cards with missing notes.`);
    }
    const badNt = db.query<{ id: number }, []>("SELECT id FROM notes WHERE ntid NOT IN (SELECT id FROM notetypes)").all().map((r) => r.id);
    if (badNt.length) {
      col.removeNotes(badNt);
      report.push(`Deleted ${badNt.length} notes with missing note type.`);
    }
    const missingDeck = db.query<{ id: number }, []>("SELECT id FROM cards WHERE did NOT IN (SELECT id FROM decks)").all().map((r) => r.id);
    if (missingDeck.length) {
      db.query(`UPDATE cards SET did=1 WHERE id IN (${missingDeck.join(",")})`).run();
      report.push(`Moved ${missingDeck.length} cards with missing deck to Default.`);
    }
    const badOdid = db.query<{ n: number }, []>("SELECT count(*) n FROM cards WHERE odid!=0 AND did NOT IN (SELECT id FROM decks WHERE kind=1)").get()!.n;
    if (badOdid) {
      db.query("UPDATE cards SET did=odid, due=CASE WHEN odue!=0 THEN odue ELSE due END, odid=0, odue=0 WHERE odid!=0 AND did NOT IN (SELECT id FROM decks WHERE kind=1)").run();
      report.push(`Fixed ${badOdid} cards stuck in removed filtered decks.`);
    }
    // fix field counts, sort fields, checksums, regenerate missing cards
    let fixedFields = 0;
    let generated = 0;
    const notes = db.query<NoteRow, []>("SELECT * FROM notes").all();
    const upd = db.query("UPDATE notes SET flds=?, sfld=?, csum=?, mtime=? WHERE id=?");
    for (const n of notes) {
      const nt = col.notetype(n.ntid);
      if (!nt) continue;
      let f = splitFields(n.flds);
      if (f.length !== nt.fields.length) {
        while (f.length < nt.fields.length) f.push("");
        if (f.length > nt.fields.length) f = [...f.slice(0, nt.fields.length - 1), f.slice(nt.fields.length - 1).join("; ")];
        fixedFields++;
      }
      const sf = sortFieldValue(f[nt.sortIdx] ?? "");
      const cs = fieldChecksum(f[0] ?? "");
      if (joinFields(f) !== n.flds || sf !== n.sfld || cs !== n.csum) upd.run(joinFields(f), sf, cs, nowSecs(), n.id);
      generated += col.generateCards({ ...n, flds: joinFields(f) }, nt);
    }
    if (fixedFields) report.push(`Fixed ${fixedFields} notes with the wrong field count.`);
    if (generated) report.push(`Generated ${generated} missing cards.`);
    const noCards = db.query<{ id: number }, []>("SELECT id FROM notes WHERE id NOT IN (SELECT DISTINCT nid FROM cards)").all().map((r) => r.id);
    if (noCards.length) {
      col.removeNotes(noCards);
      report.push(`Deleted ${noCards.length} notes with no cards.`);
    }
    const badDue = db.query<{ n: number }, []>("SELECT count(*) n FROM cards WHERE type=0 AND due>1000000").get()!.n;
    if (badDue) {
      const rows = db.query<{ id: number }, []>("SELECT id FROM cards WHERE type=0 AND due>1000000 ORDER BY due").all();
      rows.forEach((r) => db.query("UPDATE cards SET due=? WHERE id=?").run(col.nextNewPosition(), r.id));
      report.push(`Fixed ${badDue} new cards with invalid positions.`);
    }
    const badProps = db.query<{ n: number }, []>("SELECT count(*) n FROM cards WHERE (type=2 AND ivl<1) OR factor<0 OR reps<0").get()!.n;
    if (badProps) {
      db.query("UPDATE cards SET ivl=max(1,ivl) WHERE type=2 AND ivl<1").run();
      db.query("UPDATE cards SET factor=2500 WHERE factor<0").run();
      db.query("UPDATE cards SET reps=0 WHERE reps<0").run();
      report.push(`Fixed ${badProps} cards with invalid properties.`);
    }
    const removed = col.clearUnusedTags();
    if (removed) report.push(`Removed ${removed} unused tags.`);
  });
  col.db.exec("PRAGMA optimize; VACUUM; ANALYZE;");
  clearUndo();
  clearHistory();
  if (!report.length) report.push("Database rebuilt and optimized. No problems found.");
  col.emit("checkDatabase");
  return { report };
}

export function findEmptyCards(col: Collection) {
  const out: { noteId: number; cardIds: number[]; ords: number[]; preview: string }[] = [];
  for (const nt of col.notetypes()) {
    const rows = col.db.query<{ cid: number; ord: number; nid: number; flds: string }, [number]>("SELECT c.id cid, c.ord, n.id nid, n.flds FROM cards c JOIN notes n ON n.id=c.nid WHERE n.ntid=? ORDER BY n.id").all(nt.id);
    const byNote = new Map<number, { flds: string; cards: { cid: number; ord: number }[] }>();
    for (const r of rows) {
      const e = byNote.get(r.nid) ?? { flds: r.flds, cards: [] };
      e.cards.push({ cid: r.cid, ord: r.ord });
      byNote.set(r.nid, e);
    }
    for (const [nid, e] of byNote) {
      const valid = new Set(cardOrdsForNote(nt, splitFields(e.flds)));
      const empty = e.cards.filter((c) => !valid.has(c.ord));
      if (empty.length && empty.length < e.cards.length + (valid.size === 0 ? 1 : 0))
        out.push({ noteId: nid, cardIds: empty.map((c) => c.cid), ords: empty.map((c) => c.ord + 1), preview: stripHtml(splitFields(e.flds)[0] ?? "").slice(0, 80) });
    }
  }
  return out;
}

/** Media files a note's fields refer to (images, audio, video, [sound:] tags). */
export function fieldMediaRefs(flds: string, into = new Set<string>()): Set<string> {
  for (const m of flds.matchAll(/<(?:img|audio|video|source|object)\b[^>]*?\b(?:src|data)=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)) into.add(safeDecode(m[1] ?? m[2] ?? m[3]));
  for (const m of flds.matchAll(/\[sound:([^\]]+)\]/g)) into.add(m[1]);
  return into;
}
/** Media files a note type's styling and templates refer to (Anki's "_file" convention). */
export function notetypeMediaRefs(nt: { css: string; templates: { qfmt: string; afmt: string }[] }, into = new Set<string>()): Set<string> {
  const src = nt.css + nt.templates.map((t) => t.qfmt + t.afmt).join("");
  for (const m of src.matchAll(/["'(](_[^"')]+)["')]/g)) into.add(m[1]);
  return into;
}

export function checkMedia(col: Collection) {
  const referenced = new Set<string>();
  for (const r of col.db.query<{ flds: string }, []>("SELECT flds FROM notes").all()) fieldMediaRefs(r.flds, referenced);
  for (const nt of col.notetypes()) notetypeMediaRefs(nt, referenced);
  const known = col.db.query<{ fname: string }, []>("SELECT fname FROM media").all().map((r) => r.fname);
  const present = known.filter((f) => col.media.has(f));
  const presentSet = new Set(present);
  for (const f of known) if (!presentSet.has(f)) col.db.query("DELETE FROM media WHERE fname=?").run(f);
  const unused = present.filter((f) => !referenced.has(f) && !f.startsWith("_"));
  const missing = [...referenced].filter((f) => !/^(https?:|data:)/i.test(f) && !presentSet.has(f));
  return { unused, missing, total: present.length, encryptedBlobs: col.media.diskCount() };
}

export function deleteMediaFiles(col: Collection, files: string[]) {
  let n = 0;
  for (const f of files) {
    if (!/^[^/\\]+$/.test(f)) continue;
    if (col.media.has(f)) {
      col.media.delete(f);
      n++;
    }
    col.db.query("DELETE FROM media WHERE fname=?").run(f);
  }
  return n;
}

/** Encrypted snapshot backup (same key as the live collection). */
export function backup(col: Collection): string {
  return col.store.backup(col.db, col.config.backupKeep || 30);
}

export function listBackups(col: Collection) {
  return col.store.listBackups();
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
