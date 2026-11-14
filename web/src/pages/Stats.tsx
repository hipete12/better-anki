import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, fmt, type Today } from "../lib/api";
import { Stat } from "../components/visual";
import { useApi } from "../lib/hooks";
import { Card, Loading, PageHeader, Select, Tabs } from "../components/ui";
import { ChartCard, ColumnChart, Heatmap, SegmentedBar, type Series } from "../components/charts";

type Hist = { from: number; to: number; count: number }[];
interface Stats {
  today: Today;
  counts: Record<string, number>;
  history: { day: number; learn: number; young: number; mature: number; relearn: number; filtered: number; timeMs: number }[];
  heatmap: { day: number; date: string; count: number }[];
  streak: number;
  longestStreak: number;
  daysStudied: number;
  forecast: { day: number; young: number; mature: number; learn: number }[];
  dueTomorrow: number;
  overdue: number;
  intervals: Hist;
  avgInterval: number;
  maxInterval: number;
  eases: Hist;
  avgEase: number | null;
  difficulty: Hist;
  stability: Hist;
  retrievability: Hist;
  avgRetention: number | null;
  hours: { total: number; correct: number }[];
  buttons: { learning: number[]; young: number[]; mature: number[] };
  added: { day: number; count: number }[];
  retention: { label: string; young: number | null; mature: number | null; total: number | null; count: number }[];
  summary: { totalReviews: number; totalTimeMs: number; avgPerDay: number; avgSecsPerCard: number };
  fsrs: boolean;
}

const S = (i: number) => `var(--series-${i})`;
const REVIEW_SERIES: Series[] = [
  { key: "learn", label: "Learning", color: S(1) },
  { key: "young", label: "Young", color: S(2) },
  { key: "mature", label: "Mature", color: S(3) },
  { key: "relearn", label: "Relearning", color: S(4) },
  { key: "filtered", label: "Filtered", color: S(5) },
];
const FORECAST_SERIES: Series[] = [
  { key: "learn", label: "Learning", color: S(1) },
  { key: "young", label: "Young", color: S(2) },
  { key: "mature", label: "Mature", color: S(3) },
];
const ONE: Series[] = [{ key: "count", label: "Cards", color: S(1) }];

const dayLabel = (d: number) => (d === 0 ? "Today" : d === -1 ? "Yesterday" : d === 1 ? "Tomorrow" : d < 0 ? `${-d} days ago` : `In ${d} days`);
const pct = (v: number | null) => (v == null ? "–" : `${v.toFixed(1)}%`);

function histLabel(h: { from: number; to: number }, unit = "d") {
  if (!isFinite(h.to)) return `${h.from}${unit}+`;
  if (h.to - h.from <= 1) return `${h.from}${unit}`;
  return `${h.from}–${h.to - 1}${unit}`;
}

