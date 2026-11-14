// Shared helpers: ids, time/day math, html utilities, hashing.

let lastId = 0;
/** Millisecond-timestamp ids, guaranteed unique & increasing within this process. */
export function newId(): number {
  let id = Date.now();
  if (id <= lastId) id = lastId + 1;
  lastId = id;
  return id;
}

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** Local UTC offset (seconds east of UTC) for a given timestamp. */
export function localOffsetSecs(tsSecs: number): number {
  return -new Date(tsSecs * 1000).getTimezoneOffset() * 60;
}

/**
 * Absolute "study day" number for a timestamp: days since the Unix epoch in
 * local time, where each day starts at `rolloverHour` (Anki's "next day starts at").
 */
export function dayNumber(tsSecs: number, rolloverHour: number): number {
  return Math.floor((tsSecs + localOffsetSecs(tsSecs) - rolloverHour * 3600) / 86400);
}

/** Timestamp (secs) at which the given study day ends (= the next rollover). */
export function dayEndSecs(day: number, rolloverHour: number): number {
  // approximate using current offset; good enough for rollover purposes
  const approx = (day + 1) * 86400 + rolloverHour * 3600;
  return approx - localOffsetSecs(approx);
}

const GUID_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
export function newGuid(): string {
  let n = BigInt(Math.floor(Math.random() * 2 ** 53)) * 2048n + BigInt(Math.floor(Math.random() * 2048));
  let s = "";
  const base = BigInt(GUID_CHARS.length);
  while (n > 0n) {
    s = GUID_CHARS[Number(n % base)] + s;
    n /= base;
  }
  return s || "a";
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[m] ?? m;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Strip HTML tags (and media references), decode entities. */
export function stripHtml(s: string): string {
  return decodeEntities(
    s
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, " ")
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

export function stripHtmlPreservingMedia(s: string): string {
  return stripHtml(s.replace(/<img[^>]*src=["']?([^"' >]+)["']?[^>]*>/gi, " $1 "));
}

/** Anki-compatible note checksum: first 8 hex digits of sha1 of stripped first field, as int. */
export function fieldChecksum(field: string): number {
  const h = new Bun.CryptoHasher("sha1").update(stripHtmlPreservingMedia(field)).digest("hex");
  return parseInt(h.slice(0, 8), 16);
}

export function sha1Hex(data: Uint8Array | string): string {
  return new Bun.CryptoHasher("sha1").update(data).digest("hex");
}

/** Deterministic pseudo-random in [0,1) seeded by integers. */
export function seededRandom(...seeds: number[]): number {
  let h = 2166136261 >>> 0;
  for (const s of seeds) {
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
  }
  // xorshift finish
  h ^= h << 13;
  h >>>= 0;
  h ^= h >>> 17;
  h ^= h << 5;
  h >>>= 0;
  return h / 4294967296;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function splitFields(flds: string): string[] {
  return flds.split("\x1f");
}
export function joinFields(fields: string[]): string {
  return fields.join("\x1f");
}

export function parseTags(tags: string): string[] {
  return tags.split(/\s+/).filter(Boolean);
}
export function joinTags(tags: string[]): string {
  const uniq = [...new Map(tags.filter(Boolean).map((t) => [t.toLowerCase(), t])).values()];
  return uniq.length ? ` ${uniq.join(" ")} ` : "";
}

export function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(seed, i) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function assert(cond: unknown, msg: string, status = 400): asserts cond {
  if (!cond) throw new HttpError(status, msg);
}

/** Human friendly interval label like Anki: "10m", "1d", "3.2mo". */
export function intervalLabel(secs: number): string {
  const m = secs / 60;
  if (secs < 60) return `${Math.max(1, Math.round(secs))}s`;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${+(h).toFixed(h < 10 ? 1 : 0)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30.4375;
  if (mo < 12) return `${+mo.toFixed(1)}mo`;
  return `${+(d / 365.25).toFixed(1)}y`;
}
