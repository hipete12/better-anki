import { useState } from "react";
import { Table2, LineChart as LineChartIcon } from "lucide-react";
import type { HomeSummary } from "../lib/api";
import { IconButton } from "./ui";
import { LineChart, type Series } from "./charts";

const TREND_SERIES: Series[] = [
  { key: "learning", label: "Learning", color: "var(--series-1)" },
  { key: "young", label: "Young", color: "var(--series-2)" },
  { key: "mature", label: "Mature", color: "var(--series-3)" },
];

/** How many cards are learning, young and mature each day (new cards left out); hidden until something is studied. */
export default function CardTrend({ trend, className }: { trend: HomeSummary["trend"]; className?: string }) {
  const [showTable, setShowTable] = useState(false);
  const first = trend.findIndex((d) => d.learning + d.young + d.mature > 0);
  if (first < 0) return null; // nothing studied yet
  // start just before the first studied card, but show at least two weeks
  const days = trend.slice(Math.max(0, Math.min(first - 1, trend.length - 14)));
  const data = days.map((d) => ({ learning: d.learning, young: d.young, mature: d.mature }));
  const last = data[data.length - 1];
  const label = (i: number) => (i === days.length - 1 ? "Today" : new Date(days[i].date).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric" }));
  return (
    <section className={className} aria-label="Cards by state">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-2">
        {TREND_SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs">
            <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            <span className="text-muted">{s.label}</span>
            <span className="text-sm font-semibold tnum">{last[s.key as keyof typeof last].toLocaleString()}</span>
          </span>
        ))}
        <IconButton label={showTable ? "Show chart" : "Show data as table"} onClick={() => setShowTable(!showTable)} className="ml-auto size-7">
          {showTable ? <LineChartIcon className="size-4" /> : <Table2 className="size-4" />}
        </IconButton>
      </div>
      {showTable ? (
        <div className="max-h-56 overflow-auto rounded-lg border border-app">
          <table className="w-full text-xs tnum">
            <thead className="bg-panel-2 sticky top-0">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Day</th>
                {TREND_SERIES.map((s) => (
                  <th key={s.key} className="px-3 py-1.5 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data
                .map((d, i) => (
                  <tr key={i} className="border-t border-app">
                    <td className="px-3 py-1">{label(i)}</td>
                    <td className="px-3 py-1 text-right">{d.learning.toLocaleString()}</td>
                    <td className="px-3 py-1 text-right">{d.young.toLocaleString()}</td>
                    <td className="px-3 py-1 text-right">{d.mature.toLocaleString()}</td>
                  </tr>
                ))
                .reverse()}
            </tbody>
          </table>
        </div>
      ) : (
        <LineChart data={data} series={TREND_SERIES} xLabel={label} ariaLabel={`Cards by state over the last ${days.length} days. Today: ${last.learning} learning, ${last.young} young, ${last.mature} mature.`} />
      )}
    </section>
  );
}
