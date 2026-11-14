// Accounts, device sessions and key custody.
//
// A random 256-bit data-encryption key (DEK) encrypts everything at rest. It is
// never stored in the clear: auth.json only holds copies of the DEK wrapped by
//   - a key derived from the owner's password (scrypt), and
//   - one key per device session, derived (HKDF) from that session's token.
// After a restart the server is *locked*; the first password login or request
// carrying a valid device token unwraps the DEK into memory.
// Tokens are only stored as SHA-256 hashes.
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { seal, open, subkey, passwordKey, newScryptParams, sha256Hex, randomToken, randomKey, hmac, safeEqual, b64, DecryptError, type ScryptParams } from "./aead";
import { HttpError } from "../util";

interface UserRecord {
  idHash: string; // sha256 of the lower-cased username
  kdf: ScryptParams;
  wrappedDek: string; // base64 sealed DEK
  meta: string; // sealed {username, created}
}

interface SessionRecord {
  id: string;
  tokenHash: string;
  wrappedDek: string;
  meta: string; // sealed SessionMeta
}

interface SessionMeta {
  device: string;
  created: number;
  lastSeen: number;
  lastIp: string;
}

interface AuthFile {
  version: 1;
  users: UserRecord[];
  sessions: SessionRecord[];
}

export interface SessionInfo {
  id: string;
  device: string;
  created: number;
  lastSeen: number;
  lastIp: string;
  current?: boolean;
}

const DEK_AAD_PW = "dek-wrap/password";
const DEK_AAD_SESSION = "dek-wrap/session";
const MEDIA_TOKEN_TTL = 12 * 3600;

export class KeyManager {
  private path: string;
  private data: AuthFile;
  private dek: Uint8Array | null = null;
  private failures = new Map<string, { count: number; until: number }>();
  readonly setupCode: string;
  onUnlock: ((dek: Uint8Array) => void) | null = null;

  constructor(private root: string) {
    this.path = join(root, "auth.json");
    this.data = existsSync(this.path) ? JSON.parse(readFileSync(this.path, "utf8")) : { version: 1, users: [], sessions: [] };
    this.setupCode = randomToken(6).replace(/[-_]/g, "x").slice(0, 8).toUpperCase();
  }

  get setupRequired() {
    return this.data.users.length === 0;
  }
  get locked() {
    return this.dek === null;
  }
  get username(): string | null {
    const u = this.data.users[0];
    if (!u || !this.dek) return null;
    return this.readMeta<{ username: string }>(u.meta)?.username ?? null;
  }

  private sealMeta(obj: unknown): string {
    return b64.enc(seal(subkey(this.dek!, "auth-meta"), new TextEncoder().encode(JSON.stringify(obj)), "auth-meta"));
  }
  private readMeta<T>(blob: string): T | null {
    if (!this.dek) return null;
    try {
      return JSON.parse(new TextDecoder().decode(open(subkey(this.dek, "auth-meta"), b64.dec(blob), "auth-meta"))) as T;
    } catch {
      return null;
    }
  }
  private userIdHash(username: string) {
    return sha256Hex("user:" + username.trim().toLowerCase());
  }

  private save() {
    writeFileSync(this.path + ".tmp", JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(this.path + ".tmp", this.path);
  }

  private unlockWith(dek: Uint8Array) {
    if (this.dek) return;
    this.dek = dek;
    this.onUnlock?.(dek);
  }

  private checkRate(ip: string) {
    const f = this.failures.get(ip);
    if (f && f.until > Date.now()) throw new HttpError(429, `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 1000)}s.`);
  }
  private fail(ip: string) {
    const f = this.failures.get(ip) ?? { count: 0, until: 0 };
    f.count++;
    if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60_000, 2000 * 2 ** (f.count - 5));
    this.failures.set(ip, f);
  }

  private newSession(dek: Uint8Array, device: string, ip: string): string {
    const token = randomToken(32);
    this.unlockWith(dek);
    const meta: SessionMeta = { device: (device || "Unknown device").slice(0, 80), created: Date.now(), lastSeen: Date.now(), lastIp: ip };
    const s: SessionRecord = {
      id: randomToken(9),
      tokenHash: sha256Hex(token),
      wrappedDek: b64.enc(seal(subkey(new TextEncoder().encode(token), "session-kek"), dek, DEK_AAD_SESSION)),
      meta: this.sealMeta(meta),
    };
    this.data.sessions.push(s);
    this.save();
    return token;
  }

