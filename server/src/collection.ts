import type { Database } from "bun:sqlite";
import { initSchema } from "./db";
import { EncryptedStore, type MediaStore } from "./crypto/storage";
import type { CardRow, CollectionConfig, Deck, DeckConfig, FilteredConfig, NoteRow, Notetype } from "./types";
import { CardType, Queue } from "./types";
import { defaultCollectionConfig, defaultDeckConfig, STOCK_NOTETYPES } from "./stock";
import {
  assert,
  dayNumber,
  fieldChecksum,
  HttpError,
  joinFields,
  joinTags,
  newGuid,
  newId,
  nowSecs,
  parseTags,
  splitFields,
  stripHtmlPreservingMedia,
} from "./util";
import { cardOrdsForNote } from "./render/template";

export type ChangeListener = (event: { kind: string; ids?: number[] }) => void;

/** The collection: a SQLite DB plus media folder. All server state lives here. */
export class Collection {
  db: Database;
  store: EncryptedStore;
  media: MediaStore;
  root: string;
  private listeners = new Set<ChangeListener>();
  private configCache: CollectionConfig | null = null;
  private ntCache = new Map<number, Notetype>();
  private deckCache: Map<number, Deck> | null = null;
  private dconfCache = new Map<number, DeckConfig>();

  /** Open (or create) the encrypted collection in `root` using the data key. */
  constructor(root: string, dek: Uint8Array, opts: { autoFlush?: boolean } = {}) {
    this.root = root;
    this.store = new EncryptedStore(root, dek);
    this.media = this.store.media;
    this.db = initSchema(this.store.loadDatabase());
    this.ensureDefaults();
    this.store.flush(this.db, true);
    if (opts.autoFlush !== false) this.store.startAutoFlush(this.db);
  }

  /** Write an encrypted snapshot now (if anything changed). */
  flush() {
    return this.store.flush(this.db);
  }

  close() {
    this.store.stopAutoFlush();
    try {
      this.store.flush(this.db);
    } finally {
      this.db.close();
    }
  }

