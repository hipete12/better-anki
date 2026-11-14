// Better Anki server entry point.
//   BA_DATA      data directory (default ./data)
//   BA_PORT      port (default 8765)
//   BA_HOST      bind address (default 0.0.0.0 so Tailscale peers can connect)
//   BA_TLS_CERT  / BA_TLS_KEY  PEM files to serve HTTPS (e.g. from `tailscale cert`)
//   BA_WEB       path to the built web app served at / (default ../web/dist)
//
// Security model (see docs/SECURITY.md): everything at rest is AES-256-GCM
// encrypted with a data key that only exists in memory after a password login
// or a request from an authorised device unlocks the server.
import { Collection } from "./collection";
import { buildRoutes, VERSION } from "./api/routes";
import type { Router } from "./api/router";
import { HttpError } from "./util";
import { KeyManager } from "./crypto/auth";
import { backup } from "./maintenance";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join, resolve, normalize, extname } from "node:path";
import { networkInterfaces } from "node:os";

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".bmp": "image/bmp", ".avif": "image/avif", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".opus": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".mp4": "video/mp4",
  ".webm": "video/webm", ".ogv": "video/ogg", ".mov": "video/quicktime", ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff",
  ".woff2": "font/woff2", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".pdf": "application/pdf",
};

export interface ServerConfig {
  data: string;
  port: number;
  host: string;
  web: string | null;
  tls?: { cert: string; key: string } | null;
  quiet?: boolean;
}

