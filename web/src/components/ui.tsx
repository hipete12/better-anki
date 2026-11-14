import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, CheckCircle2, AlertTriangle, Info } from "lucide-react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-700 shadow-sm shadow-brand-600/25",
  secondary: "panel text-app hover:bg-panel-2",
  ghost: "text-app hover:bg-panel-2",
  danger: "bg-red-600 text-white hover:bg-red-500",
  subtle: "bg-brand-500/10 text-brand-600 dark:text-brand-300 hover:bg-brand-500/20",
};

export function Button({ variant = "secondary", size = "md", loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap focus-visible:outline-2 focus-visible:outline-brand-500 outline-offset-2",
        size === "sm" ? "h-8 px-3 text-sm" : size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function IconButton({ className, label, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...rest} aria-label={label} title={label} className={cx("inline-flex size-9 items-center justify-center rounded-xl text-muted hover:text-app hover:bg-panel-2 transition-colors disabled:opacity-40", className)}>
      {children}
    </button>
  );
}

export const inputCls = "w-full h-10 rounded-xl px-3 text-sm bg-panel border border-app text-app placeholder:text-muted/70 focus:outline-none focus:border-brand-500 focus:ring-3 focus:ring-brand-500/20 transition";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "h-auto py-2 font-mono text-[13px] leading-relaxed", props.className)} />;
}
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx(/\bw-/.test(className ?? "") ? inputCls.replace("w-full ", "") : inputCls, "pr-9 appearance-none", className)}
      style={{
        backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
        backgroundSize: "16px 16px",
      }}
    >
      {children}
    </select>
  );
}

export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("flex items-start gap-3 cursor-pointer select-none", disabled && "opacity-50 pointer-events-none")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-brand-600" : "bg-zinc-300 dark:bg-zinc-700")}
      >
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {(label || hint) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium">{label}</span>}
          {hint && <span className="block text-xs text-muted mt-0.5">{hint}</span>}
        </span>
      )}
    </label>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted mt-1">{hint}</span>}
    </label>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx("panel rounded-2xl", className)}>
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("animate-spin text-brand-500", className ?? "size-6")} />;
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center gap-3 text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function Badge({ children, color = "zinc", className }: { children: ReactNode; color?: "zinc" | "blue" | "red" | "green" | "amber" | "brand"; className?: string }) {
  const c = {
    zinc: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    blue: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
    red: "bg-red-500/12 text-red-600 dark:text-red-300",
    green: "bg-green-500/12 text-green-700 dark:text-green-300",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    brand: "bg-brand-500/12 text-brand-600 dark:text-brand-300",
  }[color];
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", c, className)}>{children}</span>;
}

export function Modal({ open, onClose, title, children, footer, wide, className }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean | "xl"; className?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] pointer-events-none" />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "relative w-full panel rounded-t-2xl sm:rounded-2xl shadow-2xl animate-pop flex flex-col max-h-[92vh]",
          wide === "xl" ? "sm:max-w-5xl" : wide ? "sm:max-w-2xl" : "sm:max-w-md",
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-3 border-b border-app">
            <h2 className="text-base font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <X className="size-5" />
            </IconButton>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-app">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- dropdown menu ----------
export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  divider?: boolean;
}
export function Menu({ trigger, items, align = "right" }: { trigger: (open: () => void) => ReactNode; items: MenuItem[]; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      {trigger(() => setOpen((o) => !o))}
      {open && (
        <div className={cx("absolute z-40 mt-1 min-w-52 panel rounded-xl shadow-xl py-1.5 animate-pop", align === "right" ? "right-0" : "left-0")}>
          {items.map((it, i) =>
            it.divider ? (
              <div key={i} className="my-1.5 h-px bg-[var(--border)]" />
            ) : (
              <button
                key={i}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
                className={cx("flex w-full items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-panel-2 disabled:opacity-40", it.danger ? "text-red-600 dark:text-red-400" : "text-app")}
              >
                <span className="size-4 shrink-0 text-muted [&>svg]:size-4">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.shortcut && <kbd className="text-[11px] text-muted font-mono">{it.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ---------- toasts ----------
type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  text: ReactNode;
  action?: { label: string; onClick: () => void };
}
const ToastCtx = createContext<(text: ReactNode, kind?: ToastKind, action?: Toast["action"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: ReactNode, kind: ToastKind = "info", action?: Toast["action"]) => {
    const id = Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="fixed z-[60] bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 w-[min(92vw,420px)] pointer-events-none">
          {toasts.map((t) => (
            <div key={t.id} className="pointer-events-auto w-full panel rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 text-sm animate-pop">
              {t.kind === "success" ? <CheckCircle2 className="size-5 text-green-500 shrink-0" /> : t.kind === "error" ? <AlertTriangle className="size-5 text-red-500 shrink-0" /> : <Info className="size-5 text-brand-500 shrink-0" />}
              <span className="flex-1">{t.text}</span>
              {t.action && (
                <button className="font-semibold text-brand-600 dark:text-brand-300" onClick={t.action.onClick}>
                  {t.action.label}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

// ---------- promise-based dialogs ----------
type DialogReq =
  | { type: "confirm"; title: string; body?: ReactNode; confirm?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { type: "prompt"; title: string; label?: string; value?: string; placeholder?: string; confirm?: string; resolve: (v: string | null) => void };
const DialogCtx = createContext<{ confirm: (o: Omit<Extract<DialogReq, { type: "confirm" }>, "type" | "resolve">) => Promise<boolean>; prompt: (o: Omit<Extract<DialogReq, { type: "prompt" }>, "type" | "resolve">) => Promise<string | null> }>(null!);
export const useDialogs = () => useContext(DialogCtx);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<DialogReq | null>(null);
  const [value, setValue] = useState("");
  const confirm = useCallback((o: any) => new Promise<boolean>((resolve) => setReq({ type: "confirm", ...o, resolve })), []);
  const prompt = useCallback(
    (o: any) =>
      new Promise<string | null>((resolve) => {
        setValue(o.value ?? "");
        setReq({ type: "prompt", ...o, resolve });
      }),
    [],
  );
  const close = (v: any) => {
    (req?.resolve as (x: any) => void)?.(v);
    setReq(null);
  };
  return (
    <DialogCtx.Provider value={{ confirm, prompt }}>
      {children}
      <Modal
        open={!!req}
        onClose={() => close(req?.type === "confirm" ? false : null)}
        title={req?.title}
        footer={
          <>
            <Button variant="ghost" onClick={() => close(req?.type === "confirm" ? false : null)}>
              Cancel
            </Button>
            <Button variant={req?.type === "confirm" && req.danger ? "danger" : "primary"} onClick={() => close(req?.type === "confirm" ? true : value)}>
              {req?.confirm ?? "OK"}
            </Button>
          </>
        }
      >
        {req?.type === "confirm" && <div className="text-sm text-muted">{req.body}</div>}
        {req?.type === "prompt" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              close(value);
            }}
          >
            {req.label && <div className="text-sm mb-2">{req.label}</div>}
            <Input autoFocus value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} />
          </form>
        )}
      </Modal>
    </DialogCtx.Provider>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      {icon && <div className="mb-4 size-14 rounded-2xl bg-brand-500/10 text-brand-500 flex items-center justify-center [&>svg]:size-7">{icon}</div>}
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <div className="mt-2 text-sm text-muted max-w-sm">{children}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={cx("inline-flex rounded-xl bg-panel-2 p-1 gap-1", className)}>
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)} className={cx("px-3 h-8 rounded-lg text-sm font-medium transition", value === t.value ? "bg-panel shadow-sm text-app" : "text-muted hover:text-app")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
