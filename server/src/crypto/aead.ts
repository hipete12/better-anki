// Authenticated encryption primitives (AES-256-GCM, HKDF-SHA256, scrypt).
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync, scryptSync, createHmac, createHash, timingSafeEqual } from "node:crypto";

const MAGIC = new Uint8Array([0x42, 0x41, 0x45, 0x31]); // "BAE1"
const IV_LEN = 12;
const TAG_LEN = 16;

export class DecryptError extends Error {}

/** Encrypt: MAGIC | iv | tag | ciphertext. `aad` binds the blob to its purpose. */
export function seal(key: Uint8Array, plaintext: Uint8Array, aad = ""): Uint8Array {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv("aes-256-gcm", key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const tag = c.getAuthTag();
  const out = new Uint8Array(MAGIC.length + IV_LEN + TAG_LEN + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, 4);
  out.set(tag, 4 + IV_LEN);
  out.set(ct, 4 + IV_LEN + TAG_LEN);
  return out;
}

export function open(key: Uint8Array, blob: Uint8Array, aad = ""): Uint8Array {
  if (blob.length < 4 + IV_LEN + TAG_LEN || !MAGIC.every((b, i) => blob[i] === b)) throw new DecryptError("Not an encrypted Better Anki blob");
  const iv = blob.subarray(4, 4 + IV_LEN);
  const tag = blob.subarray(4 + IV_LEN, 4 + IV_LEN + TAG_LEN);
  const ct = blob.subarray(4 + IV_LEN + TAG_LEN);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  try {
    return new Uint8Array(Buffer.concat([d.update(ct), d.final()]));
  } catch {
    throw new DecryptError("Decryption failed (wrong key or tampered data)");
  }
}

export function isSealed(blob: Uint8Array): boolean {
  return blob.length >= 4 && MAGIC.every((b, i) => blob[i] === b);
}

/** Derive a purpose-specific subkey from a master key. */
export function subkey(master: Uint8Array, purpose: string, len = 32): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", master, new Uint8Array(0), `better-anki/${purpose}`, len));
}

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  salt: string; // base64
}

export function newScryptParams(): ScryptParams {
  return { N: 1 << 15, r: 8, p: 1, salt: randomBytes(16).toString("base64") };
}

/** Password -> key-encryption key (memory-hard). */
export function passwordKey(password: string, prm: ScryptParams): Uint8Array {
  return new Uint8Array(scryptSync(password.normalize("NFKC"), Buffer.from(prm.salt, "base64"), 32, { N: prm.N, r: prm.r, p: prm.p, maxmem: 256 * 1024 * 1024 }));
}

export function hmac(key: Uint8Array, data: string): Uint8Array {
  return new Uint8Array(createHmac("sha256", key).update(data).digest());
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function randomKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const b64 = {
  enc: (u: Uint8Array) => Buffer.from(u).toString("base64"),
  dec: (s: string) => new Uint8Array(Buffer.from(s, "base64")),
};
