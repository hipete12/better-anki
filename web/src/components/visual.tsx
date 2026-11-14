// Small display helpers from docs/DESIGN.md: hierarchy through numbers and color, not decoration.
import type { ReactNode } from "react";
import { cx } from "./ui";

/** A number with a small label underneath. Color carries meaning (e.g. text-new / text-learn / text-due). */
export function Stat({ value, label, className, valueClass, size = "md" }: { value: ReactNode; label: ReactNode; className?: string; valueClass?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className={cx("font-semibold tnum leading-none tracking-tight", size === "lg" ? "text-4xl" : size === "sm" ? "text-lg" : "text-2xl", valueClass)}>{value}</div>
      <div className="mt-1.5 text-xs text-muted truncate">{label}</div>
    </div>
  );
}

export interface Segment {
  value: number;
  className: string; // background class
  label: string;
}
/** Thin proportional bar (e.g. card maturity). */
export function SegmentedBar({ segments, height = 6, className }: { segments: Segment[]; height?: number; className?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className={cx("flex w-full gap-0.5 overflow-hidden rounded-full bg-panel-2", className)} style={{ height }} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
      {total > 0 && segments.filter((s) => s.value > 0).map((s, i) => <div key={i} className={cx("h-full", s.className)} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />)}
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; value?: ReactNode; className: string }[]; className?: string }) {
  return (
    <div className={cx("flex flex-wrap gap-x-4 gap-y-1 text-xs", className)}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={cx("size-2 rounded-full", it.className)} />
          <span className="text-muted">{it.label}</span>
          {it.value !== undefined && <span className="font-medium tnum">{it.value}</span>}
        </span>
      ))}
    </div>
  );
}
