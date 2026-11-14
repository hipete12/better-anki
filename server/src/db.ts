import { Database } from "bun:sqlite";

const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deck_configs (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL, mtime INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind INTEGER NOT NULL DEFAULT 0,
  config_id INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  filtered TEXT,
  collapsed INTEGER NOT NULL DEFAULT 0,
  extra TEXT NOT NULL DEFAULT '{}',
  mtime INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notetypes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind INTEGER NOT NULL DEFAULT 0,
  css TEXT NOT NULL DEFAULT '',
  sort_idx INTEGER NOT NULL DEFAULT 0,
  fields TEXT NOT NULL,
  templates TEXT NOT NULL,
  latex_pre TEXT NOT NULL DEFAULT '',
  latex_post TEXT NOT NULL DEFAULT '',
  original_id INTEGER,
  mtime INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  guid TEXT NOT NULL UNIQUE,
  ntid INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  flds TEXT NOT NULL,
  sfld TEXT NOT NULL DEFAULT '',
  csum INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_notes_csum ON notes(csum);
CREATE INDEX IF NOT EXISTS ix_notes_ntid ON notes(ntid);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  nid INTEGER NOT NULL,
  did INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  type INTEGER NOT NULL DEFAULT 0,
  queue INTEGER NOT NULL DEFAULT 0,
  due INTEGER NOT NULL DEFAULT 0,
  ivl INTEGER NOT NULL DEFAULT 0,
  factor INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  left INTEGER NOT NULL DEFAULT 0,
  odue INTEGER NOT NULL DEFAULT 0,
  odid INTEGER NOT NULL DEFAULT 0,
  flags INTEGER NOT NULL DEFAULT 0,
  stability REAL,
  difficulty REAL,
  last_review INTEGER,
  custom_data TEXT
);
CREATE INDEX IF NOT EXISTS ix_cards_sched ON cards(did, queue, due);
CREATE INDEX IF NOT EXISTS ix_cards_nid ON cards(nid);
CREATE TABLE IF NOT EXISTS revlog (
  id INTEGER PRIMARY KEY,
  cid INTEGER NOT NULL,
  ease INTEGER NOT NULL,
  ivl INTEGER NOT NULL,
  last_ivl INTEGER NOT NULL,
  factor INTEGER NOT NULL,
  time INTEGER NOT NULL,
  type INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_revlog_cid ON revlog(cid);
CREATE TABLE IF NOT EXISTS media (
  fname TEXT PRIMARY KEY, sha1 TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deck_today (
  did INTEGER NOT NULL, day INTEGER NOT NULL,
  new_done INTEGER NOT NULL DEFAULT 0, rev_done INTEGER NOT NULL DEFAULT 0,
  extend_new INTEGER NOT NULL DEFAULT 0, extend_rev INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (did, day)
);
CREATE TABLE IF NOT EXISTS tags (
  tag TEXT PRIMARY KEY COLLATE NOCASE, collapsed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS graves (
  oid INTEGER NOT NULL, kind INTEGER NOT NULL, mtime INTEGER NOT NULL
);
`;

// Columns whose change counts as a modification for offline sync (mtime-only touches don't).
const CARD_SYNC_COLS = ["nid", "did", "ord", "type", "queue", "due", "ivl", "factor", "reps", "lapses", "left", "odue", "odid", "flags", "stability", "difficulty", "last_review", "custom_data"];

/**
 * Change tracking for offline sync (docs/OFFLINE.md): `sync_state.version` is a counter, and every card
 * insert/real update and every review-log insert stamps the row's `usn` with it. Triggers cover every code path.
 */
const SYNC_SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);
INSERT OR IGNORE INTO sync_state(id, version) VALUES (1, 1);
CREATE TRIGGER IF NOT EXISTS cards_usn_insert AFTER INSERT ON cards BEGIN
  UPDATE cards SET usn = (SELECT version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS cards_usn_update AFTER UPDATE ON cards
  WHEN NEW.usn IS OLD.usn AND (${CARD_SYNC_COLS.map((c) => `NEW.${c} IS NOT OLD.${c}`).join(" OR ")}) BEGIN
  UPDATE cards SET usn = (SELECT version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS revlog_usn_insert AFTER INSERT ON revlog BEGIN
  UPDATE revlog SET usn = (SELECT version FROM sync_state WHERE id = 1) WHERE id = NEW.id;
END;
CREATE INDEX IF NOT EXISTS ix_revlog_usn ON revlog(usn);
`;

export function initSchema(db: Database): Database {
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(SCHEMA);
  const v = db.query<{ value: string }, []>("SELECT value FROM config WHERE key='schema_version'").get();
  if (!v) db.query("INSERT INTO config(key,value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  migrate(db);
  return db;
}

function migrate(db: Database) {
  const has = (table: string, col: string) => db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().some((r) => r.name === col);
  // v2: offline sync change tracking
  if (!has("cards", "usn")) db.exec("ALTER TABLE cards ADD COLUMN usn INTEGER NOT NULL DEFAULT 0");
  if (!has("revlog", "usn")) db.exec("ALTER TABLE revlog ADD COLUMN usn INTEGER NOT NULL DEFAULT 0");
  db.exec(SYNC_SCHEMA);
  db.query("UPDATE config SET value=? WHERE key='schema_version' AND CAST(value AS INTEGER) < ?").run(String(SCHEMA_VERSION), SCHEMA_VERSION);
}
