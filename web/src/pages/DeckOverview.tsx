import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Play, Settings2, Sparkles, Plus, Filter, RefreshCw, Eraser, Search, BarChart3, Download } from "lucide-react";
import { api, type Counts, type Today } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Button, Card, Loading, Badge } from "../components/ui";
import CustomStudyDialog from "../components/CustomStudyDialog";
import FilteredDeckDialog from "../components/FilteredDeckDialog";
import ExportDialog from "../components/ExportDialog";

interface Overview {
  deck: { id: number; name: string; kind: 0 | 1; description: string; configId: number };
  counts: Counts;
  totals: { total: number; new: number; suspended: number; buried: number; young: number; mature: number; learning: number };
  limits: { newLeft: number; revLeft: number } | null;
  configName: string | null;
  buried: number;
  today: Today;
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
  return (
    <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 sm:py-10">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-app mb-4">
        <ArrowLeft className="size-4" /> Decks
      </Link>
      <div className="mb-6">
        {parts.length > 1 && <div className="text-sm text-muted">{parts.slice(0, -1).join(" / ")}</div>}
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          {parts[parts.length - 1]}
          {deck.kind === 1 && <Badge color="brand">Filtered</Badge>}
        </h1>
      </div>
      <Card className="p-6 sm:p-8">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-4xl font-bold text-new tabular-nums">{counts.new}</div>
            <div className="text-sm text-muted mt-1">New</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-learn tabular-nums">{counts.learn}</div>
            <div className="text-sm text-muted mt-1">Learning</div>
          </div>
          <div>
            <div className="text-4xl font-bold text-due tabular-nums">{counts.review}</div>
            <div className="text-sm text-muted mt-1">To review</div>
          </div>
        </div>
        <Button variant="primary" size="lg" className="w-full mt-8" onClick={() => navigate(`/study/${deck.id}`)}>
          <Play className="size-5" /> {due ? "Study now" : "Open"}
        </Button>
        {deck.description && <div className="mt-6 text-sm text-muted prose-sm" dangerouslySetInnerHTML={{ __html: sanitize(deck.description) }} />}
      </Card>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        {deck.kind === 0 ? (
          <>
            <Button onClick={() => navigate(`/options/${deck.id}`)}>
              <Settings2 className="size-4" /> Options
            </Button>
            <Button onClick={() => setCustom(true)}>
              <Sparkles className="size-4" /> Custom study
            </Button>
            <Button onClick={() => navigate(`/add?deck=${deck.id}`)}>
              <Plus className="size-4" /> Add cards
            </Button>
            <Button onClick={() => setExp(true)}>
              <Download className="size-4" /> Export
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setEditFilter(true)}>
              <Filter className="size-4" /> Edit filter
            </Button>
            <Button onClick={() => api.post(`/api/decks/${deck.id}/rebuild`).then(reload)}>
              <RefreshCw className="size-4" /> Rebuild
            </Button>
            <Button onClick={() => api.post(`/api/decks/${deck.id}/empty`).then(reload)}>
              <Eraser className="size-4" /> Empty
            </Button>
          </>
        )}
        <Button onClick={() => navigate(`/browse?q=${encodeURIComponent(`deck:"${deck.name}"`)}`)}>
          <Search className="size-4" /> Browse
        </Button>
        <Button onClick={() => navigate(`/stats?deck=${deck.id}`)}>
          <BarChart3 className="size-4" /> Stats
        </Button>
        {data.buried > 0 && (
          <Button onClick={() => api.post(`/api/decks/${deck.id}/unbury`).then(reload)}>Unbury {data.buried}</Button>
        )}
      </div>
      <Card className="mt-4 p-5">
        <div className="text-sm font-semibold mb-3">Cards in this deck</div>
        <div className="flex h-2.5 rounded-full overflow-hidden bg-panel-2">
          {[
            [totals.new, "bg-blue-500"],
            [totals.learning, "bg-orange-500"],
            [totals.young, "bg-green-400"],
            [totals.mature, "bg-green-700"],
            [totals.suspended, "bg-amber-300"],
            [totals.buried, "bg-zinc-400"],
          ].map(([n, c], i) => (n as number) > 0 && <div key={i} className={c as string} style={{ width: `${((n as number) / Math.max(1, totals.total)) * 100}%` }} />)}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3 text-xs">
          {[
            ["New", totals.new, "bg-blue-500"],
            ["Learning", totals.learning, "bg-orange-500"],
            ["Young", totals.young, "bg-green-400"],
            ["Mature", totals.mature, "bg-green-700"],
            ["Suspended", totals.suspended, "bg-amber-300"],
            ["Buried", totals.buried, "bg-zinc-400"],
          ].map(([l, n, c]) => (
            <div key={l as string} className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${c}`} />
              <span className="text-muted">{l}</span>
              <span className="font-semibold tabular-nums ml-auto">{n}</span>
            </div>
          ))}
        </div>
        {data.configName && (
          <div className="text-xs text-muted mt-4">
            Preset: <span className="font-medium text-app">{data.configName}</span>
            {data.limits && ` · ${data.limits.newLeft} new and ${data.limits.revLeft} reviews left in today's limits`}
          </div>
        )}
      </Card>
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
