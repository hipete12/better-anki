// Typed client for the Better Anki server API.
import { clearCredentials, type Credentials } from "./secureStore";

export interface Counts {
  new: number;
  learn: number;
  review: number;
}
export interface DeckNode {
  id: number;
  name: string;
  shortName: string;
  kind: 0 | 1;
  collapsed: boolean;
  configId: number;
  counts: Counts;
  total: number;
  color: string | null;
  emoji: string | null;
  children: DeckNode[];
}
export interface HomeSummary {
  today: Today;
  streak: number;
  longestStreak: number;
  daysStudied: number;
  last14: { day: number; date: string; count: number }[];
  next7: { day: number; date: string; count: number }[];
  /** Cards per state at the end of each of the last 90 days (suspended cards left out). */
  trend: { day: number; date: string; learning: number; young: number; mature: number }[];
  retention30: number | null;
  retentionCount: number;
  cards: { total: number; new: number; learning: number; young: number; mature: number; suspended: number };
  notes: number;
}
export interface Today {
  cards: number;
  timeMs: number;
  again: number;
  learn: number;
  review: number;
  relearn: number;
  filtered: number;
  mature: number;
  matureCorrect: number;
}
export interface FieldDef {
  name: string;
  ord: number;
  sticky?: boolean;
  rtl?: boolean;
  font?: string;
  size?: number;
  description?: string;
  plainText?: boolean;
  collapsed?: boolean;
  excludeFromSearch?: boolean;
  origOrd?: number | null;
}
export interface TemplateDef {
  name: string;
  ord: number;
  qfmt: string;
  afmt: string;
  bqfmt?: string;
  bafmt?: string;
  targetDeckId?: number;
  origOrd?: number | null;
}
export interface Notetype {
  id: number;
  name: string;
  kind: 0 | 1;
  css: string;
  sortIdx: number;
  fields: FieldDef[];
  templates: TemplateDef[];
  latexPre: string;
  latexPost: string;
  mtime: number;
  noteCount?: number;
}
export interface DeckConfig {
  id: number;
  name: string;
  mtime: number;
  useCount?: number;
  newPerDay: number;
  reviewsPerDay: number;
  newIgnoreReviewLimit: boolean;
  learnSteps: number[];
  graduatingIvl: number;
  easyIvl: number;
  initialEase: number;
  newInsertOrder: number;
  newGatherPriority: number;
  newSortOrder: number;
  newMix: number;
  interdayLearningMix: number;
  reviewOrder: number;
  relearnSteps: number[];
  minLapseIvl: number;
  lapseMult: number;
  leechThreshold: number;
  leechAction: number;
  maxIvl: number;
  easyMult: number;
  hardMult: number;
  ivlMult: number;
  buryNew: boolean;
  buryReviews: boolean;
  buryInterday: boolean;
  showTimer: boolean;
  capAnswerSecs: number;
  disableAutoplay: boolean;
  skipQuestionWhenReplayingAnswer: boolean;
  autoAdvanceQuestionSecs: number;
  autoAdvanceAnswerSecs: number;
  autoAdvanceAnswerAction: number;
  desiredRetention: number;
  fsrsParams: number[];
  historicalRetention: number;
  ignoreRevlogsBefore: string;
  easyDays: number[];
}
export interface CollectionConfig {
  rolloverHour: number;
  learnAheadMins: number;
  timeboxMins: number;
  fsrs: boolean;
  loadBalancer: boolean;
  currentDeckId: number;
  lastNotetypeId: number;
  lastDeckId: number;
  showIntervalsOnButtons: boolean;
  showRemainingCount: boolean;
  backupKeep: number;
}
export interface StudyCard {
  id: number;
  nid: number;
  did: number;
  ord: number;
  type: number;
  queue: number;
  flags: number;
  marked: boolean;
  tags: string[];
  ntid: number;
  deckName: string;
  queueName: "new" | "learn" | "review";
  question: string;
  answer: string;
  hasTypeAnswer: boolean;
  buttons: { ease: number; label: string; secs: number }[];
  options: {
    showTimer: boolean;
    capAnswerSecs: number;
    autoplay: boolean;
    skipQuestionWhenReplayingAnswer: boolean;
    autoAdvanceQuestionSecs: number;
    autoAdvanceAnswerSecs: number;
    autoAdvanceAnswerAction: number;
  };
}
export interface StudyState {
  deck: { id: number; name: string; kind: number; color: string | null; emoji: string | null };
  counts: Counts;
  nextLearnDue: number | null;
  buried: number;
  undo: { label: string | null; available: boolean };
  today: Today;
  timeboxMins: number;
  card: StudyCard | null;
  answered?: { cardId: number; leech: boolean; suspended: boolean };
  undone?: string | null;
}
export interface BrowseRow {
  id: number;
  nid: number;
  /** Position in the order the deck came with (per home deck; notes mode numbers notes). */
  order: number;
  sortField: string;
  question: string;
  answer: string;
  deck: string;
  notetype: string;
  template: string;
  due: string;
  ivl: string;
  ease: string;
  difficulty: string;
  stability: string;
  reps: number;
  lapses: number;
  created: string;
  modified: string;
  tags: string[];
  flags: number;
  /** One state per card; see cardState() on the server. */
  state: CardState;
  /** Display order layout the card uses ("Default" unless it was moved to a layout). */
  layout: string;
  queue: number;
  type: number;
  marked: boolean;
  cards: number;
}
export type CardState = "new" | "learning" | "review" | "due" | "suspended" | "buried" | "marked" | "leech";
export interface NoteData {
  id: number;
  guid: string;
  notetypeId: number;
  notetype: Notetype;
  fields: string[];
  tags: string[];
  mtime: number;
  cards: { id: number; ord: number; did: number; deck: string; template: string; queue: number; type: number }[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let creds: Credentials | null = null;
let onUnauthorized: (() => void) | null = null;

export function setCredentials(c: Credentials | null) {
  creds = c;
}
export function getCredentials() {
  return creds;
}
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export function normalizeServer(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
}

/** Is traffic to this server encrypted in transit (TLS, loopback or Tailscale/WireGuard)? */
export function transportSecurity(server: string): { secure: boolean; reason: string } {
  try {
    const u = new URL(server);
    if (u.protocol === "https:") return { secure: true, reason: "TLS" };
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return { secure: true, reason: "Local loopback" };
    if (/\.ts\.net$/.test(h)) return { secure: true, reason: "Tailscale (WireGuard)" };
    const m = /^100\.(\d+)\./.exec(h);
    if (m && +m[1] >= 64 && +m[1] <= 127) return { secure: true, reason: "Tailscale (WireGuard)" };
    return { secure: false, reason: "Unencrypted HTTP" };
  } catch {
    return { secure: false, reason: "Invalid URL" };
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { server?: string; token?: string | null; raw?: boolean } = {}): Promise<T> {
  const server = opts.server ?? creds?.server ?? "";
  const token = opts.token === undefined ? creds?.token : opts.token;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(server + path, { method, headers, body: payload, cache: "no-store", referrerPolicy: "no-referrer" });
  } catch {
    throw new ApiError(0, `Can't reach the server at ${server || location.origin}`);
  }
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith("/api/auth/login")) {
      await clearCredentials();
      onUnauthorized?.();
    }
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>("GET", p),
  post: <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}),
  del: <T>(p: string) => request<T>("DELETE", p),
  raw: (method: string, p: string, b?: unknown) => request<Response>(method, p, b, { raw: true }),
  health: (server: string) => request<{ ok: boolean; name: string; version: string; setupRequired: boolean; locked: boolean; setupNeedsCode: boolean; tls: boolean }>("GET", "/api/health", undefined, { server, token: null }),
  login: (server: string, username: string, password: string, device: string) =>
    request<{ token: string; username: string }>("POST", "/api/auth/login", { username, password, device }, { server, token: null }),
  setup: (server: string, username: string, password: string, device: string, setupCode?: string) =>
    request<{ token: string; username: string }>("POST", "/api/auth/setup", { username, password, device, setupCode }, { server, token: null }),
};

