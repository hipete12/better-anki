import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface CardFrameHandle {
  getTyped(): Promise<string | null>;
  replay(): void;
  focusType(): void;
}

/**
 * Renders a server-built card page in a sandboxed iframe. The sandbox omits
 * allow-same-origin, so deck templates/scripts can never read this app's
 * storage, cookies or credentials.
 */
const CardFrame = forwardRef<CardFrameHandle, { html: string; onKey?: (e: { key: string; code: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }) => void; onMessage?: (type: string, data: unknown) => void; className?: string }>(function CardFrame({ html, onKey, onMessage, className }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<number, (v: string | null) => void>());
  const handlers = useRef({ onKey, onMessage });
  handlers.current = { onKey, onMessage };

  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data;
      if (!d || !d.__ba) return;
      if (d.type === "key") handlers.current.onKey?.(d);
      else if (d.type === "typed") {
        const r = pending.current.get(d.req);
        pending.current.delete(d.req);
        r?.(d.value ?? null);
      } else if (d.type === "openLink" && typeof d.url === "string" && /^https?:/i.test(d.url)) window.open(d.url, "_blank", "noopener,noreferrer");
      else handlers.current.onMessage?.(d.type, d.data);
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, []);

  useImperativeHandle(ref, () => ({
    getTyped() {
      return new Promise((resolve) => {
        const req = Math.random();
        pending.current.set(req, resolve);
        frame.current?.contentWindow?.postMessage({ __baCmd: "getTyped", req }, "*");
        setTimeout(() => {
          if (pending.current.has(req)) {
            pending.current.delete(req);
            resolve(null);
          }
        }, 800);
      });
    },
    replay() {
      frame.current?.contentWindow?.postMessage({ __baCmd: "replay" }, "*");
    },
    focusType() {
      frame.current?.contentWindow?.postMessage({ __baCmd: "focusType" }, "*");
    },
  }));

  return <iframe ref={frame} title="Card" srcDoc={html} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" allow="autoplay" className={className ?? "w-full h-full border-0 bg-transparent"} />;
});

export default CardFrame;
