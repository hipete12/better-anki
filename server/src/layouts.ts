// Display order: give selected cards a different front/back layout without touching other cards.
// Anki ties a card's layout to its note type, so a layout is a copy of the note type ("layout copy")
// with one card template changed. Assigning a layout moves the cards' notes to that copy; card ids,
// scheduling and review history stay the same. The note type a copy came from is listed as "Default".
import type { Collection } from "./collection";
import type { Notetype } from "./types";
import { assert, joinFields, nowSecs, parseTags, splitFields } from "./util";

const KEY = "noteLayouts";
type LayoutMeta = Record<string, { base: number; name: string }>;

function layoutMeta(col: Collection): LayoutMeta {
  return col.getKV<LayoutMeta>(KEY, {});
}
/** The note type a layout copy was made from (a note type that isn't a copy is its own base). */
function baseOf(col: Collection, ntid: number): number {
  const base = layoutMeta(col)[ntid]?.base;
  return base && col.notetype(base) ? base : ntid;
}

interface Selection {
  base: Notetype;
  /** Template index the selected cards use (always 0 for cloze). */
  tmpl: number;
  cards: { id: number; nid: number; ntid: number }[];
}

/** The note-type family and card type shared by the cards, or the reason they can't share a layout. */
function selection(col: Collection, cardIds: number[]): Selection | { reason: string } {
  assert(cardIds.length > 0, "Select some cards");
  const ids = cardIds.map(Number).filter(Number.isFinite);
  const rows = col.db
    .query<{ id: number; nid: number; ord: number; ntid: number }, []>(`SELECT c.id, c.nid, c.ord, n.ntid FROM cards c JOIN notes n ON n.id = c.nid WHERE c.id IN (${ids.join(",")})`)
    .all();
  assert(rows.length > 0, "Cards not found", 404);
  const bases = new Set(rows.map((r) => baseOf(col, r.ntid)));
  if (bases.size > 1) return { reason: "The selected cards use different note types. Select cards of one note type." };
  const base = col.notetype([...bases][0])!;
  const tmpls = new Set(rows.map((r) => (col.notetype(r.ntid)!.kind === 1 ? 0 : r.ord)));
  if (tmpls.size > 1) return { reason: `The selected cards use different card types of "${base.name}". Select cards of one card type.` };
  return { base, tmpl: [...tmpls][0], cards: rows };
}

/** Each note type's layout: its family's base note type and the layout name ("Default" for the base itself). */
export function layoutNames(col: Collection): Map<number, { baseId: number; base: string; name: string; isDefault: boolean }> {
  const meta = layoutMeta(col);
  const out = new Map<number, { baseId: number; base: string; name: string; isDefault: boolean }>();
  for (const nt of col.notetypes()) {
    const m = meta[nt.id];
    const base = m && col.notetype(m.base);
    out.set(nt.id, base ? { baseId: base.id, base: base.name, name: m.name, isDefault: false } : { baseId: nt.id, base: nt.name, name: "Default", isDefault: true });
  }
  return out;
}

/** Note types that have layout copies, each with its layouts (Default first) and how many cards use each. */
export function layoutFamilies(col: Collection) {
  const names = layoutNames(col);
  const counts = new Map(col.db.query<{ ntid: number; n: number }, []>("SELECT n.ntid, count(*) n FROM cards c JOIN notes n ON n.id = c.nid GROUP BY n.ntid").all().map((r) => [r.ntid, r.n]));
  const families = new Map<number, { notetypeId: number; notetype: string; layouts: { notetypeId: number; name: string; isDefault: boolean; cards: number }[] }>();
  for (const [ntid, l] of names) {
    if (l.isDefault) continue;
    const fam = families.get(l.baseId) ?? { notetypeId: l.baseId, notetype: l.base, layouts: [{ notetypeId: l.baseId, name: "Default", isDefault: true, cards: counts.get(l.baseId) ?? 0 }] };
    fam.layouts.push({ notetypeId: ntid, name: l.name, isDefault: false, cards: counts.get(ntid) ?? 0 });
    families.set(l.baseId, fam);
  }
  return [...families.values()]
    .map((f) => ({ ...f, layouts: [f.layouts[0], ...f.layouts.slice(1).sort((a, b) => a.name.localeCompare(b.name))] }))
    .sort((a, b) => a.notetype.localeCompare(b.notetype));
}

/** The layouts the cards can use: the note type they came from ("Default") and its layout copies. */
export function layoutOptions(col: Collection, cardIds: number[]) {
  const sel = selection(col, cardIds);
  if ("reason" in sel) return { ok: false as const, reason: sel.reason };
  const meta = layoutMeta(col);
  const family = [sel.base, ...col.notetypes().filter((n) => n.id !== sel.base.id && meta[n.id]?.base === sel.base.id)].filter((n) => n.templates[sel.tmpl]);
  return {
    ok: true as const,
    notetype: sel.base.name,
    cardType: sel.base.templates[sel.tmpl]?.name ?? "",
    fields: sel.base.fields.map((f) => f.name),
    options: family.map((n) => ({
      notetypeId: n.id,
      name: n.id === sel.base.id ? "Default" : meta[n.id].name,
      isDefault: n.id === sel.base.id,
      qfmt: n.templates[sel.tmpl].qfmt,
      afmt: n.templates[sel.tmpl].afmt,
      selected: sel.cards.filter((c) => c.ntid === n.id).length,
    })),
  };
}