  /** First-run: create the owner account and the collection key. */
  setup(username: string, password: string, device: string, ip: string, code: string | null, isLoopback: boolean): string {
    if (!this.setupRequired) throw new HttpError(409, "Server is already set up");
    if (!isLoopback && (!code || !safeEqual(code.trim().toUpperCase(), this.setupCode))) {
      this.fail(ip);
      throw new HttpError(403, "Invalid setup code (shown in the server console)");
    }
    validatePassword(password);
    const dek = randomKey();
    const kdf = newScryptParams();
    const name = username.trim() || "owner";
    this.unlockWith(dek);
    this.data.users.push({
      idHash: this.userIdHash(name),
      kdf,
      wrappedDek: b64.enc(seal(passwordKey(password, kdf), dek, DEK_AAD_PW)),
      meta: this.sealMeta({ username: name, created: Date.now() }),
    });
    return this.newSession(dek, device, ip);
  }

  login(username: string, password: string, device: string, ip: string): string {
    this.checkRate(ip);
    const idh = this.userIdHash(username);
    const u = this.data.users.find((x) => safeEqual(x.idHash, idh));
    let dek: Uint8Array | null = null;
    if (u) {
      try {
        dek = open(passwordKey(password, u.kdf), b64.dec(u.wrappedDek), DEK_AAD_PW);
      } catch (e) {
        if (!(e instanceof DecryptError)) throw e;
      }
    } else passwordKey(password, newScryptParams()); // equalise timing
    if (!dek) {
      this.fail(ip);
      throw new HttpError(401, "Wrong username or password");
    }
    this.failures.delete(ip);
    return this.newSession(dek, device, ip);
  }

  /** Validate a bearer token; unlocks the server if needed. Returns the session id. */
  authenticate(token: string | null, ip: string): string {
    if (!token) throw new HttpError(401, "Not signed in");
    this.checkRate(ip);
    const h = sha256Hex(token);
    const s = this.data.sessions.find((x) => safeEqual(x.tokenHash, h));
    if (!s) {
      this.fail(ip);
      throw new HttpError(401, "Session expired or revoked. Please sign in again.");
    }
    if (!this.dek) {
      const dek = open(subkey(new TextEncoder().encode(token), "session-kek"), b64.dec(s.wrappedDek), DEK_AAD_SESSION);
      this.unlockWith(dek);
    }
    const now = Date.now();
    const meta = this.readMeta<SessionMeta>(s.meta);
    if (meta && (now - meta.lastSeen > 60_000 || meta.lastIp !== ip)) {
      s.meta = this.sealMeta({ ...meta, lastSeen: now, lastIp: ip });
      this.save();
    }
    return s.id;
  }

  sessions(currentId?: string): SessionInfo[] {
    return this.data.sessions.map((s) => {
      const m = this.readMeta<SessionMeta>(s.meta) ?? { device: "?", created: 0, lastSeen: 0, lastIp: "" };
      return { id: s.id, ...m, current: s.id === currentId };
    });
  }

  revoke(id: string) {
    this.data.sessions = this.data.sessions.filter((s) => s.id !== id);
    this.save();
  }

  revokeAllExcept(id: string) {
    this.data.sessions = this.data.sessions.filter((s) => s.id === id);
    this.save();
  }

  changePassword(oldPassword: string, newPassword: string) {
    const u = this.data.users[0];
    if (!u) throw new HttpError(400, "No account");
    let dek: Uint8Array;
    try {
      dek = open(passwordKey(oldPassword, u.kdf), b64.dec(u.wrappedDek), DEK_AAD_PW);
    } catch {
      throw new HttpError(401, "Current password is wrong");
    }
    validatePassword(newPassword);
    u.kdf = newScryptParams();
    u.wrappedDek = b64.enc(seal(passwordKey(newPassword, u.kdf), dek, DEK_AAD_PW));
    this.save();
  }

  // ----- short-lived signed media URLs (no bearer tokens in URLs) -----
  mediaToken(sessionId: string): string {
    if (!this.dek) throw new HttpError(423, "Locked");
    const exp = Math.floor(Date.now() / 1000) + MEDIA_TOKEN_TTL;
    const body = `${sessionId}.${exp}`;
    const sig = Buffer.from(hmac(subkey(this.dek, "media-url"), body)).toString("base64url").slice(0, 32);
    return `${body}.${sig}`;
  }

  verifyMediaToken(tok: string): boolean {
    if (!this.dek) return false;
    const parts = tok.split(".");
    if (parts.length !== 3) return false;
    const [sid, expS, sig] = parts;
    if (Number(expS) < Date.now() / 1000) return false;
    if (!this.data.sessions.some((s) => s.id === sid)) return false;
    const expect = Buffer.from(hmac(subkey(this.dek, "media-url"), `${sid}.${expS}`)).toString("base64url").slice(0, 32);
    return safeEqual(sig, expect);
  }
}

export function validatePassword(pw: string) {
  if (typeof pw !== "string" || pw.length < 8) throw new HttpError(400, "Password must be at least 8 characters");
}
