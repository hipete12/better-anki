// Encrypted persistence: the SQLite collection lives in memory and is written to
// disk as compressed, AES-256-GCM sealed snapshots. Media files are sealed too,
// and stored under HMAC-derived names so filenames don't leak.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { seal, open, subkey, hmac } from "./aead";

const DB_AAD = "collection-snapshot-v1";

export class MediaStore {
  private encKey: Uint8Array;
  private nameKey: Uint8Array;
  constructor(
    private dir: string,
    dek: Uint8Array,
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.encKey = subkey(dek, "media-content");
    this.nameKey = subkey(dek, "media-names");
  }
  private diskName(fname: string): string {
    return Buffer.from(hmac(this.nameKey, fname.normalize("NFC"))).toString("hex").slice(0, 48) + ".bin";
  }
  has(fname: string): boolean {
    return existsSync(join(this.dir, this.diskName(fname)));
  }
  read(fname: string): Uint8Array | null {
    const p = join(this.dir, this.diskName(fname));
    if (!existsSync(p)) return null;
    return open(this.encKey, new Uint8Array(readFileSync(p)), `media:${fname.normalize("NFC")}`);
  }
  write(fname: string, data: Uint8Array) {
    const p = join(this.dir, this.diskName(fname));
    writeFileSync(p + ".tmp", seal(this.encKey, data, `media:${fname.normalize("NFC")}`), { mode: 0o600 });
    renameSync(p + ".tmp", p);
  }
  delete(fname: string) {
    const p = join(this.dir, this.diskName(fname));
    if (existsSync(p)) unlinkSync(p);
  }
  /** Number of encrypted blobs on disk (names are opaque by design). */
  diskCount(): number {
    return existsSync(this.dir) ? readdirSync(this.dir).filter((f) => f.endsWith(".bin")).length : 0;
  }
}

export class EncryptedStore {
  readonly dbPath: string;
  readonly mediaDir: string;
  readonly backupDir: string;
  private dbKey: Uint8Array;
  private lastChanges = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  media: MediaStore;

  constructor(
    readonly root: string,
    dek: Uint8Array,
  ) {
    for (const d of [root, join(root, "media"), join(root, "backups")]) if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 });
    this.dbPath = join(root, "collection.enc");
    this.mediaDir = join(root, "media");
    this.backupDir = join(root, "backups");
    this.dbKey = subkey(dek, "collection");
    this.media = new MediaStore(this.mediaDir, dek);
  }

  loadDatabase(): Database {
    if (!existsSync(this.dbPath)) return new Database(":memory:", { strict: true });
    let bytes: Uint8Array;
    try {
      bytes = open(this.dbKey, new Uint8Array(readFileSync(this.dbPath)), DB_AAD);
    } catch (e) {
      // fall back to the previous snapshot if the latest write was interrupted
      if (existsSync(this.dbPath + ".prev")) bytes = open(this.dbKey, new Uint8Array(readFileSync(this.dbPath + ".prev")), DB_AAD);
      else throw e;
    }
    const raw = new Uint8Array(Bun.zstdDecompressSync(bytes));
    return Database.deserialize(raw, { strict: true } as never);
  }

  snapshot(db: Database): Uint8Array {
    const raw = db.serialize();
    return seal(this.dbKey, new Uint8Array(Bun.zstdCompressSync(raw, { level: 3 })), DB_AAD);
  }

  /** Persist if the database changed since the last flush. */
  flush(db: Database, force = false) {
    const changes = db.query<{ n: number }, []>("SELECT total_changes() n").get()!.n;
    if (!force && changes === this.lastChanges) return false;
    const blob = this.snapshot(db);
    writeFileSync(this.dbPath + ".tmp", blob, { mode: 0o600 });
    if (existsSync(this.dbPath)) renameSync(this.dbPath, this.dbPath + ".prev");
    renameSync(this.dbPath + ".tmp", this.dbPath);
    this.lastChanges = changes;
    return true;
  }

  startAutoFlush(db: Database, everyMs = 1500) {
    this.stopAutoFlush();
    this.timer = setInterval(() => {
      try {
        this.flush(db);
      } catch (e) {
        console.error("encrypted flush failed", e);
      }
    }, everyMs);
  }
  stopAutoFlush() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  backup(db: Database, keep: number): string {
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const p = join(this.backupDir, `collection-${stamp}.enc`);
    writeFileSync(p, this.snapshot(db), { mode: 0o600 });
    const files = readdirSync(this.backupDir).filter((f) => f.endsWith(".enc")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(this.backupDir, f));
    return p;
  }

  listBackups() {
    return readdirSync(this.backupDir)
      .filter((f) => f.endsWith(".enc"))
      .sort()
      .reverse()
      .map((f) => ({ name: f, size: statSync(join(this.backupDir, f)).size }));
  }

  /** Decrypt a backup into a fresh in-memory database (for restore). */
  openBackup(name: string): Database {
    if (!/^[\w.\-]+\.enc$/.test(name)) throw new Error("Invalid backup name");
    const bytes = open(this.dbKey, new Uint8Array(readFileSync(join(this.backupDir, name))), DB_AAD);
    return Database.deserialize(new Uint8Array(Bun.zstdDecompressSync(bytes)), { strict: true } as never);
  }
}
