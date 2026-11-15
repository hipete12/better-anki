// Browse undo/redo. Each step keeps the before and after rows of every note and card the action touched,
// captured with temporary triggers, so any Browse action can be undone and redone without its own undo code.
// Order isn't part of it: new cards that only moved in the new-card queue aren't recorded, and undo/redo
// leaves a new card's queue position where it is now.
import type { Collection } from "./collection";
import { HttpError, nowSecs, parseTags } from "./util";
import { suppressStudyUndo } from "./sched/queue";

type Row = Record<string, unknown> & { id: number };
type Pair = [before: Row | null, after: Row | null];
interface Step {
  label: string;
  notes: Map<number, Pair>;
  cards: Map<number, Pair>;
}

const TABLES = ["notes", "cards"] as const;
type Table = (typeof TABLES)[number];
/** Columns that change without the row really changing. */
const IGNORE: Record<Table, string[]> = { notes: ["mtime"], cards: ["mtime", "usn"] };
const LIMIT = 30;

const undoStack: Step[] = [];
const redoStack: Step[] = [];

export function historyStatus() {
  return { undo: undoStack.at(-1)?.label ?? null, redo: redoStack.at(-1)?.label ?? null };
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

const columns = (col: Collection, t: Table) => col.db.query<{ name: string }, []>(`PRAGMA main.table_info(${t})`).all().map((r) => r.name);

function startCapture(col: Collection) {
  for (const t of TABLES) {
    const cols = columns(col, t);
    col.db.exec(`DROP TABLE IF EXISTS temp.h_${t}`);
    col.db.exec(`CREATE TEMP TABLE h_${t} (h_existed INTEGER, ${cols.map((c) => (c === "id" ? "id INTEGER PRIMARY KEY" : `"${c}"`)).join(", ")})`);
    // the first time a row is touched, keep how it was (h_existed = 0: it didn't exist yet)
    const keep = (id: string) => `INSERT OR IGNORE INTO h_${t} SELECT 1, * FROM main.${t} WHERE id = ${id};`;
    col.db.exec(`
      CREATE TEMP TRIGGER h_${t}_i BEFORE INSERT ON main.${t} BEGIN ${keep("NEW.id")} INSERT OR IGNORE INTO h_${t}(h_existed, id) VALUES (0, NEW.id); END;
      CREATE TEMP TRIGGER h_${t}_u BEFORE UPDATE ON main.${t} BEGIN ${keep("OLD.id")} END;
      CREATE TEMP TRIGGER h_${t}_d BEFORE DELETE ON main.${t} BEGIN ${keep("OLD.id")} END;`);
  }
}

function stopCapture(col: Collection) {
  for (const t of TABLES) col.db.exec(`DROP TRIGGER IF EXISTS temp.h_${t}_i; DROP TRIGGER IF EXISTS temp.h_${t}_u; DROP TRIGGER IF EXISTS temp.h_${t}_d; DROP TABLE IF EXISTS temp.h_${t};`);
}

function current(col: Collection, t: Table, ids: number[]): Map<number, Row> {
  const out = new Map<number, Row>();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of col.db.query<Row, number[]>(`SELECT * FROM ${t} WHERE id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) out.set(r.id, r);
  }
  return out;
}

const isNewCard = (r: Row | null | undefined) => !!r && r.type === 0;

/** Same row for undo purposes. New cards on both sides ignore their queue position (order isn't undone). */
function same(t: Table, a: Row | null | undefined, b: Row | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const skip = new Set(IGNORE[t]);
  if (t === "cards" && isNewCard(a) && isNewCard(b)) skip.add("due").add("odue");
  for (const k of Object.keys(a)) if (!skip.has(k) && a[k] !== b[k]) return false;
  return true;
}

function collect(col: Collection): Pick<Step, "notes" | "cards"> {
  const step = { notes: new Map<number, Pair>(), cards: new Map<number, Pair>() };
  for (const t of TABLES) {
    const before = col.db.query<Row & { h_existed: number }, []>(`SELECT * FROM h_${t}`).all();
    const after = current(col, t, before.map((r) => r.id));
    for (const { h_existed, ...row } of before) {
      const b = h_existed ? (row as Row) : null;
      const a = after.get(row.id) ?? null;
      if (!same(t, b, a)) step[t].set(row.id, [b, a]);
    }
  }
  return step;
}

/**
 * Run a Browse action and record it as one undo step. The action must do its database work synchronously
 * once it starts (route handlers read their body first), so nothing else lands in the step.
 */
let capturing = false;
export async function recordStep<T>(col: Collection, label: string, fn: () => T | Promise<T>): Promise<T> {
  if (capturing) return suppressStudyUndo(fn); // overlapping actions: the outer step can't tell them apart
  capturing = true;
  startCapture(col);
  let step: Pick<Step, "notes" | "cards"> | null = null;
  try {
    const out = await suppressStudyUndo(fn);
    step = collect(col);
    return out;
  } finally {
    stopCapture(col);
    capturing = false;
    if (step && (step.notes.size || step.cards.size)) {
      undoStack.push({ label, ...step });
      while (undoStack.length > LIMIT) undoStack.shift();
      redoStack.length = 0;
    }
  }
}

function apply(col: Collection, step: Step, dir: "undo" | "redo") {
  const want = dir === "undo" ? 0 : 1;
  const expect = 1 - want;
  for (const t of TABLES) {
    const now = current(col, t, [...step[t].keys()]);
    for (const [id, pair] of step[t])
      if (!same(t, now.get(id), pair[expect]))
        throw new HttpError(409, `Can't ${dir} “${step.label}”: some of those ${t} have changed since (for example, studied or edited). It's been removed from the list.`);
  }
  const ts = nowSecs();
  col.tx(() => {
    for (const t of TABLES) {
      const cols = columns(col, t).filter((c) => c !== "usn"); // the sync trigger stamps usn
      const upsert = col.db.query(`INSERT OR REPLACE INTO ${t}(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
      const now = current(col, t, [...step[t].keys()]);
      for (const [id, pair] of step[t]) {
        const target = pair[want];
        const kind = t === "notes" ? 1 : 0;
        if (!target) {
          if (now.has(id)) {
            col.db.query(`DELETE FROM ${t} WHERE id=?`).run(id);
            col.db.query("INSERT INTO graves(oid,kind,mtime) VALUES (?,?,?)").run(id, kind, ts);
          }
          continue;
        }
        const row: Row = { ...target, mtime: ts };
        const cur = now.get(id);
        if (t === "cards" && isNewCard(cur) && isNewCard(target)) Object.assign(row, { due: cur!.due, odue: cur!.odue });
        upsert.run(...(cols.map((c) => row[c] ?? null) as never[]));
        col.db.query("DELETE FROM graves WHERE oid=? AND kind=?").run(id, kind);
        if (t === "notes") col.registerTags(parseTags(String(target.tags ?? "")));
      }
    }
  });
  col.emit("notes", [...step.notes.keys()]);
  col.emit("cards", [...step.cards.keys()]);
}

export function undoStep(col: Collection) {
  const step = undoStack.pop();
  if (!step) return { done: null, ...historyStatus() };
  apply(col, step, "undo");
  redoStack.push(step);
  return { done: step.label, ...historyStatus() };
}

export function redoStep(col: Collection) {
  const step = redoStack.pop();
  if (!step) return { done: null, ...historyStatus() };
  apply(col, step, "redo");
  undoStack.push(step);
  return { done: step.label, ...historyStatus() };
}
