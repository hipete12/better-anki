import { HttpError } from "../util";

export type Params = Record<string, string>;
export interface Ctx {
  req: Request;
  url: URL;
  params: Params;
  query: URLSearchParams;
  /** Authenticated device-session id. */
  session: string;
  json<T = any>(): Promise<T>;
}
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  routes: Route[] = [];
  add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(
      "^" +
        path.replace(/\/:([a-zA-Z_]+)(\*)?/g, (_m, k: string, star: string) => {
          keys.push(k);
          return star ? "/(.+)" : "/([^/]+)";
        }) +
        "/?$",
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p: string, h: Handler) {
    return this.add("GET", p, h);
  }
  post(p: string, h: Handler) {
    return this.add("POST", p, h);
  }
  put(p: string, h: Handler) {
    return this.add("PUT", p, h);
  }
  patch(p: string, h: Handler) {
    return this.add("PATCH", p, h);
  }
  delete(p: string, h: Handler) {
    return this.add("DELETE", p, h);
  }

  match(method: string, pathname: string): { handler: Handler; params: Params } | null {
    for (const r of this.routes) {
      if (r.method !== method && !(method === "HEAD" && r.method === "GET")) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params: Params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return null;
  }
}

export function num(v: string | null | undefined, def?: number): number {
  if (v === null || v === undefined || v === "") {
    if (def === undefined) throw new HttpError(400, "Missing numeric parameter");
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `Invalid number: ${v}`);
  return n;
}
