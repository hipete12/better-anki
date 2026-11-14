import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, MoreHorizontal, Plus, Upload, Filter, Flame, Clock, Target, Settings2, Pencil, Trash2, Download, Sparkles, RefreshCw, Eraser, FolderPlus, Play, Layers } from "lucide-react";
import { api, fmt, type DeckNode, type Today } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Button, Card, cx, EmptyState, Loading, Menu, PageHeader, useDialogs, useToast, IconButton } from "../components/ui";
import ImportDialog from "../components/ImportDialog";
import ExportDialog from "../components/ExportDialog";
import FilteredDeckDialog from "../components/FilteredDeckDialog";
import CustomStudyDialog from "../components/CustomStudyDialog";

export default function Decks() {
  const { data, loading, reload } = useApi(() => api.get<{ tree: DeckNode[]; today: Today; currentDeckId: number }>("/api/decks"), [], { live: true });
  const stats = useApi(() => api.get<{ streak: number; heatmap: { count: number }[] }>("/api/stats?days=7"), [], { live: ["review"] });
  const [importOpen, setImportOpen] = useState(false);
  const [filtered, setFiltered] = useState<{ open: boolean; deckId?: number }>({ open: false });
  const [exportDeck, setExportDeck] = useState<{ open: boolean; deckId?: number | null }>({ open: false });
  const [custom, setCustom] = useState<number | null>(null);
  const dialogs = useDialogs();
  const toast = useToast();

  const createDeck = async (parent?: string) => {
    const name = await dialogs.prompt({ title: parent ? `New subdeck of ${parent}` : "New deck", label: "Name (use :: for subdecks)", confirm: "Create" });
    if (!name?.trim()) return;
    try {
      await api.post("/api/decks", { name: parent ? `${parent}::${name}` : name });
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const totals = (data?.tree ?? []).reduce((a, d) => ({ new: a.new + d.counts.new, learn: a.learn + d.counts.learn, review: a.review + d.counts.review }), { new: 0, learn: 0, review: 0 });
  const dueTotal = totals.new + totals.learn + totals.review;
  const today = data?.today;

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-10">
      <PageHeader
        title="Decks"
        subtitle={dueTotal ? `${dueTotal} card${dueTotal === 1 ? "" : "s"} waiting today` : "You're all caught up"}
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Import
            </Button>
            <Menu
              trigger={(t) => (
                <Button variant="primary" onClick={t}>
                  <Plus className="size-4" /> Create
                </Button>
              )}
              items={[
                { label: "Deck", icon: <FolderPlus />, onClick: () => createDeck() },
                { label: "Filtered deck", icon: <Filter />, onClick: () => setFiltered({ open: true }) },
              ]}
            />
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatTile icon={<Target className="size-4" />} label="Studied today" value={today ? String(today.cards) : "–"} sub={today ? `${today.again} again` : ""} />
        <StatTile icon={<Clock className="size-4" />} label="Time today" value={today ? fmt.duration(today.timeMs) : "–"} sub={today && today.cards ? `${(today.timeMs / today.cards / 1000).toFixed(1)}s / card` : ""} />
        <StatTile icon={<Flame className="size-4" />} label="Streak" value={stats.data ? `${stats.data.streak}d` : "–"} sub={today && today.mature ? `${Math.round((today.matureCorrect / today.mature) * 100)}% mature retention` : "keep it going"} />
      </div>

      <Card className="overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_repeat(3,64px)_44px] items-center px-4 py-2.5 text-xs font-medium text-muted border-b border-app">
          <span>Deck</span>
          <span className="text-right">New</span>
          <span className="text-right">Learn</span>
          <span className="text-right">Due</span>
          <span />
        </div>
        {loading && !data ? (
          <Loading />
        ) : !data?.tree.length ? (
          <EmptyState icon={<Layers />} title="No decks yet">
            Create a deck or import an Anki package (.apkg / .colpkg) to get started.
          </EmptyState>
        ) : (
          <div>
            {data.tree.map((d) => (
              <DeckRow key={d.id} deck={d} depth={0} reload={reload} onFiltered={(id) => setFiltered({ open: true, deckId: id })} onExport={(id) => setExportDeck({ open: true, deckId: id })} onCustom={setCustom} onCreateSub={createDeck} current={data.currentDeckId} />
            ))}
          </div>
        )}
      </Card>
      <div className="flex flex-wrap gap-2 mt-4 justify-center text-xs text-muted">
        <button className="hover:text-app" onClick={() => setExportDeck({ open: true, deckId: null })}>
          Export collection
        </button>
        <span>·</span>
        <Link to="/browse" className="hover:text-app">
          Browse all cards
        </Link>
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
      <FilteredDeckDialog open={filtered.open} deckId={filtered.deckId} onClose={() => setFiltered({ open: false })} onDone={reload} />
      <ExportDialog open={exportDeck.open} deckId={exportDeck.deckId ?? null} onClose={() => setExportDeck({ open: false })} />
      {custom !== null && <CustomStudyDialog deckId={custom} onClose={() => setCustom(null)} />}
    </div>
  );
}

function StatTile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold tracking-tight mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-0.5 truncate">{sub}</div>}
    </Card>
  );
}

