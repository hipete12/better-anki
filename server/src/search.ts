// Anki search syntax: parsing and evaluation.
// Supports: plain text, "quoted phrases", -negation, or/and, (groups), wildcards (* _),
// deck:, note:, card:, tag:, is:, flag:, field:value, w:, re:, nc:, dupe:, nid:, cid:,
// mid:, did:, preset:, added:, edited:, rated:, resched:, introduced:, prop:
import type { Collection } from "./collection";
import type { CardRow } from "./types";
import { CardType, Queue } from "./types";
import { stripHtml, splitFields, parseTags, nowSecs, dayNumber, HttpError } from "./util";
import { FSRS } from "./sched/fsrs";

type Ast = { t: "and"; c: Ast[] } | { t: "or"; c: Ast[] } | { t: "not"; c: Ast } | { t: "term"; key: string | null; value: string; quoted: boolean };

// ---------- tokenizer ----------
type Tok = { t: "lp" } | { t: "rp" } | { t: "not" } | { t: "or" } | { t: "and" } | { t: "word"; key: string | null; value: string; quoted: boolean };

function tokenize(q: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (ch === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    if (ch === "-" && i + 1 < q.length && !/\s/.test(q[i + 1])) {
      out.push({ t: "not" });
      i++;
      continue;
    }
    // read a word, honouring quotes anywhere (deck:"a b" or "deck:a b")
    let raw = "";
    let quoted = false;
    while (i < q.length && !/\s/.test(q[i]) && q[i] !== ")" && !(q[i] === "(" && raw === "")) {
      if (q[i] === '"') {
        quoted = true;
        i++;
        while (i < q.length && q[i] !== '"') {
          if (q[i] === "\\" && i + 1 < q.length) {
            raw += q[i] + q[i + 1];
            i += 2;
          } else raw += q[i++];
        }
        i++; // closing quote
      } else if (q[i] === "\\" && i + 1 < q.length) {
        raw += q[i] + q[i + 1];
        i += 2;
      } else raw += q[i++];
    }
    const lower = raw.toLowerCase();
    if (!quoted && lower === "or") out.push({ t: "or" });
    else if (!quoted && lower === "and") out.push({ t: "and" });
    else {
      const m = /^([a-zA-Z0-9_\-]+?):(.*)$/s.exec(raw);
      // treat "foo:bar" as key:value except known non-keys (e.g. URLs) — field names are allowed keys
      if (m && !raw.startsWith("\\")) out.push({ t: "word", key: m[1].toLowerCase(), value: m[2], quoted });
      else out.push({ t: "word", key: null, value: raw, quoted });
    }
  }
  return out;
}