export function createServer(cfg: ServerConfig) {
  const keys = new KeyManager(cfg.data);
  let col: Collection | null = null;
  let router: Router | null = null;

  const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  let pending = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcast = (kind: string) => {
    pending.add(kind);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      const msg = enc.encode(`event: change\ndata: ${JSON.stringify({ kinds: [...pending], at: Date.now() })}\n\n`);
      pending = new Set();
      flushTimer = null;
      for (const c of sseClients) {
        try {
          c.enqueue(msg);
        } catch {
          sseClients.delete(c);
        }
      }
    }, 150);
  };

  // Opening the collection happens the moment the data key becomes available.
  keys.onUnlock = (dek) => {
    col = new Collection(cfg.data, dek);
    col.onChange((e) => broadcast(e.kind));
    router = buildRoutes(col, { mediaToken: (sid) => keys.mediaToken(sid) });
    try {
      backup(col);
    } catch {}
    if (!cfg.quiet) console.log("Collection unlocked.");
  };

  const cors: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
  };
  const security: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "cross-origin",
    ...(cfg.tls ? { "strict-transport-security": "max-age=31536000" } : {}),
  };
  const baseHeaders = { ...cors, ...security };
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...baseHeaders } });

  const bearer = (req: Request) => {
    const h = req.headers.get("authorization");
    return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
  };

  const server = Bun.serve({
    port: cfg.port,
    hostname: cfg.host,
    maxRequestBodySize: 1024 * 1024 * 1024,
    idleTimeout: 255,
    ...(cfg.tls ? { tls: { cert: readFileSync(cfg.tls.cert, "utf8"), key: readFileSync(cfg.tls.key, "utf8") } } : {}),
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
      const path = url.pathname;
      const ip = srv.requestIP(req)?.address ?? "unknown";
      const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";

      // media: /media/<signed-token>/<file>  (decrypted on the fly, never cached)
      if (path.startsWith("/media/")) {
        const rest = path.slice("/media/".length);
        const slash = rest.indexOf("/");
        const tok = decodeURIComponent(rest.slice(0, slash));
        const fname = decodeURIComponent(rest.slice(slash + 1));
        if (!col || !keys.verifyMediaToken(tok)) return new Response("Unauthorized", { status: 401, headers: baseHeaders });
        if (!fname || fname.includes("/") || fname.includes("\\")) return new Response("Bad request", { status: 400, headers: baseHeaders });
        const data = col.media.read(fname);
        if (!data) return new Response("Not found", { status: 404, headers: baseHeaders });
        return new Response(data, { headers: { ...baseHeaders, "content-type": MIME[extname(fname).toLowerCase()] ?? "application/octet-stream", "cache-control": "private, no-store" } });
      }

      if (path.startsWith("/api/")) {
        try {
          // ---- unauthenticated endpoints ----
          if (path === "/api/health")
            return json({ ok: true, name: "Better Anki", version: VERSION, setupRequired: keys.setupRequired, locked: keys.locked, setupNeedsCode: !loopback, tls: !!cfg.tls });
          if (path === "/api/auth/setup" && req.method === "POST") {
            const b = (await req.json()) as Record<string, any>;
            const token = keys.setup(String(b.username ?? "owner"), String(b.password ?? ""), String(b.device ?? ""), ip, b.setupCode ?? null, loopback);
            return json({ token, username: keys.username });
          }
          if (path === "/api/auth/login" && req.method === "POST") {
            const b = (await req.json()) as Record<string, any>;
            const token = keys.login(String(b.username ?? ""), String(b.password ?? ""), String(b.device ?? ""), ip);
            return json({ token, username: keys.username });
          }

          // ---- everything else requires a device session ----
          const session = keys.authenticate(bearer(req), ip);
          if (path === "/api/auth/me") return json({ username: keys.username, session });
          if (path === "/api/auth/sessions" && req.method === "GET") return json(keys.sessions(session));
          if (path.startsWith("/api/auth/sessions/") && req.method === "DELETE") {
            keys.revoke(decodeURIComponent(path.slice("/api/auth/sessions/".length)));
            return json({ ok: true });
          }
          if (path === "/api/auth/logout" && req.method === "POST") {
            keys.revoke(session);
            return json({ ok: true });
          }
          if (path === "/api/auth/password" && req.method === "POST") {
            const b = (await req.json()) as Record<string, any>;
            keys.changePassword(String(b.oldPassword ?? ""), String(b.newPassword ?? ""));
            if (b.signOutOthers) keys.revokeAllExcept(session);
            return json({ ok: true });
          }
          if (path === "/api/events") {
            let ctrl: ReadableStreamDefaultController<Uint8Array>;
            const stream = new ReadableStream<Uint8Array>({
              start(c) {
                ctrl = c;
                sseClients.add(c);
                c.enqueue(enc.encode(`retry: 3000\nevent: hello\ndata: {}\n\n`));
              },
              cancel() {
                sseClients.delete(ctrl);
              },
            });
            return new Response(stream, { headers: { ...baseHeaders, "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
          }
          if (!router) throw new HttpError(423, "Collection is locked");
          const m = router.match(req.method, path);
          if (!m) return json({ error: "Not found" }, 404);
          let bodyCache: unknown;
          const result = await m.handler({
            req,
            url,
            params: m.params,
            query: url.searchParams,
            session,
            json: async () => {
              if (bodyCache === undefined) {
                const t = await req.text();
                bodyCache = t ? JSON.parse(t) : {};
              }
              return bodyCache as any;
            },
          });
          if (result instanceof Response) {
            for (const [k, v] of Object.entries(baseHeaders)) result.headers.set(k, v);
            if (!result.headers.has("cache-control")) result.headers.set("cache-control", "no-store");
            return result;
          }
          return json(result ?? { ok: true });
        } catch (e) {
          if (e instanceof HttpError) return json({ error: e.message }, e.status);
          if (e instanceof SyntaxError) return json({ error: `Invalid request: ${e.message}` }, 400);
          console.error(`[${req.method} ${path}]`, e);
          return json({ error: (e as Error).message || "Internal error" }, 500);
        }
      }

      // static web app (contains no user data)
      if (cfg.web && existsSync(cfg.web)) {
        const p = normalize(join(cfg.web, decodeURIComponent(path)));
        const webHeaders = { ...security, "content-security-policy": WEB_CSP };
        if (p.startsWith(cfg.web) && existsSync(p) && statSync(p).isFile()) {
          const cache = p.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
          return new Response(Bun.file(p), { headers: { ...webHeaders, "cache-control": cache } });
        }
        const index = join(cfg.web, "index.html");
        if (existsSync(index)) return new Response(Bun.file(index), { headers: { ...webHeaders, "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
      }
      return new Response(`Better Anki server ${VERSION} is running. Build the web app (cd web && bun run build) to serve it here.`, { headers: { "content-type": "text/plain", ...security } });
    },
  });

  const keepAlive = setInterval(() => {
    for (const c of sseClients) {
      try {
        c.enqueue(enc.encode(`: ping\n\n`));
      } catch {
        sseClients.delete(c);
      }
    }
  }, 20000);
  const backupTimer = setInterval(() => {
    if (col)
      try {
        backup(col);
      } catch (e) {
        console.error("backup failed", e);
      }
  }, 24 * 3600 * 1000);

  return {
    server,
    keys,
    get col() {
      return col;
    },
    stop() {
      clearInterval(keepAlive);
      clearInterval(backupTimer);
      server.stop(true);
      col?.close();
    },
  };
}

// Card pages run inside sandboxed iframes (no same-origin access to the app's
// storage), so inline scripts are allowed there; everything else stays tight.
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https: http:",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' data: blob: https: http:",
  "connect-src 'self' https: http:",
  "frame-src 'self' blob: data: about:",
  "object-src 'none'",
  "base-uri 'self' https: http:",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

if (import.meta.main) {
  const DATA = resolve(process.env.BA_DATA ?? join(import.meta.dir, "..", "data"));
  const tlsCert = process.env.BA_TLS_CERT;
  const tlsKey = process.env.BA_TLS_KEY;
  const s = createServer({
    data: DATA,
    port: Number(process.env.BA_PORT ?? 8765),
    host: process.env.BA_HOST ?? "0.0.0.0",
    web: resolve(process.env.BA_WEB ?? join(import.meta.dir, "..", "..", "web", "dist")),
    tls: tlsCert && tlsKey ? { cert: tlsCert, key: tlsKey } : null,
  });
  const proto = tlsCert ? "https" : "http";
  const port = s.server.port;
  const addrs = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a!.address);
  console.log(`Better Anki server v${VERSION}`);
  console.log(`  data:    ${DATA}  (AES-256-GCM encrypted at rest)`);
  console.log(`  local:   ${proto}://localhost:${port}`);
  for (const a of addrs) console.log(`  network: ${proto}://${a}:${port}${a.startsWith("100.") ? "   (tailscale, WireGuard-encrypted)" : ""}`);
  if (s.keys.setupRequired) console.log(`\n  First run: open the app and create your account.\n  Setup code for remote devices: ${s.keys.setupCode}\n`);
  else console.log(`  status:  locked until you sign in from any device`);
  const shutdown = () => {
    s.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
