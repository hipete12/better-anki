import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play } from "lucide-react";
import { api, type Counts, type Today, type HomeSummary } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Button, Loading, Badge } from "../components/ui";
import { Stat, SegmentedBar, Legend } from "../components/visual";
import CustomStudyDialog from "../components/CustomStudyDialog";
import FilteredDeckDialog from "../components/FilteredDeckDialog";
import ExportDialog from "../components/ExportDialog";
import CardTrend from "../components/CardTrend";

interface Overview {
  deck: { id: number; name: string; kind: 0 | 1; description: string; configId: number };
  counts: Counts;
  totals: { total: number; new: number; suspended: number; buried: number; young: number; mature: number; learning: number };
  limits: { newLeft: number; revLeft: number } | null;
  configName: string | null;
  buried: number;
  today: Today;
  trend: HomeSummary["trend"];
}

export default function DeckOverview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, reload } = useApi(() => api.get<Overview>(`/api/decks/${id}`), [id], { live: true });
  const [custom, setCustom] = useState(false);
  const [editFilter, setEditFilter] = useState(false);
  const [exp, setExp] = useState(false);
  if (!data) return <Loading />;
  const { deck, counts, totals } = data;
  const due = counts.new + counts.learn + counts.review;
  const parts = deck.name.split("::");
  const maturity = [
    { label: "New", value: totals.new, className: "bg-new" },
    { label: "Learning", value: totals.learning, className: "bg-learn" },
    { label: "Young", value: totals.young, className: "bg-green-400 dark:bg-green-600" },
    { label: "Mature", value: totals.mature, className: "bg-green-700 dark:bg-green-400" },
    { label: "Suspended", value: totals.suspended, className: "bg-amber-400" },
    { label: "Buried", value: totals.buried, className: "bg-zinc-400" },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <Link to="/" className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-app mb-5">
        <ArrowLeft className="size-3.5" /> Decks
      </Link>
      <div className="mb-8">
        {parts.length > 1 && <div className="text-[13px] text-muted mb-0.5">{parts.slice(0, -1).join(" / ")}</div>}
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold leading-tight">
          {parts[parts.length - 1]}
          {deck.kind === 1 && <Badge color="brand">Filtered</Badge>}
        </h1>
        <div className="mt-1 text-[13px] text-muted">
          {totals.total.toLocaleString()} cards{data.configName && ` · ${data.configName} preset`}
        </div>
      </div>

      <div className="grid gap-x-12 gap-y-8 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
        <div>
          <div className="flex items-end gap-10 mb-6">
            <Stat size="lg" value={counts.new} label="New" valueClass={counts.new ? "text-new" : "text-faint"} />
            <Stat size="lg" value={counts.learn} label="Learning" valueClass={counts.learn ? "text-learn" : "text-faint"} />
            <Stat size="lg" value={counts.review} label="To review" valueClass={counts.review ? "text-due" : "text-faint"} />
          </div>

          {due ? (
            <Button variant="primary" size="lg" className="w-full" onClick={() => navigate(`/study/${deck.id}`)}>
              <Play className="size-4" /> Study now
            </Button>
          ) : (
            <p className="w-0 min-w-full text-sm text-muted">
              Nothing due right now.
              {deck.kind === 0 && (
                <>
                  {" "}
                  <button className="text-brand-600 dark:text-brand-400 hover:underline" onClick={() => setCustom(true)}>
                    Start a custom study session
                  </button>
                </>
              )}
            </p>
          )}
          {data.limits && <p className="w-0 min-w-full mt-3 text-xs text-faint">{data.limits.newLeft} new and {data.limits.revLeft} reviews left today</p>}
        </div>
        {/* top lines up with the counts, bottom with the limits line */}
        <CardTrend trend={data.trend} chartHeight={118} className="md:-mt-2" />
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        {deck.kind === 0 ? (
          <>
            <Button size="sm" onClick={() => navigate(`/add?deck=${deck.id}`)}>Add cards</Button>
            <Button size="sm" onClick={() => setCustom(true)}>Custom study</Button>
            <Button size="sm" onClick={() => navigate(`/options/${deck.id}`)}>Options</Button>
          </>
        ) : (
          <>
            <Button size="sm" onClick={() => setEditFilter(true)}>Edit filter</Button>
            <Button size="sm" onClick={() => api.post(`/api/decks/${deck.id}/rebuild`).then(reload)}>Rebuild</Button>
            <Button size="sm" onClick={() => api.post(`/api/decks/${deck.id}/empty`).then(reload)}>Empty</Button>
          </>
        )}
        <Button size="sm" onClick={() => navigate(`/browse?q=${encodeURIComponent(`deck:"${deck.name}"`)}`)}>Browse</Button>
        <Button size="sm" onClick={() => navigate(`/stats?deck=${deck.id}`)}>Stats</Button>
        {deck.kind === 0 && <Button size="sm" onClick={() => setExp(true)}>Export</Button>}
        {data.buried > 0 && (
          <Button size="sm" onClick={() => api.post(`/api/decks/${deck.id}/unbury`).then(reload)}>
            Unbury {data.buried}
          </Button>
        )}
      </div>

      <div className="mt-10 border-t border-app pt-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">Cards</h2>
          <span className="text-xs text-muted">{totals.total - totals.suspended - totals.buried > 0 ? `${Math.round((totals.mature / (totals.total - totals.suspended - totals.buried)) * 100)}% mature` : ""}</span>
        </div>
        <SegmentedBar segments={maturity} />
        <Legend className="mt-3" items={maturity} />
      </div>

      {deck.description && (
        <div className="mt-8 border-t border-app pt-6">
          <h2 className="text-sm font-semibold mb-2">About this deck</h2>
          <div className="text-sm leading-relaxed text-muted [&_a]:text-brand-600 [&_a]:underline" dangerouslySetInnerHTML={{ __html: sanitize(deck.description) }} />
        </div>
      )}
      {custom && <CustomStudyDialog deckId={deck.id} onClose={() => setCustom(false)} />}
      <FilteredDeckDialog open={editFilter} deckId={deck.id} onClose={() => setEditFilter(false)} onDone={reload} />
      <ExportDialog open={exp} deckId={deck.id} onClose={() => setExp(false)} />
    </div>
  );
}

/** Deck descriptions come from shared decks: strip scripts and handlers. */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of Array.from(el.attributes)) if (a.name.startsWith("on") || /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
  });
  return doc.body.innerHTML;
}
