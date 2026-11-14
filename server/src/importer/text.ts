// Text/CSV import (Anki "Import File" for .txt/.csv/.tsv), including Anki's
// file headers: #separator:, #html:, #notetype:, #deck:, #tags:, #columns:,
// #notetype column:, #deck column:, #tags column:, #guid column:
import type { Collection } from "../collection";
import { escapeHtml, fieldChecksum, parseTags, splitFields } from "../util";
import { assert } from "../util";

export interface CsvPreview {
  delimiter: string;
  html: boolean;
  columns: string[];
  rows: string[][];
  notetype?: string;
  deck?: string;
  tags: string[];
  tagsColumn?: number;
  guidColumn?: number;
  notetypeColumn?: number;
  deckColumn?: number;
}

export interface CsvImportOptions {
  delimiter?: string;
  html?: boolean;
  notetypeId: number;
  deckId: number;
  /** For each field of the notetype, the 0-based column index (or -1 for none). */
  fieldColumns: number[];
  tagsColumn?: number; // -1 none
  extraTags?: string[];
  dupeMode?: "update" | "ignore" | "duplicate"; // match on first field
  firstRowIsHeader?: boolean;
}

function parseHeaders(text: string) {
  const headers: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^#([a-z ]+):(.*)$/i.exec(lines[i]);
    if (!m) break;
    headers[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return { headers, body: lines.slice(i).join("\n") };
}

const SEP_NAMES: Record<string, string> = { tab: "\t", comma: ",", semicolon: ";", space: " ", pipe: "|", colon: ":" };

function guessDelimiter(sample: string): string {
  const firstLines = sample.split(/\r?\n/).slice(0, 10).join("\n");
  const cands = ["\t", ";", ",", "|"];
  let best = "\t";
  let bestScore = -1;
  for (const c of cands) {
    const counts = firstLines.split(/\r?\n/).filter(Boolean).map((l) => l.split(c).length);
    if (!counts.length) continue;
    const consistent = counts.every((n) => n === counts[0]);
    const score = (consistent ? 2 : 1) * (counts[0] - 1);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += ch;
    } else if (ch === '"' && field === "") inQ = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "") || row.length > 1) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].startsWith("#")));
}

export function previewCsv(text: string, delimiter?: string): CsvPreview {
  text = text.replace(/^﻿/, "");
  const { headers, body } = parseHeaders(text);
  const sepHeader = headers["separator"];
  const delim = delimiter ?? (sepHeader ? (SEP_NAMES[sepHeader.toLowerCase()] ?? sepHeader) : guessDelimiter(body));
  const rows = parseDelimited(body, delim);
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));
  const columns = headers["columns"] ? parseDelimited(headers["columns"], delim)[0] ?? [] : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const col = (k: string) => (headers[k] ? Number(headers[k]) - 1 : undefined);
  return {
    delimiter: delim,
    html: headers["html"] ? headers["html"] === "true" : /<[a-z][\s\S]*>/i.test(body.slice(0, 5000)),
    columns,
    rows: rows.slice(0, 20),
    notetype: headers["notetype"],
    deck: headers["deck"],
    tags: headers["tags"] ? parseTags(headers["tags"]) : [],
    tagsColumn: col("tags column"),
    guidColumn: col("guid column"),
    notetypeColumn: col("notetype column"),
    deckColumn: col("deck column"),
  };
}

export function importCsv(col: Collection, text: string, o: CsvImportOptions) {
  text = text.replace(/^﻿/, "");
  const pv = previewCsv(text, o.delimiter);
  const { body } = parseHeaders(text);
  let rows = parseDelimited(body, pv.delimiter);
  if (o.firstRowIsHeader) rows = rows.slice(1);
  const nt = col.notetype(o.notetypeId);
  assert(nt, "Notetype not found", 404);
  const html = o.html ?? pv.html;
  const res = { added: 0, updated: 0, skipped: 0, errors: [] as string[] };
  const existingByCsum = new Map<number, { id: number; first: string }[]>();
  for (const n of col.db.query<{ id: number; csum: number; flds: string }, [number]>("SELECT id, csum, flds FROM notes WHERE ntid=?").all(nt.id)) {
    const arr = existingByCsum.get(n.csum) ?? [];
    arr.push({ id: n.id, first: splitFields(n.flds)[0] ?? "" });
    existingByCsum.set(n.csum, arr);
  }
  col.tx(() => {
    rows.forEach((r, idx) => {
      const fields = nt.fields.map((_, i) => {
        const c = o.fieldColumns[i];
        const v = c != null && c >= 0 ? (r[c] ?? "") : "";
        return html ? v : escapeHtml(v).replace(/\n/g, "<br>");
      });
      const tags = [...(o.extraTags ?? []), ...pv.tags, ...(o.tagsColumn != null && o.tagsColumn >= 0 ? parseTags(r[o.tagsColumn] ?? "") : [])];
      if (!fields[0]?.trim()) {
        res.skipped++;
        return;
      }
      const dup = (existingByCsum.get(fieldChecksum(fields[0])) ?? []).find((e) => e.first === fields[0]);
      if (dup && o.dupeMode !== "duplicate") {
        if (o.dupeMode === "update") {
          col.updateNote(dup.id, fields, tags);
          res.updated++;
        } else res.skipped++;
        return;
      }
      try {
        col.addNote(nt.id, fields, tags, o.deckId);
        res.added++;
      } catch (e) {
        res.errors.push(`Row ${idx + 1}: ${(e as Error).message}`);
      }
    });
  });
  return res;
}

/** Export notes as tab-separated text with Anki headers. */
export function exportNotesText(col: Collection, nids: number[], opts: { html: boolean; tags: boolean; deckNotetype: boolean }): string {
  const lines = ["#separator:tab", `#html:${opts.html}`];
  if (opts.deckNotetype) lines.push("#notetype column:1", "#deck column:2");
  const rows: string[] = [];
  let maxCols = 0;
  for (const nid of nids) {
    const n = col.note(nid);
    if (!n) continue;
    const nt = col.notetype(n.ntid)!;
    const card = col.db.query<{ did: number; odid: number }, [number]>("SELECT did, odid FROM cards WHERE nid=? LIMIT 1").get(nid);
    const deck = card ? col.deck(card.odid || card.did)?.name ?? "" : "";
    const clean = (s: string) => {
      let v = opts.html ? s : s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
      if (/[\t\n"]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const cols = [...(opts.deckNotetype ? [clean(nt.name), clean(deck)] : []), ...splitFields(n.flds).map(clean)];
    if (opts.tags) cols.push(clean(n.tags.trim()));
    maxCols = Math.max(maxCols, cols.length);
    rows.push(cols.join("\t"));
  }
  if (opts.tags) lines.push(`#tags column:${maxCols}`);
  return [...lines, ...rows].join("\n") + "\n";
}