function CountCell({ n, color }: { n: number; color: string }) {
  return <span className={cx("text-right tabular-nums text-sm font-semibold", n ? color : "text-muted/40 font-normal")}>{n}</span>;
}

function DeckRow({ deck, depth, reload, onFiltered, onExport, onCustom, onCreateSub, current }: { deck: DeckNode; depth: number; reload: () => void; onFiltered: (id: number) => void; onExport: (id: number) => void; onCustom: (id: number) => void; onCreateSub: (parent: string) => void; current: number }) {
  const navigate = useNavigate();
  const dialogs = useDialogs();
  const toast = useToast();
  const [collapsed, setCollapsed] = useState(deck.collapsed);
  const hasChildren = deck.children.length > 0;
  const toggle = async () => {
    setCollapsed(!collapsed);
    api.patch(`/api/decks/${deck.id}`, { collapsed: !collapsed }).catch(() => {});
  };
  const rename = async () => {
    const name = await dialogs.prompt({ title: "Rename deck", value: deck.name, confirm: "Rename" });
    if (!name || name === deck.name) return;
    try {
      await api.patch(`/api/decks/${deck.id}`, { name });
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const remove = async () => {
    const ok = await dialogs.confirm({ title: `Delete "${deck.name}"?`, body: deck.kind === 1 ? "Cards will be returned to their original decks." : `This deletes the deck, its subdecks and all ${deck.total} cards in them.`, confirm: "Delete", danger: true });
    if (!ok) return;
    try {
      const r = await api.del<{ removedCards: number }>(`/api/decks/${deck.id}`);
      toast(deck.kind === 1 ? "Filtered deck deleted" : `Deleted ${r.removedCards} cards`, "success");
      reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const { counts } = deck;
  return (
    <>
      <div className={cx("group grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_repeat(3,64px)_44px] items-center px-2 sm:px-4 h-14 border-b border-app last:border-0 hover:bg-panel-2/60 transition", deck.id === current && "bg-brand-500/[0.04]")}>
        <div className="flex items-center min-w-0" style={{ paddingLeft: depth * 20 }}>
          <button onClick={toggle} className={cx("size-7 flex items-center justify-center rounded-lg text-muted hover:bg-panel-2", !hasChildren && "invisible")} aria-label={collapsed ? "Expand" : "Collapse"}>
            <ChevronRight className={cx("size-4 transition-transform", !collapsed && "rotate-90")} />
          </button>
          <Link to={`/deck/${deck.id}`} className={cx("truncate font-medium hover:text-brand-600 dark:hover:text-brand-300", deck.kind === 1 && "text-brand-600 dark:text-brand-300 italic")}>
            {deck.shortName}
          </Link>
          {deck.kind === 1 && <Filter className="size-3.5 ml-1.5 text-brand-500 shrink-0" />}
        </div>
        <div className="flex sm:contents items-center gap-3 pr-1">
          <span className="sm:hidden flex gap-2.5 text-sm tabular-nums font-semibold">
            <span className={counts.new ? "text-new" : "text-muted/40"}>{counts.new}</span>
            <span className={counts.learn ? "text-learn" : "text-muted/40"}>{counts.learn}</span>
            <span className={counts.review ? "text-due" : "text-muted/40"}>{counts.review}</span>
          </span>
          <span className="hidden sm:contents">
            <CountCell n={counts.new} color="text-new" />
            <CountCell n={counts.learn} color="text-learn" />
            <CountCell n={counts.review} color="text-due" />
          </span>
          <div className="flex justify-end">
            <Menu
              trigger={(t) => (
                <IconButton label="Deck actions" onClick={t} className="opacity-70 group-hover:opacity-100">
                  <MoreHorizontal className="size-5" />
                </IconButton>
              )}
              items={[
                { label: "Study now", icon: <Play />, onClick: () => navigate(`/study/${deck.id}`) },
                ...(deck.kind === 0
                  ? [
                      { label: "Options", icon: <Settings2 />, onClick: () => navigate(`/options/${deck.id}`) },
                      { label: "Custom study", icon: <Sparkles />, onClick: () => onCustom(deck.id) },
                      { label: "Add subdeck", icon: <FolderPlus />, onClick: () => onCreateSub(deck.name) },
                    ]
                  : [
                      { label: "Edit filter", icon: <Filter />, onClick: () => onFiltered(deck.id) },
                      { label: "Rebuild", icon: <RefreshCw />, onClick: () => api.post(`/api/decks/${deck.id}/rebuild`).then(reload) },
                      { label: "Empty", icon: <Eraser />, onClick: () => api.post(`/api/decks/${deck.id}/empty`).then(reload) },
                    ]),
                { label: "Rename", icon: <Pencil />, onClick: rename },
                ...(deck.kind === 0 ? [{ label: "Export", icon: <Download />, onClick: () => onExport(deck.id) }] : []),
                { divider: true, label: "" },
                { label: "Delete", icon: <Trash2 />, danger: true, onClick: remove },
              ]}
            />
          </div>
        </div>
      </div>
      {!collapsed && deck.children.map((c) => <DeckRow key={c.id} deck={c} depth={depth + 1} reload={reload} onFiltered={onFiltered} onExport={onExport} onCustom={onCustom} onCreateSub={onCreateSub} current={current} />)}
    </>
  );
}