  // ---------- events ----------
  onChange(l: ChangeListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(kind: string, ids?: number[]) {
    for (const l of this.listeners) {
      try {
        l({ kind, ids });
      } catch {}
    }
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---------- config ----------
  private ensureDefaults() {
    const has = this.db.query("SELECT 1 FROM config WHERE key='col'").get();
    if (!has) {
      this.db.query("INSERT INTO config(key,value) VALUES ('col', ?)").run(JSON.stringify(defaultCollectionConfig()));
    }
    if (!this.db.query("SELECT 1 FROM deck_configs WHERE id=1").get()) {
      this.saveDeckConfig(defaultDeckConfig(1, "Default"));
    }
    if (!this.db.query("SELECT 1 FROM decks WHERE id=1").get()) {
      this.db
        .query("INSERT INTO decks(id,name,kind,config_id,mtime) VALUES (1,'Default',0,1,?)")
        .run(nowSecs());
    }
    if (!this.db.query("SELECT 1 FROM notetypes LIMIT 1").get()) {
      for (const key of ["basic", "basicReversed", "basicOptionalReversed", "basicTyping", "cloze", "imageOcclusion"]) {
        this.addStockNotetype(key);
      }
    }
  }

  get config(): CollectionConfig {
    if (!this.configCache) {
      const row = this.db.query<{ value: string }, []>("SELECT value FROM config WHERE key='col'").get();
      this.configCache = { ...defaultCollectionConfig(), ...(row ? JSON.parse(row.value) : {}) };
    }
    return this.configCache!;
  }

  setConfig(patch: Partial<CollectionConfig>) {
    const next = { ...this.config, ...patch };
    this.db.query("INSERT OR REPLACE INTO config(key,value) VALUES ('col', ?)").run(JSON.stringify(next));
    this.configCache = next;
    this.emit("config");
  }

  getKV<T>(key: string, def: T): T {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM config WHERE key=?").get(key);
    return row ? (JSON.parse(row.value) as T) : def;
  }
  setKV(key: string, value: unknown) {
    this.db.query("INSERT OR REPLACE INTO config(key,value) VALUES (?, ?)").run(key, JSON.stringify(value));
  }

  /** Current study day number. */
  today(ts = nowSecs()): number {
    return dayNumber(ts, this.config.rolloverHour);
  }

  // ---------- deck configs ----------
  deckConfig(id: number): DeckConfig {
    let c = this.dconfCache.get(id);
    if (!c) {
      const row = this.db
        .query<{ id: number; name: string; config: string; mtime: number }, [number]>(
          "SELECT * FROM deck_configs WHERE id=?",
        )
        .get(id);
      if (!row) return id === 1 ? defaultDeckConfig(1, "Default") : this.deckConfig(1);
      c = { ...defaultDeckConfig(row.id, row.name), ...JSON.parse(row.config), id: row.id, name: row.name, mtime: row.mtime };
      this.dconfCache.set(id, c!);
    }
    return c!;
  }

  allDeckConfigs(): (DeckConfig & { useCount: number })[] {
    const rows = this.db.query<{ id: number }, []>("SELECT id FROM deck_configs ORDER BY name COLLATE NOCASE").all();
    const counts = new Map(
      this.db
        .query<{ config_id: number; n: number }, []>(
          "SELECT config_id, count(*) n FROM decks WHERE kind=0 GROUP BY config_id",
        )
        .all()
        .map((r) => [r.config_id, r.n]),
    );
    return rows.map((r) => ({ ...this.deckConfig(r.id), useCount: counts.get(r.id) ?? 0 }));
  }

  saveDeckConfig(conf: DeckConfig): DeckConfig {
    const { id, name, mtime: _m, ...rest } = conf as DeckConfig & { useCount?: number };
    delete (rest as { useCount?: number }).useCount;
    const mtime = nowSecs();
    this.db
      .query("INSERT OR REPLACE INTO deck_configs(id,name,config,mtime) VALUES (?,?,?,?)")
      .run(id, name, JSON.stringify(rest), mtime);
    this.dconfCache.delete(id);
    this.emit("deckConfig", [id]);
    return this.deckConfig(id);
  }

  addDeckConfig(name: string, cloneFrom?: number): DeckConfig {
    const base = cloneFrom ? this.deckConfig(cloneFrom) : defaultDeckConfig(0, name);
    return this.saveDeckConfig({ ...base, id: newId(), name });
  }

  removeDeckConfig(id: number) {
    assert(id !== 1, "The default preset can't be removed");
    this.tx(() => {
      this.db.query("UPDATE decks SET config_id=1 WHERE config_id=?").run(id);
      this.db.query("DELETE FROM deck_configs WHERE id=?").run(id);
    });
    this.dconfCache.delete(id);
    this.deckCache = null;
    this.emit("deckConfig", [id]);
  }

  /** Config used to schedule a card (home deck's preset when in a filtered deck). */
  configForCard(card: CardRow): DeckConfig {
    const deck = this.deck(card.odid || card.did);
    return this.deckConfig(deck && deck.kind === 0 ? deck.configId : 1);
  }

  // ---------- decks ----------
  private loadDecks(): Map<number, Deck> {
    if (!this.deckCache) {
      const rows = this.db
        .query<
          {
            id: number;
            name: string;
            kind: 0 | 1;
            config_id: number;
            description: string;
            filtered: string | null;
            collapsed: number;
            extra: string;
            mtime: number;
          },
          []
        >("SELECT * FROM decks")
        .all();
      this.deckCache = new Map(
        rows.map((r) => {
          const extra = JSON.parse(r.extra || "{}");
          return [
            r.id,
            {
              id: r.id,
              name: r.name,
              kind: r.kind,
              configId: r.config_id,
              description: r.description,
              filtered: r.filtered ? (JSON.parse(r.filtered) as FilteredConfig) : null,
              collapsed: !!r.collapsed,
              mtime: r.mtime,
              reviewLimit: extra.reviewLimit ?? null,
              newLimit: extra.newLimit ?? null,
              desiredRetention: extra.desiredRetention ?? null,
            },
          ];
        }),
      );
    }
    return this.deckCache;
  }

  decks(): Deck[] {
    return [...this.loadDecks().values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }

  deck(id: number): Deck | undefined {
    return this.loadDecks().get(id);
  }

  deckByName(name: string): Deck | undefined {
    const lower = normalizeDeckName(name).toLowerCase();
    for (const d of this.loadDecks().values()) if (d.name.toLowerCase() === lower) return d;
    return undefined;
  }

  /** Deck ids of a deck and all its descendants. */
  deckAndChildren(id: number): number[] {
    const d = this.deck(id);
    if (!d) return [];
    const prefix = d.name.toLowerCase() + "::";
    return [id, ...this.decks().filter((x) => x.name.toLowerCase().startsWith(prefix)).map((x) => x.id)];
  }

  /** Parent decks of a deck (closest first). */
  deckParents(id: number): Deck[] {
    const d = this.deck(id);
    if (!d) return [];
    const parts = d.name.split("::");
    const out: Deck[] = [];
    for (let i = parts.length - 1; i > 0; i--) {
      const p = this.deckByName(parts.slice(0, i).join("::"));
      if (p) out.push(p);
    }
    return out;
  }

  /** Get or create a deck by full name (creating missing parents). */
  ensureDeck(name: string, filtered = false): Deck {
    name = normalizeDeckName(name);
    assert(name.length > 0, "Deck name can't be empty");
    const existing = this.deckByName(name);
    if (existing) return existing;
    const parts = name.split("::");
    for (let i = 1; i < parts.length; i++) {
      const parent = this.deckByName(parts.slice(0, i).join("::"));
      if (parent?.kind === 1) throw new HttpError(400, "Filtered decks can't have subdecks");
      if (!parent) this.ensureDeck(parts.slice(0, i).join("::"));
    }
    const id = newId();
    this.db
      .query("INSERT INTO decks(id,name,kind,config_id,mtime,filtered) VALUES (?,?,?,?,?,?)")
      .run(
        id,
        name,
        filtered ? 1 : 0,
        1,
        nowSecs(),
        filtered
          ? JSON.stringify({
              terms: [{ search: "", limit: 100, order: 0 }],
              reschedule: true,
              previewAgainSecs: 60,
              previewHardSecs: 600,
              previewGoodSecs: 0,
            } satisfies FilteredConfig)
          : null,
      );
    this.deckCache = null;
    this.emit("decks", [id]);
    return this.deck(id)!;
  }

  updateDeck(id: number, patch: Partial<Deck>) {
    const d = this.deck(id);
    assert(d, "Deck not found", 404);
    this.tx(() => {
      if (patch.name !== undefined && normalizeDeckName(patch.name) !== d.name) {
        this.renameDeck(id, patch.name);
      }
      const next = { ...this.deck(id)!, ...patch, name: this.deck(id)!.name };
      const extra = { reviewLimit: next.reviewLimit ?? null, newLimit: next.newLimit ?? null, desiredRetention: next.desiredRetention ?? null };
      this.db
        .query("UPDATE decks SET config_id=?, description=?, collapsed=?, filtered=?, extra=?, mtime=? WHERE id=?")
        .run(
          next.configId,
          next.description ?? "",
          next.collapsed ? 1 : 0,
          next.filtered ? JSON.stringify(next.filtered) : null,
          JSON.stringify(extra),
          nowSecs(),
          id,
        );
    });
    this.deckCache = null;
    this.emit("decks", [id]);
    return this.deck(id)!;
  }

  renameDeck(id: number, newName: string) {
    const d = this.deck(id);
    assert(d, "Deck not found", 404);
    newName = normalizeDeckName(newName);
    assert(newName, "Deck name can't be empty");
    const clash = this.deckByName(newName);
    assert(!clash || clash.id === id, "A deck with that name already exists");
    assert(!newName.toLowerCase().startsWith(d.name.toLowerCase() + "::"), "Can't move a deck into itself");
    const parentName = newName.split("::").slice(0, -1).join("::");
    if (parentName) {
      const parent = this.ensureDeck(parentName);
      assert(parent.kind === 0, "Filtered decks can't have subdecks");
    }
    const children = this.deckAndChildren(id).slice(1);
    const oldPrefix = d.name;
    this.tx(() => {
      this.db.query("UPDATE decks SET name=?, mtime=? WHERE id=?").run(newName, nowSecs(), id);
      for (const cid of children) {
        const c = this.deck(cid)!;
        this.db.query("UPDATE decks SET name=?, mtime=? WHERE id=?").run(newName + c.name.slice(oldPrefix.length), nowSecs(), cid);
      }
    });
    this.deckCache = null;
    this.emit("decks", [id]);
  }

  /** Delete a deck, its children, and all of their cards. */
  removeDeck(id: number) {
    const ids = this.deckAndChildren(id);
    assert(ids.length, "Deck not found", 404);
    this.tx(() => {
      for (const did of ids) {
        const d = this.deck(did)!;
        if (d.kind === 1) this.emptyFiltered(did);
        else {
          // return filtered cards to... they're deleted anyway
          const cids = this.db.query<{ id: number }, [number, number]>("SELECT id FROM cards WHERE did=? OR odid=?").all(did, did).map((r) => r.id);
          this.removeCards(cids);
        }
        if (did !== 1) this.db.query("DELETE FROM decks WHERE id=?").run(did);
      }
    });
    this.deckCache = null;
    this.emit("decks", ids);
  }

  emptyFiltered(did: number) {
    this.db
      .query(
        `UPDATE cards SET did=odid,
         queue=(CASE WHEN queue=4 THEN (CASE type WHEN 0 THEN 0 WHEN 2 THEN 2 ELSE (CASE WHEN odue>1000000000 THEN 1 ELSE 3 END) END) ELSE queue END),
         due=(CASE WHEN queue IN (1,3) AND type IN (1,3) THEN due WHEN odue!=0 THEN odue ELSE due END),
         odue=0, odid=0, mtime=? WHERE did=? AND odid!=0`,
      )
      .run(nowSecs(), did);
    this.emit("cards");
  }

  // ---------- notetypes ----------
  notetype(id: number): Notetype | undefined {
    let n = this.ntCache.get(id);
    if (!n) {
      const r = this.db
        .query<
          {
            id: number;
            name: string;
            kind: 0 | 1;
            css: string;
            sort_idx: number;
            fields: string;
            templates: string;
            latex_pre: string;
            latex_post: string;
            original_id: number | null;
            mtime: number;
          },
          [number]
        >("SELECT * FROM notetypes WHERE id=?")
        .get(id);
      if (!r) return undefined;
      n = {
        id: r.id,
        name: r.name,
        kind: r.kind,
        css: r.css,
        sortIdx: r.sort_idx,
        fields: JSON.parse(r.fields),
        templates: JSON.parse(r.templates),
        latexPre: r.latex_pre,
        latexPost: r.latex_post,
        originalId: r.original_id,
        mtime: r.mtime,
      };
      this.ntCache.set(id, n);
    }
    return n;
  }

  notetypes(): Notetype[] {
    return this.db
      .query<{ id: number }, []>("SELECT id FROM notetypes ORDER BY name COLLATE NOCASE")
      .all()
      .map((r) => this.notetype(r.id)!);
  }

  notetypeByName(name: string): Notetype | undefined {
    const r = this.db.query<{ id: number }, [string]>("SELECT id FROM notetypes WHERE name=? COLLATE NOCASE").get(name);
    return r ? this.notetype(r.id) : undefined;
  }

  saveNotetypeRow(nt: Notetype) {
    nt.fields.forEach((f, i) => (f.ord = i));
    nt.templates.forEach((t, i) => (t.ord = i));
    this.db
      .query(
        "INSERT OR REPLACE INTO notetypes(id,name,kind,css,sort_idx,fields,templates,latex_pre,latex_post,original_id,mtime) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        nt.id,
        nt.name,
        nt.kind,
        nt.css,
        nt.sortIdx,
        JSON.stringify(nt.fields),
        JSON.stringify(nt.templates),
        nt.latexPre,
        nt.latexPost,
        nt.originalId ?? null,
        nowSecs(),
      );
    this.ntCache.delete(nt.id);
  }

  uniqueNotetypeName(name: string): string {
    let n = name;
    let i = 1;
    while (this.notetypeByName(n)) n = `${name}-${++i}`;
    return n;
  }

  addStockNotetype(key: string, name?: string): Notetype {
    const stock = STOCK_NOTETYPES[key];
    assert(stock, "Unknown stock notetype");
    const nt: Notetype = {
      ...structuredClone(stock),
      id: newId(),
      name: this.uniqueNotetypeName(name || stock.name),
      mtime: nowSecs(),
    };
    this.saveNotetypeRow(nt);
    this.emit("notetypes", [nt.id]);
    return this.notetype(nt.id)!;
  }

  cloneNotetype(id: number, name: string): Notetype {
    const src = this.notetype(id);
    assert(src, "Notetype not found", 404);
    const nt: Notetype = { ...structuredClone(src), id: newId(), name: this.uniqueNotetypeName(name), originalId: null };
    this.saveNotetypeRow(nt);
    this.emit("notetypes", [nt.id]);
    return this.notetype(nt.id)!;
  }

  /**
   * Update a notetype. `fields`/`templates` entries may carry `origOrd` (their
   * previous index, or null for newly added ones); notes and cards are remapped.
   */
  updateNotetype(
    id: number,
    update: Partial<Omit<Notetype, "fields" | "templates">> & {
      fields?: (Notetype["fields"][number] & { origOrd?: number | null })[];
      templates?: (Notetype["templates"][number] & { origOrd?: number | null })[];
    },
  ): Notetype {
    const old = this.notetype(id);
    assert(old, "Notetype not found", 404);
    const next: Notetype = structuredClone(old);
    if (update.name !== undefined) {
      assert(update.name.trim(), "Name can't be empty");
      next.name = update.name.trim();
    }
    if (update.css !== undefined) next.css = update.css;
    if (update.sortIdx !== undefined) next.sortIdx = update.sortIdx;
    if (update.latexPre !== undefined) next.latexPre = update.latexPre;
    if (update.latexPost !== undefined) next.latexPost = update.latexPost;

    this.tx(() => {
      if (update.fields) {
        assert(update.fields.length > 0, "A notetype needs at least one field");
        const names = new Set<string>();
        for (const f of update.fields) {
          const n = f.name.trim();
          assert(n && !/[:{}"]/.test(n) && !n.startsWith("#") && !n.startsWith("/") && !n.startsWith("^"), `Invalid field name: ${f.name}`);
          assert(!names.has(n.toLowerCase()), `Duplicate field name: ${n}`);
          names.add(n.toLowerCase());
        }
        const mapping = update.fields.map((f) => (f.origOrd === undefined ? f.ord : f.origOrd));
        // rename references in templates
        const renames = new Map<string, string>();
        update.fields.forEach((f) => {
          const oi = f.origOrd === undefined ? f.ord : f.origOrd;
          if (oi != null && old.fields[oi] && old.fields[oi].name !== f.name.trim()) renames.set(old.fields[oi].name, f.name.trim());
        });
        next.fields = update.fields.map((f, i) => {
          const { origOrd: _o, ...rest } = f;
          return { ...rest, name: f.name.trim(), ord: i };
        });
        if (renames.size) {
          for (const t of next.templates) {
            t.qfmt = renameFieldRefs(t.qfmt, renames);
            t.afmt = renameFieldRefs(t.afmt, renames);
          }
        }
        if (next.sortIdx >= next.fields.length) next.sortIdx = 0;
        const changed = mapping.length !== old.fields.length || mapping.some((m, i) => m !== i);
        if (changed) {
          const notes = this.db.query<{ id: number; flds: string }, [number]>("SELECT id, flds FROM notes WHERE ntid=?").all(id);
          const upd = this.db.query("UPDATE notes SET flds=?, mtime=? WHERE id=?");
          for (const n of notes) {
            const f = splitFields(n.flds);
            upd.run(joinFields(mapping.map((m) => (m == null ? "" : (f[m] ?? "")))), nowSecs(), n.id);
          }
        }
      }
      if (update.templates) {
        assert(update.templates.length > 0, "A notetype needs at least one card type");
        if (next.kind === 1) assert(update.templates.length === 1, "Cloze notetypes have exactly one card type");
        const mapping = update.templates.map((t) => (t.origOrd === undefined ? t.ord : t.origOrd));
        next.templates = update.templates.map((t, i) => {
          const { origOrd: _o, ...rest } = t;
          return { ...rest, ord: i };
        });
        if (next.kind === 0) {
          const kept = new Set(mapping.filter((m) => m != null) as number[]);
          const removed = old.templates.map((_, i) => i).filter((i) => !kept.has(i));
          if (removed.length) {
            const cids = this.db
              .query<{ id: number }, [number]>(
                `SELECT c.id FROM cards c JOIN notes n ON n.id=c.nid WHERE n.ntid=? AND c.ord IN (${removed.join(",")})`,
              )
              .all(id)
              .map((r) => r.id);
            this.removeCards(cids, false);
          }
          // remap ords (two-phase to avoid collisions)
          const changed = mapping.some((m, i) => m != null && m !== i);
          if (changed) {
            mapping.forEach((m, i) => {
              if (m != null && m !== i)
                this.db
                  .query("UPDATE cards SET ord=? WHERE ord=? AND nid IN (SELECT id FROM notes WHERE ntid=?)")
                  .run(-1000 - i, m, id);
            });
            mapping.forEach((m, i) => {
              if (m != null && m !== i)
                this.db
                  .query("UPDATE cards SET ord=? WHERE ord=? AND nid IN (SELECT id FROM notes WHERE ntid=?)")
                  .run(i, -1000 - i, id);
            });
          }
        }
      }
      this.saveNotetypeRow(next);
      // regenerate sort fields + missing cards
      const notes = this.db.query<NoteRow, [number]>("SELECT * FROM notes WHERE ntid=?").all(id);
      const updSort = this.db.query("UPDATE notes SET sfld=?, csum=? WHERE id=?");
      for (const n of notes) {
        const f = splitFields(n.flds);
        updSort.run(sortFieldValue(f[next.sortIdx] ?? ""), fieldChecksum(f[0] ?? ""), n.id);
        this.generateCards(n, next);
      }
    });
    this.emit("notetypes", [id]);
    return this.notetype(id)!;
  }

  removeNotetype(id: number) {
    assert(this.notetypes().length > 1, "You need at least one notetype");
    this.tx(() => {
      const nids = this.db.query<{ id: number }, [number]>("SELECT id FROM notes WHERE ntid=?").all(id).map((r) => r.id);
      this.removeNotes(nids);
      this.db.query("DELETE FROM notetypes WHERE id=?").run(id);
    });
    this.ntCache.delete(id);
    this.emit("notetypes", [id]);
  }

  noteCountByNotetype(): Map<number, number> {
    return new Map(
      this.db
        .query<{ ntid: number; n: number }, []>("SELECT ntid, count(*) n FROM notes GROUP BY ntid")
        .all()
        .map((r) => [r.ntid, r.n]),
    );
  }

  // ---------- notes ----------
  note(id: number): NoteRow | undefined {
    return this.db.query<NoteRow, [number]>("SELECT * FROM notes WHERE id=?").get(id) ?? undefined;
  }

  card(id: number): CardRow | undefined {
    return this.db.query<CardRow, [number]>("SELECT * FROM cards WHERE id=?").get(id) ?? undefined;
  }

  cardsOfNote(nid: number): CardRow[] {
    return this.db.query<CardRow, [number]>("SELECT * FROM cards WHERE nid=? ORDER BY ord").all(nid);
  }

  nextNewPosition(): number {
    const pos = this.getKV<number>("nextPos", 0) || 1 + (this.db.query<{ m: number | null }, []>("SELECT max(due) m FROM cards WHERE type=0").get()?.m ?? 0);
    this.setKV("nextPos", pos + 1);
    return pos;
  }

  /** Add a note and generate its cards. Returns the note id and number of cards. */
  addNote(ntid: number, fields: string[], tags: string[], deckId: number, opts: { guid?: string; id?: number; allowEmpty?: boolean } = {}) {
    const nt = this.notetype(ntid);
    assert(nt, "Notetype not found", 404);
    const deck = this.deck(deckId);
    assert(deck && deck.kind === 0, "Choose a regular (non-filtered) deck");
    const f = nt.fields.map((_, i) => fields[i] ?? "");
    const note: NoteRow = {
      id: opts.id ?? newId(),
      guid: opts.guid ?? newGuid(),
      ntid,
      mtime: nowSecs(),
      tags: joinTags(tags),
      flds: joinFields(f),
      sfld: sortFieldValue(f[nt.sortIdx] ?? ""),
      csum: fieldChecksum(f[0] ?? ""),
    };
    const ords = cardOrdsForNote(nt, f);
    assert(ords.length > 0 || opts.allowEmpty, nt.kind === 1 ? "No cloze deletions found. Use {{c1::text}}." : "The front of this card would be empty. Fill in the required fields.");
    this.tx(() => {
      this.db
        .query("INSERT INTO notes(id,guid,ntid,mtime,tags,flds,sfld,csum) VALUES (?,?,?,?,?,?,?,?)")
        .run(note.id, note.guid, note.ntid, note.mtime, note.tags, note.flds, note.sfld, note.csum);
      this.registerTags(tags);
      this.generateCards(note, nt, deckId);
    });
    this.emit("notes", [note.id]);
    return { id: note.id, cards: this.cardsOfNote(note.id).length };
  }

  /** Generate any missing cards for a note. */
  generateCards(note: NoteRow, nt?: Notetype, deckId?: number): number {
    nt = nt ?? this.notetype(note.ntid)!;
    const f = splitFields(note.flds);
    const existing = new Set(this.db.query<{ ord: number }, [number]>("SELECT ord FROM cards WHERE nid=?").all(note.id).map((r) => r.ord));
    const ords = cardOrdsForNote(nt, f).filter((o) => !existing.has(o));
    if (!ords.length) return 0;
    let did = deckId;
    if (!did) {
      const sib = this.db.query<{ did: number; odid: number }, [number]>("SELECT did, odid FROM cards WHERE nid=? LIMIT 1").get(note.id);
      did = sib ? sib.odid || sib.did : this.config.lastDeckId || 1;
    }
    if (!this.deck(did) || this.deck(did)!.kind === 1) did = 1;
    const ins = this.db.query(
      "INSERT INTO cards(id,nid,did,ord,mtime,type,queue,due) VALUES (?,?,?,?,?,0,0,?)",
    );
    const conf = this.deckConfig(this.deck(did)!.configId);
    for (const ord of ords) {
      const tmpl = nt.kind === 0 ? nt.templates[ord] : undefined;
      let cdid = did;
      if (tmpl?.targetDeckId && this.deck(tmpl.targetDeckId)?.kind === 0) cdid = tmpl.targetDeckId;
      const pos = conf.newInsertOrder === 1 ? Math.floor(Math.random() * 1_000_000) : this.nextNewPosition();
      ins.run(newId(), note.id, cdid, ord, nowSecs(), pos);
    }
    return ords.length;
  }

  updateNote(id: number, fields?: string[], tags?: string[]) {
    const note = this.note(id);
    assert(note, "Note not found", 404);
    const nt = this.notetype(note.ntid)!;
    this.tx(() => {
      if (fields) {
        const f = nt.fields.map((_, i) => fields[i] ?? "");
        note.flds = joinFields(f);
        note.sfld = sortFieldValue(f[nt.sortIdx] ?? "");
        note.csum = fieldChecksum(f[0] ?? "");
      }
      if (tags) {
        note.tags = joinTags(tags);
        this.registerTags(tags);
      }
      note.mtime = nowSecs();
      this.db
        .query("UPDATE notes SET flds=?, sfld=?, csum=?, tags=?, mtime=? WHERE id=?")
        .run(note.flds, note.sfld, note.csum, note.tags, note.mtime, id);
      this.generateCards(note, nt);
    });
    this.emit("notes", [id]);
    return note;
  }

  removeNotes(nids: number[]) {
    if (!nids.length) return;
    this.tx(() => {
      for (const chunk of chunks(nids, 500)) {
        const ph = chunk.map(() => "?").join(",");
        const cids = this.db.query<{ id: number }, number[]>(`SELECT id FROM cards WHERE nid IN (${ph})`).all(...chunk).map((r) => r.id);
        this.removeCards(cids, false);
        this.db.query(`DELETE FROM notes WHERE id IN (${ph})`).run(...chunk);
        const g = this.db.query("INSERT INTO graves(oid,kind,mtime) VALUES (?,1,?)");
        for (const n of chunk) g.run(n, nowSecs());
      }
    });
    this.emit("notes", nids);
  }

  /** Remove cards; optionally remove notes left without cards. */
  removeCards(cids: number[], removeOrphanNotes = true) {
    if (!cids.length) return;
    this.tx(() => {
      const nids = new Set<number>();
      for (const chunk of chunks(cids, 500)) {
        const ph = chunk.map(() => "?").join(",");
        if (removeOrphanNotes)
          for (const r of this.db.query<{ nid: number }, number[]>(`SELECT DISTINCT nid FROM cards WHERE id IN (${ph})`).all(...chunk)) nids.add(r.nid);
        this.db.query(`DELETE FROM cards WHERE id IN (${ph})`).run(...chunk);
        const g = this.db.query("INSERT INTO graves(oid,kind,mtime) VALUES (?,0,?)");
        for (const c of chunk) g.run(c, nowSecs());
      }
      if (removeOrphanNotes && nids.size) {
        const orphans = [...nids].filter((n) => !this.db.query("SELECT 1 FROM cards WHERE nid=? LIMIT 1").get(n));
        if (orphans.length) this.removeNotes(orphans);
      }
    });
    this.emit("cards", cids);
  }

  // ---------- tags ----------
  registerTags(tags: string[]) {
    const q = this.db.query("INSERT OR IGNORE INTO tags(tag) VALUES (?)");
    for (const t of tags) if (t) q.run(t);
  }

  allTags(): string[] {
    return this.db.query<{ tag: string }, []>("SELECT tag FROM tags ORDER BY tag COLLATE NOCASE").all().map((r) => r.tag);
  }

  /** Remove registered tags that no note uses. */
  clearUnusedTags() {
    const used = new Set<string>();
    for (const r of this.db.query<{ tags: string }, []>("SELECT tags FROM notes WHERE tags != ''").all())
      for (const t of parseTags(r.tags)) used.add(t.toLowerCase());
    const all = this.allTags();
    const del = this.db.query("DELETE FROM tags WHERE tag=?");
    let n = 0;
    this.tx(() => {
      for (const t of all)
        if (!used.has(t.toLowerCase())) {
          del.run(t);
          n++;
        }
      for (const t of used) this.db.query("INSERT OR IGNORE INTO tags(tag) VALUES (?)").run(t);
    });
    return n;
  }

  /** Add/remove/rename tags on notes. Matching is case-insensitive and hierarchical for rename. */
  modifyTags(nids: number[], add: string[], remove: string[]) {
    const removeSet = new Set(remove.map((t) => t.toLowerCase()));
    this.tx(() => {
      const upd = this.db.query("UPDATE notes SET tags=?, mtime=? WHERE id=?");
      for (const chunk of chunks(nids, 500)) {
        const rows = this.db
          .query<{ id: number; tags: string }, number[]>(`SELECT id, tags FROM notes WHERE id IN (${chunk.map(() => "?").join(",")})`)
          .all(...chunk);
        for (const r of rows) {
          const cur = parseTags(r.tags).filter((t) => !removeSet.has(t.toLowerCase()));
          const next = joinTags([...cur, ...add]);
          if (next !== r.tags) upd.run(next, nowSecs(), r.id);
        }
      }
      this.registerTags(add);
    });
    this.emit("notes", nids);
  }

  renameTag(oldTag: string, newTag: string) {
    const lo = oldTag.toLowerCase();
    let count = 0;
    this.tx(() => {
      const rows = this.db.query<{ id: number; tags: string }, []>("SELECT id, tags FROM notes WHERE tags != ''").all();
      const upd = this.db.query("UPDATE notes SET tags=?, mtime=? WHERE id=?");
      for (const r of rows) {
        let changed = false;
        const tags = parseTags(r.tags).map((t) => {
          const tl = t.toLowerCase();
          if (tl === lo) {
            changed = true;
            return newTag;
          }
          if (tl.startsWith(lo + "::")) {
            changed = true;
            return newTag + t.slice(oldTag.length);
          }
          return t;
        });
        if (changed) {
          upd.run(joinTags(tags), nowSecs(), r.id);
          count++;
        }
      }
      this.clearUnusedTags();
    });
    this.emit("notes");
    return count;
  }

  removeTagEverywhere(tag: string) {
    const lo = tag.toLowerCase();
    const nids = this.db
      .query<{ id: number; tags: string }, []>("SELECT id, tags FROM notes WHERE tags != ''")
      .all()
      .filter((r) => parseTags(r.tags).some((t) => t.toLowerCase() === lo || t.toLowerCase().startsWith(lo + "::")))
      .map((r) => r.id);
    const all = new Set<string>();
    for (const r of this.db.query<{ tags: string }, []>("SELECT tags FROM notes WHERE tags != ''").all())
      for (const t of parseTags(r.tags)) if (t.toLowerCase() === lo || t.toLowerCase().startsWith(lo + "::")) all.add(t);
    this.modifyTags(nids, [], [...all]);
    this.clearUnusedTags();
    return nids.length;
  }

  // ---------- misc ----------
  counts() {
    const q = (sql: string) => (this.db.query<{ n: number }, []>(sql).get()?.n ?? 0);
    return {
      notes: q("SELECT count(*) n FROM notes"),
      cards: q("SELECT count(*) n FROM cards"),
      decks: q("SELECT count(*) n FROM decks"),
      revlog: q("SELECT count(*) n FROM revlog"),
      media: q("SELECT count(*) n FROM media"),
    };
  }

  /** Reset card to new (Anki's "Forget"). */
  forgetCards(cids: number[], resetCounts = false) {
    this.tx(() => {
      const q = this.db.query(
        `UPDATE cards SET type=0, queue=0, due=?, ivl=0, factor=0, left=0, stability=NULL, difficulty=NULL, last_review=NULL,
         reps=CASE WHEN ? THEN 0 ELSE reps END, lapses=CASE WHEN ? THEN 0 ELSE lapses END, mtime=?, odue=0 WHERE id=?`,
      );
      for (const cid of cids) q.run(this.nextNewPosition(), resetCounts ? 1 : 0, resetCounts ? 1 : 0, nowSecs(), cid);
    });
    this.emit("cards", cids);
  }

  /** Card's effective scheduling queue type for display. */
  static cardStateLabel(c: CardRow): string {
    if (c.queue === Queue.Suspended) return "suspended";
    if (c.queue === Queue.SchedBuried || c.queue === Queue.UserBuried) return "buried";
    if (c.type === CardType.New) return "new";
    if (c.type === CardType.Learn || c.type === CardType.Relearn) return "learning";
    return c.ivl >= 21 ? "mature" : "young";
  }
}

export function normalizeDeckName(name: string): string {
  return name
    .split("::")
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("::");
}

export function sortFieldValue(f: string): string {
  return stripHtmlPreservingMedia(f).slice(0, 512);
}

function renameFieldRefs(tmpl: string, renames: Map<string, string>): string {
  return tmpl.replace(/\{\{([^}]+)\}\}/g, (m, inner: string) => {
    const prefix = inner.match(/^[#^/]/)?.[0] ?? "";
    const rest = prefix ? inner.slice(1) : inner;
    const parts = rest.split(":");
    const fname = parts[parts.length - 1].trim();
    const rn = renames.get(fname);
    if (!rn) return m;
    parts[parts.length - 1] = rn;
    return `{{${prefix}${parts.join(":")}}}`;
  });
}

export function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export { dayNumber };
