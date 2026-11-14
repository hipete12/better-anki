import { useCallback, useEffect, useRef, useState, createContext, useContext } from "react";

/** Live-change bus fed by the server event stream. */
type Listener = (kinds: string[]) => void;
const listeners = new Set<Listener>();
export function emitChange(kinds: string[]) {
  for (const l of listeners) l(kinds);
}
export function useServerChanges(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const l: Listener = (k) => ref.current(k);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
}

/** Fetch data, refetching when the server reports relevant changes. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { live?: boolean | string[] } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await fn();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e as Error);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useServerChanges((kinds) => {
    if (!opts.live) return;
    if (Array.isArray(opts.live) && !kinds.some((k) => (opts.live as string[]).includes(k))) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, 250);
  });
  return { data, error, loading, reload: load, setData };
}

export function useLocalStorage<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : init;
    } catch {
      return init;
    }
  });
  const set = useCallback(
    (nv: T) => {
      setV(nv);
      try {
        localStorage.setItem(key, JSON.stringify(nv));
      } catch {}
    },
    [key],
  );
  return [v, set];
}

export type Theme = "light" | "dark" | "system";
export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("ba.theme", t);
  } catch {}
}
export function isDark() {
  return document.documentElement.classList.contains("dark");
}
export function useIsDark() {
  const [d, setD] = useState(isDark());
  useEffect(() => {
    const obs = new MutationObserver(() => setD(isDark()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return d;
}

export interface Session {
  server: string;
  username: string | null;
  logout: () => Promise<void>;
}
export const SessionCtx = createContext<Session>(null!);
export const useSession = () => useContext(SessionCtx);

export function useKey(handler: (e: KeyboardEvent) => void, deps: unknown[] = []) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      handler(e);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