function parse(q: string): Ast {
  const toks = tokenize(q);
  let pos = 0;
  function parseOr(): Ast {
    const parts = [parseAnd()];
    while (toks[pos]?.t === "or") {
      pos++;
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : { t: "or", c: parts };
  }
  function parseAnd(): Ast {
    const parts: Ast[] = [];
    while (pos < toks.length && toks[pos].t !== "rp" && toks[pos].t !== "or") {
      if (toks[pos].t === "and") {
        pos++;
        continue;
      }
      parts.push(parseUnary());
    }
    return parts.length === 1 ? parts[0] : { t: "and", c: parts };
  }
  function parseUnary(): Ast {
    const tk = toks[pos];
    if (tk.t === "not") {
      pos++;
      return { t: "not", c: parseUnary() };
    }
    if (tk.t === "lp") {
      pos++;
      const inner = parseOr();
      if (toks[pos]?.t === "rp") pos++;
      return inner;
    }
    pos++;
    if (tk.t === "word") return { t: "term", key: tk.key, value: tk.value, quoted: tk.quoted };
    return { t: "and", c: [] };
  }
  if (!toks.length) return { t: "and", c: [] };
  const ast = parseOr();
  while (pos < toks.length) {
    // stray ')' - skip
    pos++;
  }
  return ast;
}

// ---------- matching helpers ----------
function unescapeText(s: string): string {
  return s.replace(/\\([\\"*_:()\-])/g, "$1");
}

/** Convert Anki wildcard text to a RegExp source. */
function wildcardToRegex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      out += s[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    } else if (c === "*") out += "[\\s\\S]*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

function noCombining(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export interface SearchRow extends CardRow {
  flds: string;
  tags: string;
  ntid: number;
  nmtime: number;
  sfld: string;
  csum: number;
}

type Pred = (r: SearchRow) => boolean;

interface CompileCtx {
  col: Collection;
  today: number;
  now: number;
  textCache: Map<number, string>;
  revlogCache: Map<string, Set<number>>;
}

function noteText(ctx: CompileCtx, r: SearchRow): string {
  let t = ctx.textCache.get(r.nid);
  if (t === undefined) {
    const nt = ctx.col.notetype(r.ntid);
    const f = splitFields(r.flds).filter((_, i) => !nt?.fields[i]?.excludeFromSearch);
    t = stripHtml(f.join("\x1f").replace(/<img[^>]*src=["']?([^"' >]+)/gi, " $1 ")).toLowerCase();
    ctx.textCache.set(r.nid, t);
  }
  return t;
}

function cmp(op: string, a: number, b: number): boolean {
  switch (op) {
    case "=":
      return a === b;
    case "!=":
      return a !== b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
  }
  return false;
}

function revlogSet(ctx: CompileCtx, key: string, sql: string, params: number[]): Set<number> {
  let s = ctx.revlogCache.get(key);
  if (!s) {
    s = new Set(ctx.col.db.query<{ cid: number }, number[]>(sql).all(...params).map((r) => r.cid));
    ctx.revlogCache.set(key, s);
  }
  return s;
}

function dayCutoffMs(ctx: CompileCtx, days: number): number {
  // start of the study day `days-1` days ago
  const roll = ctx.col.config.rolloverHour;
  const todayStartSecs = dayStartSecs(ctx.today, roll);
  return (todayStartSecs - (Math.max(1, days) - 1) * 86400) * 1000;
}

function dayStartSecs(day: number, roll: number): number {
  // find timestamp where dayNumber(ts)==day begins (approximate via offset)
  let ts = day * 86400 + roll * 3600;
  ts -= -new Date(ts * 1000).getTimezoneOffset() * 60;
  return ts;
}

function compile(ast: Ast, ctx: CompileCtx): Pred {
  switch (ast.t) {
    case "and": {
      const ps = ast.c.map((c) => compile(c, ctx));
      return (r) => ps.every((p) => p(r));
    }
    case "or": {
      const ps = ast.c.map((c) => compile(c, ctx));
      return (r) => ps.some((p) => p(r));
    }
    case "not": {
      const p = compile(ast.c, ctx);
      return (r) => !p(r);
    }
    case "term":
      return compileTerm(ast.key, ast.value, ast.quoted, ctx);
  }
}

function compileTerm(key: string | null, value: string, _quoted: boolean, ctx: CompileCtx): Pred {
  const col = ctx.col;
  if (key === null) {
    if (value === "") return () => true;
    const re = new RegExp(wildcardToRegex(value.toLowerCase()), "i");
    return (r) => re.test(noteText(ctx, r));
  }
  const v = value;
  const vl = v.toLowerCase();
  switch (key) {
    case "deck": {
      if (vl === "*") return () => true;
      if (vl === "current") {
        const ids = new Set(col.deckAndChildren(col.config.currentDeckId));
        return (r) => ids.has(r.did) || ids.has(r.odid);
      }
      if (vl === "filtered") {
        const ids = new Set(col.decks().filter((d) => d.kind === 1).map((d) => d.id));
        return (r) => ids.has(r.did);
      }
      const re = new RegExp(`^${wildcardToRegex(unescapeText(vl) === vl ? vl : vl)}(::.*)?$`, "i");
      const ids = new Set(col.decks().filter((d) => re.test(d.name)).map((d) => d.id));
      return (r) => ids.has(r.did) || ids.has(r.odid);
    }
    case "did": {
      const ids = new Set(v.split(",").map(Number));
      return (r) => ids.has(r.did) || ids.has(r.odid);
    }
    case "preset": {
      const re = new RegExp(`^${wildcardToRegex(vl)}$`, "i");
      const confIds = new Set(col.allDeckConfigs().filter((c) => re.test(c.name)).map((c) => c.id));
      const ids = new Set(col.decks().filter((d) => d.kind === 0 && confIds.has(d.configId)).map((d) => d.id));
      return (r) => ids.has(r.odid || r.did);
    }
    case "note":
    case "notetype": {
      const re = new RegExp(`^${wildcardToRegex(vl)}$`, "i");
      const ids = new Set(col.notetypes().filter((n) => re.test(n.name)).map((n) => n.id));
      return (r) => ids.has(r.ntid);
    }
    case "mid": {
      const ids = new Set(v.split(",").map(Number));
      return (r) => ids.has(r.ntid);
    }
    case "card": {
      if (/^\d+$/.test(v)) {
        const ord = Number(v) - 1;
        return (r) => r.ord === ord;
      }
      const re = new RegExp(`^${wildcardToRegex(vl)}$`, "i");
      return (r) => {
        const nt = col.notetype(r.ntid);
        const t = nt?.kind === 1 ? nt.templates[0] : nt?.templates[r.ord];
        return !!t && re.test(t.name);
      };
    }
    case "tag": {
      if (vl === "none") return (r) => r.tags.trim() === "";
      const re = new RegExp(`^${wildcardToRegex(vl)}(::.*)?$`, "i");
      return (r) => parseTags(r.tags).some((t) => re.test(t));
    }
    case "is": {
      switch (vl) {
        case "new":
          return (r) => r.type === CardType.New;
        case "learn":
          return (r) => r.queue === Queue.Learn || r.queue === Queue.DayLearn || r.type === CardType.Learn || r.type === CardType.Relearn;
        case "review":
          return (r) => r.type === CardType.Review || r.type === CardType.Relearn;
        case "due":
          return (r) =>
            ((r.queue === Queue.Review || r.queue === Queue.DayLearn) && (r.odid ? r.odue || r.due : r.due) <= ctx.today) ||
            ((r.queue === Queue.Learn || r.queue === Queue.Preview) && r.due <= ctx.now);
        case "suspended":
          return (r) => r.queue === Queue.Suspended;
        case "buried":
          return (r) => r.queue === Queue.SchedBuried || r.queue === Queue.UserBuried;
        case "buried-manually":
          return (r) => r.queue === Queue.UserBuried;
        case "buried-sibling":
          return (r) => r.queue === Queue.SchedBuried;
        case "marked":
          return (r) => parseTags(r.tags).some((t) => t.toLowerCase() === "marked");
        case "leech":
          return (r) => parseTags(r.tags).some((t) => t.toLowerCase() === "leech");
        case "orphan":
          return () => false;
        default:
          throw new HttpError(400, `Unknown search: is:${v}`);
      }
    }
    case "flag": {
      const f = Number(v);
      return (r) => (r.flags & 7) === f;
    }
    case "nid": {
      const ids = new Set(v.split(",").map(Number));
      return (r) => ids.has(r.nid);
    }
    case "cid": {
      const ids = new Set(v.split(",").map(Number));
      return (r) => ids.has(r.id);
    }
    case "w": {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${wildcardToRegex(vl)}($|[^\\p{L}\\p{N}_])`, "iu");
      return (r) => re.test(noteText(ctx, r));
    }
    case "re": {
      let re: RegExp;
      try {
        re = new RegExp(v, "i");
      } catch {
        throw new HttpError(400, `Invalid regex: ${v}`);
      }
      return (r) => re.test(splitFields(r.flds).join("\x1f"));
    }
    case "nc": {
      const re = new RegExp(wildcardToRegex(noCombining(vl)), "i");
      return (r) => re.test(noCombining(noteText(ctx, r)));
    }
    case "dupe": {
      const [ntid, ...rest] = v.split(",");
      const text = stripHtml(rest.join(",")).toLowerCase();
      return (r) => r.ntid === Number(ntid) && stripHtml(splitFields(r.flds)[0] ?? "").toLowerCase() === text;
    }
    case "added": {
      const cutoff = dayCutoffMs(ctx, Number(v) || 1);
      return (r) => r.id >= cutoff;
    }
    case "edited": {
      const cutoff = dayCutoffMs(ctx, Number(v) || 1) / 1000;
      return (r) => r.nmtime >= cutoff;
    }
    case "rated": {
      const [daysS, easeS] = v.split(":");
      const cutoff = dayCutoffMs(ctx, Math.min(365 * 100, Number(daysS) || 1));
      const ease = easeS ? Number(easeS) : 0;
      const s = revlogSet(
        ctx,
        `rated:${cutoff}:${ease}`,
        `SELECT DISTINCT cid FROM revlog WHERE id >= ? AND type != 4 ${ease ? "AND ease = ?" : "AND ease > 0"}`,
        ease ? [cutoff, ease] : [cutoff],
      );
      return (r) => s.has(r.id);
    }
    case "resched": {
      const cutoff = dayCutoffMs(ctx, Number(v) || 1);
      const s = revlogSet(ctx, `resched:${cutoff}`, "SELECT DISTINCT cid FROM revlog WHERE id >= ? AND type IN (4,5)", [cutoff]);
      return (r) => s.has(r.id);
    }
    case "introduced": {
      const cutoff = dayCutoffMs(ctx, Number(v) || 1);
      const s = revlogSet(
        ctx,
        `introduced:${cutoff}`,
        "SELECT cid FROM revlog WHERE type IN (0,1,2,3) AND ease > 0 GROUP BY cid HAVING min(id) >= ?",
        [cutoff],
      );
      return (r) => s.has(r.id);
    }
    case "prop": {
      const m = /^([a-z]+)(<=|>=|!=|=|<|>)(-?[\d.]+)$/i.exec(v);
      if (!m) throw new HttpError(400, `Invalid property search: prop:${v}`);
      const [, prop, op, numS] = m;
      const num = Number(numS);
      const fsrs = new FSRS();
      switch (prop.toLowerCase()) {
        case "ivl":
          return (r) => r.type === CardType.Review && cmp(op, r.ivl, num);
        case "due":
          return (r) => {
            if (r.queue === Queue.Review || r.queue === Queue.DayLearn) return cmp(op, (r.odid ? r.odue || r.due : r.due) - ctx.today, num);
            if (r.queue === Queue.Learn) return cmp(op, Math.floor((r.due - ctx.now) / 86400), num);
            return false;
          };
        case "pos":
          return (r) => r.type === CardType.New && cmp(op, r.due, num);
        case "reps":
          return (r) => cmp(op, r.reps, num);
        case "lapses":
          return (r) => cmp(op, r.lapses, num);
        case "ease":
          return (r) => r.factor > 0 && cmp(op, r.factor / 1000, num);
        case "s":
        case "stability":
          return (r) => r.stability != null && cmp(op, r.stability, num);
        case "d":
        case "difficulty":
          return (r) => r.difficulty != null && cmp(op, (r.difficulty - 1) / 9, num);
        case "r":
        case "retrievability":
          return (r) => {
            if (r.stability == null || !r.last_review) return false;
            const el = ctx.today - dayNumber(r.last_review, ctx.col.config.rolloverHour);
            return cmp(op, fsrs.retrievability(el, r.stability), num);
          };
        default:
          throw new HttpError(400, `Unknown property: ${prop}`);
      }
    }
    default: {
      // field search: "Front:value"
      const fieldName = key;
      const re = new RegExp(`^${wildcardToRegex(v)}$`, "is");
      return (r) => {
        const nt = col.notetype(r.ntid);
        if (!nt) return false;
        const idx = nt.fields.findIndex((f) => f.name.toLowerCase() === fieldName);
        if (idx < 0) return false;
        const f = splitFields(r.flds)[idx] ?? "";
        return re.test(f) || re.test(stripHtml(f));
      };
    }
  }
}

const ROW_SQL =
  "SELECT c.*, n.flds, n.tags, n.ntid, n.mtime AS nmtime, n.sfld, n.csum FROM cards c JOIN notes n ON n.id = c.nid";

export function searchRows(col: Collection, query: string, extraWhere = ""): SearchRow[] {
  const ast = parse(query.trim());
  const ctx: CompileCtx = { col, today: col.today(), now: nowSecs(), textCache: new Map(), revlogCache: new Map() };
  const pred = compile(ast, ctx);
  const rows = col.db.query<SearchRow, []>(ROW_SQL + (extraWhere ? ` WHERE ${extraWhere}` : "")).all();
  return rows.filter(pred);
}

export function searchCardIds(col: Collection, query: string): number[] {
  return searchRows(col, query).map((r) => r.id);
}

export function searchNoteIds(col: Collection, query: string): number[] {
  return [...new Set(searchRows(col, query).map((r) => r.nid))];
}

export { parse as parseSearch };
