// Small dependency-free SVG charts following the data-viz rules: thin marks,
// 4px rounded data-ends, 2px surface gaps, recessive grid, hover tooltips,
// legends for >= 2 series, and a table view for every chart.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";
import { Card, cx } from "./ui";

export interface Series {
  key: string;
  label: string;
  color: string; // css var
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}
const compact = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}K` : n.toLocaleString());

export function ChartCard({ title, subtitle, legend, children, table }: { title: string; subtitle?: ReactNode; legend?: Series[]; children: ReactNode; table?: { head: string[]; rows: (string | number)[][] } }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        {table && (
          <button onClick={() => setShowTable(!showTable)} className={cx("shrink-0 rounded-lg p-1.5 text-muted hover:text-app hover:bg-panel-2", showTable && "bg-panel-2 text-app")} title="Show data as table" aria-label="Show data as table">
            <Table2 className="size-4" />
          </button>
        )}
      </div>
      {legend && (
        <div className="mb-3">
          <Legend series={legend} />
        </div>
      )}
      {showTable && table ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-app">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-panel-2 sticky top-0">
              <tr>
                {table.head.map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-app">
                  {r.map((c, j) => (
                    <td key={j} className="px-2 py-1">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

/** Stacked column chart with per-column hover tooltip. */
export function ColumnChart({ data, series, xLabel, height = 200, formatX }: { data: Record<string, number>[]; series: Series[]; xLabel: (d: Record<string, number>, i: number) => string; height?: number; formatX?: (d: Record<string, number>, i: number) => string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const W = 640;
  const H = height;
  const pad = { l: 36, r: 8, t: 8, b: 22 };
  const totals = data.map((d) => series.reduce((a, s) => a + (d[s.key] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const n = Math.max(1, data.length);
  const band = (W - pad.l - pad.r) / n;
  const bw = Math.min(24, Math.max(1.5, band - 2));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(n / 8);
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">
              {compact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + band * i + (band - bw) / 2;
          let acc = 0;
          const segs = series.filter((s) => (d[s.key] ?? 0) > 0);
          return (
            <g key={i}>
              {segs.map((s, si) => {
                const v = d[s.key];
                const y0 = y(acc);
                const y1 = y(acc + v);
                acc += v;
                const top = si === segs.length - 1;
                const h = Math.max(0, y0 - y1 - (si > 0 ? 2 : 0)); // 2px surface gap between segments
                const r = top ? Math.min(4, bw / 2, h) : 0;
                const yy = y1;
                return <path key={s.key} d={roundedTop(x, yy, bw, h, r)} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
              })}
              {(i % labelEvery === 0 || i === n - 1) && (formatX ? formatX(d, i) : true) && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                  {formatX ? formatX(d, i) : xLabel(d, i)}
                </text>
              )}
              <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1} />
      </svg>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute z-10 panel rounded-lg shadow-lg px-3 py-2 text-xs min-w-32" style={{ left: `clamp(0px, ${((pad.l + band * hover + band / 2) / W) * 100}% - 64px, calc(100% - 140px))`, top: 0 }}>
          <div className="font-semibold mb-1">{xLabel(data[hover], hover)}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="size-2 rounded-sm" style={{ background: s.color }} />
              <span className="text-muted flex-1">{s.label}</span>
              <span className="tabular-nums font-medium">{(data[hover][s.key] ?? 0).toLocaleString()}</span>
            </div>
          ))}
          {series.length > 1 && (
            <div className="flex justify-between border-t border-app mt-1 pt-1">
              <span className="text-muted">Total</span>
              <span className="tabular-nums font-semibold">{totals[hover].toLocaleString()}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Round up to a clean axis maximum (at least 2) whose halfway tick is a whole number. */
function niceMaxEven(v: number): number {
  if (v <= 2) return 2;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [1, 2, 4, 5, 6, 8, 10].find((s) => v <= s * p && Number.isInteger((s * p) / 2))!;
  return step * p;
}

/** Width of an element in CSS pixels, so SVG text renders at its real size on any screen. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Multi-series line chart on one y-axis: 2px lines, ringed end dots, names at the line ends
 * when they don't collide, and a crosshair tooltip (pointer, touch, or arrow keys when focused).
 */
export function LineChart({ data, series, height = 140, xLabel, ariaLabel }: { data: Record<string, number>[]; series: Series[]; height?: number; xLabel: (i: number) => string; ariaLabel: string }) {
  const [ref, W] = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const n = data.length;
  const max = niceMaxEven(Math.max(0, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0))));
  const ticks = [0, max / 2, max];
  const yLabelW = Math.max(...ticks.map((t) => compact(t).length)) * 7 + 12;
  const y0 = (v: number) => 8 + (H - 8 - 24) * (1 - v / max);
  // names at the line ends, unless two would overlap (then the legend and tooltip carry identity)
  const ends = series.map((s) => ({ s, y: y0(data[n - 1]?.[s.key] ?? 0) })).sort((a, b) => a.y - b.y);
  const endLabels = W >= 360 && ends.every((e, i) => i === 0 || e.y - ends[i - 1].y >= 13);
  const pad = { l: yLabelW, r: endLabels ? Math.max(...series.map((s) => s.label.length)) * 6.5 + 16 : 8 };
  const plotW = Math.max(1, W - pad.l - pad.r);
  const x = (i: number) => pad.l + (n > 1 ? (plotW * i) / (n - 1) : plotW);
  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left - pad.l) / plotW) * (n - 1)))));
  };
  const xTicks = n > 1 ? [0, Math.floor((n - 1) / 2), n - 1] : [0];
  if (!n) return null;
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onFocus={() => setHover(n - 1)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            setHover((h) => Math.max(0, Math.min(n - 1, (h ?? n - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
          }
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y0(t)} y2={y0(t)} stroke={t === 0 ? "var(--border)" : "var(--grid)"} strokeWidth={1} />
            <text x={pad.l - 8} y={y0(t) + 3.5} textAnchor="end" fontSize={11} fill="var(--muted)" className="tnum">
              {compact(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i, k) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={k === 0 ? "start" : k === xTicks.length - 1 ? "end" : "middle"} fontSize={11} fill="var(--muted)">
            {xLabel(i)}
          </text>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={8} y2={H - 24} stroke="var(--border-strong)" strokeWidth={1} />}
        {series.map((s) => (
          <path key={s.key} d={data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y0(d[s.key] ?? 0).toFixed(1)}`).join("")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const i = hover ?? n - 1;
          return <circle key={s.key} cx={x(i)} cy={y0(data[i][s.key] ?? 0)} r={4} fill={s.color} stroke="var(--bg)" strokeWidth={2} />;
        })}
        {endLabels &&
          ends.map(({ s, y }) => (
            <text key={s.key} x={x(n - 1) + 10} y={y + 4} fontSize={11} fill="var(--muted)">
              {s.label}
            </text>
          ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute z-10 panel rounded-lg shadow-lg px-3 py-2 text-xs min-w-32" style={{ left: Math.max(0, Math.min(W - 140, x(hover) + (x(hover) > W / 2 ? -152 : 12))), top: 0 }}>
          <div className="font-semibold mb-1">{xLabel(hover)}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="h-0.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="text-muted flex-1">{s.label}</span>
              <span className="tabular-nums font-semibold">{(data[hover][s.key] ?? 0).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Calendar heatmap (sequential, one hue). */
export function Heatmap({ days }: { days: { day: number; date: string; count: number }[] }) {
  const [hover, setHover] = useState<{ x: number; y: number; d: (typeof days)[number] } | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const levels = ["var(--seq-0)", "var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)"];
  const level = (c: number) => (c === 0 ? 0 : Math.min(4, 1 + Math.floor((c / max) * 3.999)));
  const first = new Date(days[0]?.date ?? Date.now());
  const offset = (first.getUTCDay() + 6) % 7;
  const cell = 11,
    gap = 2;
  const weeks = Math.ceil((days.length + offset) / 7);
  const W = weeks * (cell + gap) + 24;
  const H = 7 * (cell + gap) + 16;
  const months = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    let last = -1;
    days.forEach((d, i) => {
      const dt = new Date(d.date);
      if (dt.getUTCDate() <= 7 && dt.getUTCMonth() !== last && (i + offset) % 7 === 0) {
        last = dt.getUTCMonth();
        out.push({ x: 24 + Math.floor((i + offset) / 7) * (cell + gap), label: dt.toLocaleString(undefined, { month: "short", timeZone: "UTC" }) });
      }
    });
    return out;
  }, [days, offset]);
  return (
    <div className="relative overflow-x-auto" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W * 0.9 }} className="w-full h-auto">
        {months.map((m) => (
          <text key={m.x} x={m.x} y={9} fontSize={9} fill="var(--muted)">
            {m.label}
          </text>
        ))}
        {["Mon", "", "Wed", "", "Fri", "", ""].map((l, i) => (
          <text key={i} x={0} y={16 + i * (cell + gap) + 9} fontSize={8} fill="var(--muted)">
            {l}
          </text>
        ))}
        {days.map((d, i) => {
          const k = i + offset;
          const x = 24 + Math.floor(k / 7) * (cell + gap);
          const yy = 16 + (k % 7) * (cell + gap);
          return <rect key={i} x={x} y={yy} width={cell} height={cell} rx={2.5} fill={levels[level(d.count)]} onMouseEnter={() => setHover({ x: (x / W) * 100, y: yy, d })} />;
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 panel rounded-lg shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap" style={{ left: `clamp(0px, calc(${hover.x}% - 50px), calc(100% - 130px))`, top: -6 }}>
          <span className="font-semibold">{hover.d.count} reviews</span> <span className="text-muted">· {new Date(hover.d.date).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })}</span>
        </div>
      )}
      <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-muted">
        Less
        {levels.map((l) => (
          <span key={l} className="size-2.5 rounded-[3px]" style={{ background: l }} />
        ))}
        More
      </div>
    </div>
  );
}

/** One whole split into parts (no baseline). */
export function SegmentedBar({ parts, height = 12 }: { parts: { label: string; value: number; color: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div>
      <div className="flex gap-[2px] rounded-full overflow-hidden" style={{ height }}>
        {parts.map((p, i) =>
          p.value > 0 ? <div key={p.label} title={`${p.label}: ${p.value.toLocaleString()} (${((p.value / total) * 100).toFixed(1)}%)`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ width: `${(p.value / total) * 100}%`, background: p.color, opacity: hover === null || hover === i ? 1 : 0.5 }} /> : null,
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 mt-3 text-xs">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm shrink-0" style={{ background: p.color }} />
            <span className="text-muted truncate">{p.label}</span>
            <span className="ml-auto tabular-nums font-medium">{p.value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