export default function StatsPage() {
  const [params] = useSearchParams();
  const [deck, setDeck] = useState<string>(params.get("deck") ?? "");
  const [days, setDays] = useState("30");
  const decks = useApi(() => api.get<{ id: number; name: string }[]>("/api/decks/list"), []);
  const { data } = useApi(() => api.get<Stats>(`/api/stats?days=${days}${deck ? `&deck=${deck}` : ""}`), [deck, days], { live: ["review", "undo", "import"] });

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10">
      <PageHeader
        title="Statistics"
        actions={
          <>
            <Select value={deck} onChange={(e) => setDeck(e.target.value)} className="w-56">
              <option value="">Whole collection</option>
              {decks.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Tabs
              value={days}
              onChange={setDays}
              tabs={[
                { value: "30", label: "1 month" },
                { value: "90", label: "3 months" },
                { value: "365", label: "1 year" },
              ]}
            />
          </>
        }
      />
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 pb-4">
            <Stat value={data.today.cards} label={`studied today · ${fmt.duration(data.today.timeMs)}`} valueClass={data.today.cards ? "text-brand-600 dark:text-brand-400" : "text-faint"} />
            <Stat value={data.dueTomorrow} label={data.overdue ? `due tomorrow · ${data.overdue} overdue` : "due tomorrow"} />
            <Stat value={`${data.streak}d`} label={`streak · best ${data.longestStreak}d`} valueClass={data.streak ? "text-orange-600 dark:text-orange-400" : "text-faint"} />
            <Stat value={data.fsrs ? pct(data.avgRetention) : data.avgEase ? `${Math.round(data.avgEase)}%` : "–"} label={`${data.fsrs ? "avg. retrievability" : "avg. ease"} · ${fmt.ivl(data.avgInterval)} interval`} valueClass="text-due" />
          </div>

          <ChartCard title="Calendar" subtitle="Reviews per day over the last year">
            <Heatmap days={data.heatmap} />
          </ChartCard>

          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard
              title="Reviews"
              subtitle={`${data.summary.totalReviews.toLocaleString()} reviews · ${data.summary.avgPerDay.toFixed(1)}/day · ${fmt.duration(data.summary.totalTimeMs)} · ${data.summary.avgSecsPerCard.toFixed(1)}s per card`}
              legend={REVIEW_SERIES}
              table={{ head: ["Day", ...REVIEW_SERIES.map((s) => s.label), "Time"], rows: data.history.filter((h) => h.learn + h.young + h.mature + h.relearn + h.filtered).map((h) => [dayLabel(h.day), h.learn, h.young, h.mature, h.relearn, h.filtered, fmt.duration(h.timeMs)]) }}
            >
              <ColumnChart data={data.history} series={REVIEW_SERIES} xLabel={(d) => dayLabel(d.day)} formatX={(d) => (d.day === 0 ? "Today" : `${d.day}d`)} />
            </ChartCard>
            <ChartCard title="Future due" subtitle={`Cards due in the coming ${data.forecast.length - 1} days`} legend={FORECAST_SERIES} table={{ head: ["Day", "Learning", "Young", "Mature"], rows: data.forecast.filter((f) => f.young + f.mature + f.learn).map((f) => [dayLabel(f.day), f.learn, f.young, f.mature]) }}>
              <ColumnChart data={data.forecast} series={FORECAST_SERIES} xLabel={(d) => dayLabel(d.day)} formatX={(d) => (d.day === 0 ? "Today" : `+${d.day}d`)} />
            </ChartCard>
          </div>

          <Card className="p-5">
            <h3 className="font-semibold mb-3">Card counts</h3>
            <SegmentedBar
              parts={[
                { label: "New", value: data.counts.new, color: S(1) },
                { label: "Learning", value: data.counts.learning, color: S(2) },
                { label: "Relearning", value: data.counts.relearning, color: S(3) },
                { label: "Young", value: data.counts.young, color: S(4) },
                { label: "Mature", value: data.counts.mature, color: S(5) },
                { label: "Suspended", value: data.counts.suspended, color: S(6) },
                { label: "Buried", value: data.counts.buried, color: S(7) },
              ]}
            />
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Review intervals" subtitle={`Average ${fmt.ivl(data.avgInterval)} · longest ${fmt.ivl(data.maxInterval)}`} table={{ head: ["Interval", "Cards"], rows: data.intervals.map((h) => [histLabel(h), h.count]) }}>
              <ColumnChart data={data.intervals.map((h) => ({ count: h.count }))} series={ONE} xLabel={(_, i) => histLabel(data.intervals[i])} />
            </ChartCard>
            {data.fsrs ? (
              <ChartCard title="Card difficulty" subtitle="FSRS difficulty, 0% easiest" table={{ head: ["Difficulty", "Cards"], rows: data.difficulty.map((h) => [histLabel(h, "%"), h.count]) }}>
                <ColumnChart data={data.difficulty.map((h) => ({ count: h.count }))} series={ONE} xLabel={(_, i) => histLabel(data.difficulty[i], "%")} />
              </ChartCard>
            ) : (
              <ChartCard title="Card ease" subtitle={data.avgEase ? `Average ${Math.round(data.avgEase)}%` : undefined} table={{ head: ["Ease", "Cards"], rows: data.eases.map((h) => [histLabel(h, "%"), h.count]) }}>
                <ColumnChart data={data.eases.map((h) => ({ count: h.count }))} series={ONE} xLabel={(_, i) => histLabel(data.eases[i], "%")} />
              </ChartCard>
            )}
            {data.fsrs && (
              <>
                <ChartCard title="Card stability" subtitle="Days until recall probability drops to 90%" table={{ head: ["Stability", "Cards"], rows: data.stability.map((h) => [histLabel(h), h.count]) }}>
                  <ColumnChart data={data.stability.map((h) => ({ count: h.count }))} series={ONE} xLabel={(_, i) => histLabel(data.stability[i])} />
                </ChartCard>
                <ChartCard title="Card retrievability" subtitle={`Estimated chance of recall today · average ${pct(data.avgRetention)}`} table={{ head: ["Retrievability", "Cards"], rows: data.retrievability.map((h) => [histLabel(h, "%"), h.count]) }}>
                  <ColumnChart data={data.retrievability.map((h) => ({ count: h.count }))} series={ONE} xLabel={(_, i) => histLabel(data.retrievability[i], "%")} />
                </ChartCard>
              </>
            )}
            <ChartCard title="Hourly breakdown" subtitle="Reviews by hour of day (hover for success rate)" table={{ head: ["Hour", "Reviews", "Correct"], rows: data.hours.map((h, i) => [`${i}:00`, h.total, h.total ? `${Math.round((h.correct / h.total) * 100)}%` : "–"]) }}>
              <ColumnChart data={data.hours.map((h) => ({ count: h.total, correct: h.correct }))} series={[{ key: "count", label: "Reviews", color: S(1) }]} xLabel={(d, i) => `${i}:00 · ${d.count ? Math.round((d.correct / d.count) * 100) : 0}% correct`} formatX={(_, i) => (i % 3 === 0 ? `${i}h` : null)} />
            </ChartCard>
            <ChartCard title="Cards added" subtitle={`${data.added.reduce((a, d) => a + d.count, 0)} cards in this period`} table={{ head: ["Day", "Added"], rows: data.added.filter((a) => a.count).map((a) => [dayLabel(a.day), a.count]) }}>
              <ColumnChart data={data.added} series={ONE} xLabel={(d) => dayLabel(d.day)} formatX={(d) => (d.day === 0 ? "Today" : `${d.day}d`)} />
            </ChartCard>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="p-5">
              <h3 className="font-semibold mb-3">Answer buttons</h3>
              <div className="space-y-4">
                {(["learning", "young", "mature"] as const).map((k) => {
                  const b = data.buttons[k];
                  const tot = b.reduce((a, x) => a + x, 0);
                  return (
                    <div key={k}>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="font-medium capitalize">{k}</span>
                        <span className="text-muted">{tot ? `${Math.round(((tot - b[0]) / tot) * 100)}% correct · ${tot} answers` : "no answers"}</span>
                      </div>
                      <SegmentedBar height={10} parts={["Again", "Hard", "Good", "Easy"].map((l, i) => ({ label: l, value: b[i], color: S(i + 1) }))} />
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold mb-1">True retention</h3>
              <p className="text-xs text-muted mb-3">Pass rate of review cards (young &lt; 21 days ≤ mature)</p>
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="text-left font-medium py-1">Period</th>
                    <th className="text-right font-medium">Young</th>
                    <th className="text-right font-medium">Mature</th>
                    <th className="text-right font-medium">Total</th>
                    <th className="text-right font-medium">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.retention.map((r) => (
                    <tr key={r.label} className="border-t border-app">
                      <td className="py-1.5">{r.label}</td>
                      <td className="text-right">{pct(r.young)}</td>
                      <td className="text-right">{pct(r.mature)}</td>
                      <td className="text-right font-semibold">{pct(r.total)}</td>
                      <td className="text-right text-muted">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