/** Move the cards' notes to another layout of the same note type. */
export function assignLayout(col: Collection, cardIds: number[], notetypeId: number) {
  const sel = selection(col, cardIds);
  assert(!("reason" in sel), "reason" in sel ? sel.reason : "");
  const target = col.notetype(notetypeId);
  assert(target && baseOf(col, target.id) === sel.base.id, "That layout belongs to a different note type");
  const bySource = new Map<number, number[]>();
  for (const c of sel.cards) if (c.ntid !== target.id) bySource.set(c.ntid, [...new Set([...(bySource.get(c.ntid) ?? []), c.nid])]);
  let changed = 0;
  col.tx(() => {
    for (const [ntid, nids] of bySource) {
      const src = col.notetype(ntid)!;
      // fields by name (copies start identical, but either side may have been edited since), then by position
      const fieldMap = target.fields.map((f, i) => {
        const byName = src.fields.findIndex((s) => s.name === f.name);
        return byName >= 0 ? byName : i < src.fields.length ? i : -1;
      });
      const templateMap = target.templates.map((_, i) => (i < src.templates.length ? i : -1));
      changed += changeNotetype(col, nids, target.id, fieldMap, templateMap);
    }
  });
  col.emit("cards", sel.cards.map((c) => c.id));
  return { changed: sel.cards.length, notes: changed };
}

/** Create a layout copy with a new front/back for the cards' card type, and move the cards to it. */
export function createLayout(col: Collection, b: { cardIds: number[]; name: string; qfmt: string; afmt: string }) {
  const sel = selection(col, b.cardIds);
  assert(!("reason" in sel), "reason" in sel ? sel.reason : "");
  const name = (b.name ?? "").trim();
  assert(name, "Give the layout a name");
  assert(name.toLowerCase() !== "default", '"Default" is the original layout. Choose another name.');
  assert((b.qfmt ?? "").trim(), "The front template can't be empty");
  const meta = layoutMeta(col);
  assert(!Object.entries(meta).some(([id, m]) => m.base === sel.base.id && m.name.toLowerCase() === name.toLowerCase() && col.notetype(Number(id))), `There's already a layout called "${name}"`);
  const copy = col.cloneNotetype(sel.base.id, `${sel.base.name} – ${name}`);
  const templates = copy.templates.map((t, i) => (i === sel.tmpl ? { ...t, qfmt: b.qfmt, afmt: b.afmt ?? "" } : t));
  col.updateNotetype(copy.id, { templates });
  col.setKV(KEY, { ...meta, [copy.id]: { base: sel.base.id, name } });
  const res = assignLayout(col, b.cardIds, copy.id);
  return { ...res, notetypeId: copy.id };
}

/**
 * Change the note type of notes. fieldMap[newField] = old field index (or -1); templateMap[newOrd] = old ord
 * (or -1). Cards whose template isn't mapped are deleted; mapped cards keep their id, scheduling and history.
 */
export function changeNotetype(col: Collection, noteIds: number[], notetypeId: number, fieldMap: number[], templateMap?: number[]) {
  const target = col.notetype(notetypeId);
  assert(target, "Notetype not found", 404);
  let changed = 0;
  col.tx(() => {
    for (const id of noteIds) {
      const n = col.note(id);
      if (!n) continue;
      const old = splitFields(n.flds);
      const fields = target.fields.map((_, i) => (fieldMap[i] != null && fieldMap[i] >= 0 ? (old[fieldMap[i]] ?? "") : ""));
      const cards = col.cardsOfNote(id);
      if (templateMap && target.kind === 0) {
        const keep = new Map<number, number>(); // oldOrd -> newOrd
        templateMap.forEach((oldOrd, newOrd) => oldOrd != null && oldOrd >= 0 && keep.set(oldOrd, newOrd));
        for (const c of cards) {
          if (keep.has(c.ord)) col.db.query("UPDATE cards SET ord=? WHERE id=?").run(-1 - keep.get(c.ord)!, c.id);
          else col.removeCards([c.id], false);
        }
        col.db.query("UPDATE cards SET ord=-1-ord WHERE nid=? AND ord<0").run(id);
      }
      col.db.query("UPDATE notes SET ntid=?, flds=?, mtime=? WHERE id=?").run(target.id, joinFields(fields), nowSecs(), id);
      col.updateNote(id, fields);
      changed++;
    }
  });
  return changed;
}

/**
 * Duplicate the notes behind the given cards (or the given notes) as new notes created now: same fields
 * and tags, in the deck the original card lives in, with fresh new cards.
 */
export function duplicateNotes(col: Collection, b: { cardIds?: number[]; noteIds?: number[] }) {
  const deckFor = new Map<number, number>(); // nid -> home deck of the selected (or first) card
  for (const cid of b.cardIds ?? []) {
    const c = col.card(Number(cid));
    if (c && !deckFor.has(c.nid)) deckFor.set(c.nid, c.odid || c.did);
  }
  for (const nid of b.noteIds ?? []) {
    if (deckFor.has(Number(nid))) continue;
    const c = col.cardsOfNote(Number(nid))[0];
    deckFor.set(Number(nid), c ? c.odid || c.did : 1);
  }
  assert(deckFor.size > 0, "Select some cards");
  const created: number[] = [];
  let cards = 0;
  col.tx(() => {
    for (const [nid, did] of deckFor) {
      const n = col.note(nid);
      if (!n) continue;
      const deck = col.deck(did);
      const r = col.addNote(n.ntid, splitFields(n.flds), parseTags(n.tags), deck && deck.kind === 0 ? did : 1, { allowEmpty: true });
      created.push(r.id);
      cards += r.cards;
    }
  });
  return { notes: created.length, cards, noteIds: created };
}