/** Download a binary endpoint (auth header can't be put on a plain link). */
export async function download(path: string, fallbackName: string) {
  const res = await api.raw("GET", path);
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? "Download failed");
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Live change notifications over an authenticated streaming fetch (no token in URLs). */
export function subscribeEvents(onChange: (kinds: string[]) => void): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  const run = async () => {
    while (!stopped) {
      try {
        ctrl = new AbortController();
        const res = await fetch((creds?.server ?? "") + "/api/events", { headers: { authorization: `Bearer ${creds?.token}` }, signal: ctrl.signal, cache: "no-store" });
        if (!res.ok || !res.body) throw new Error("events");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const ev = /event: (\w+)/.exec(chunk)?.[1];
            const data = /data: (.*)/.exec(chunk)?.[1];
            if (ev === "change" && data) {
              try {
                onChange(JSON.parse(data).kinds ?? []);
              } catch {}
            }
          }
        }
      } catch {}
      if (!stopped) await new Promise((r) => setTimeout(r, 3000));
    }
  };
  run();
  return () => {
    stopped = true;
    ctrl?.abort();
  };
}

export const fmt = {
  duration(ms: number) {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    return `${(m / 60).toFixed(1)} h`;
  },
  ivl(days: number) {
    if (days < 1) return `${Math.round(days * 24)}h`;
    if (days < 30) return `${Math.round(days)}d`;
    if (days < 365) return `${(days / 30.4).toFixed(1)}mo`;
    return `${(days / 365).toFixed(1)}y`;
  },
  date(ms: number) {
    return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  },
  datetime(ms: number) {
    return new Date(ms).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  },
};
