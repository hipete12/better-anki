import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Plus, Upload, Filter, Settings2, Pencil, Trash2, Download, Sparkles, RefreshCw, Eraser, FolderPlus, Play } from "lucide-react";
import { api, type DeckNode, type HomeSummary } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Button, cx, EmptyState, Loading, Menu, PageHeader, useDialogs, useToast, IconButton } from "../components/ui";
import CardTrend from "../components/CardTrend";
import ImportDialog from "../components/ImportDialog";
import ExportDialog from "../components/ExportDialog";
import FilteredDeckDialog from "../components/FilteredDeckDialog";
import CustomStudyDialog from "../components/CustomStudyDialog";

const GRID = "grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_repeat(3,56px)] items-center";

export default function Decks() {
  const { data, loading, reload } = useApi(() => api.get<{ tree: DeckNode[]; currentDeckId: number }>("/api/decks"), [], { live: true });
  const home = useApi(() => api.get<HomeSummary>("/api/home"), [], { live: true });
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

  const tree = data?.tree ?? [];
  const h = home.data;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <PageHeader
        title="Decks"
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Import
            </Button>
            <Menu
              trigger={(tr) => (
                <Button variant="primary" onClick={tr}>
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

      {tree.length > 0 && h && <CardTrend trend={h.trend} className="mb-8" />}

      <div className="panel rounded-xl">
        {loading && !data ? (
          <Loading />
        ) : !tree.length ? (
          <EmptyState
            title="No decks yet"
            action={
              <>
                <Button variant="primary" onClick={() => setImportOpen(true)}>
                  Import a deck
                </Button>
                <Button onClick={() => createDeck()}>Create a deck</Button>
              </>
            }
          >
            Import an Anki package (.apkg / .colpkg) or create a deck to get started.
          </EmptyState>
        ) : (
          <>
            <div className={cx(GRID, "hidden sm:grid h-8 px-5 text-xs text-muted border-b border-app")}>
              <span>Deck</span>
              <span className="text-right">New</span>
              <span className="text-right">Learn</span>
              <span className="text-right">Due</span>
            </div>
            {tree.map((d) => (
              <DeckRow key={d.id} deck={d} depth={0} reload={reload} onFiltered={(id) => setFiltered({ open: true, deckId: id })} onExport={(id) => setExportDeck({ open: true, deckId: id })} onCustom={setCustom} onCreateSub={createDeck} current={data?.currentDeckId ?? 0} />
            ))}
          </>
        )}
      </div>
      {tree.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 px-1 text-xs text-muted">
          {h && (
            <span>
              {h.cards.total.toLocaleString()} cards · {h.cards.mature.toLocaleString()} mature
              {h.retention30 != null && ` · ${h.retention30.toFixed(0)}% retention (30 days)`}
            </span>
          )}
          <span className="ml-auto flex gap-3">
            <button className="hover:text-app" onClick={() => setExportDeck({ open: true, deckId: null })}>
              Export collection
            </button>
            <Link to="/browse" className="hover:text-app">
              Browse all cards
            </Link>
          </span>
        </div>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
      <FilteredDeckDialog open={filtered.open} deckId={filtered.deckId} onClose={() => setFiltered({ open: false })} onDone={reload} />
      <ExportDialog open={exportDeck.open} deckId={exportDeck.deckId ?? null} onClose={() => setExportDeck({ open: false })} />
      {custom !== null && <CustomStudyDialog deckId={custom} onClose={() => setCustom(null)} />}
    </div>
  );
}

function Count({ n, color }: { n: number; color: string }) {
  return <span className={cx("text-right tnum text-sm", n ? cx(color, "font-semibold") : "text-faint")}>{n}</span>;
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
  const due = counts.new + counts.learn + counts.review;
  return (
    <>
      <div className={cx(GRID, "group h-10 px-5 border-b border-app last:border-0 last:rounded-b-xl hover:bg-panel-2/50 transition-colors")}>
        {/* the expand chevron sits in the gutter left of the name, so names line up with the "Deck" header */}
        <div className="flex items-center min-w-0" style={{ paddingLeft: depth * 20 }}>
          <button onClick={toggle} className={cx("-ml-5 size-5 flex shrink-0 items-center justify-center rounded text-faint hover:text-app", !hasChildren && "invisible")} aria-label={collapsed ? "Expand" : "Collapse"}>
            <ChevronRight className={cx("size-3.5 transition-transform", !collapsed && "rotate-90")} />
          </button>
          <Link to={`/deck/${deck.id}`} className={cx("truncate text-sm hover:text-brand-600 dark:hover:text-brand-400", depth === 0 ? "font-medium" : "", deck.kind === 1 && "italic")}>
            {deck.shortName}
          </Link>
          {deck.kind === 1 && <span className="ml-2 text-[11px] text-brand-600 dark:text-brand-400">filtered</span>}
          {deck.id === current && <span className="ml-2 size-1.5 shrink-0 rounded-full bg-brand-500" title="Current deck" />}
          <span className="ml-2 hidden sm:inline text-xs text-faint tnum">{deck.total}</span>
          <span className="ml-1 shrink-0">
            <Menu
              align="left"
              trigger={(t) => (
                <IconButton label={`Edit ${deck.shortName}`} onClick={t} className="size-7 text-faint hover:text-muted sm:opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                  <Pencil className="size-3.5" />
                </IconButton>
              )}
              items={[
                { label: "Study now", icon: <Play />, onClick: () => navigate(`/study/${deck.id}`), disabled: !due },
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
          </span>
        </div>
        <span className="sm:hidden flex gap-2.5 pr-1">
          <Count n={counts.new} color="text-new" />
          <Count n={counts.learn} color="text-learn" />
          <Count n={counts.review} color="text-due" />
        </span>
        <span className="hidden sm:contents">
          <Count n={counts.new} color="text-new" />
          <Count n={counts.learn} color="text-learn" />
          <Count n={counts.review} color="text-due" />
        </span>
      </div>
      {!collapsed && deck.children.map((c) => <DeckRow key={c.id} deck={c} depth={depth + 1} reload={reload} onFiltered={onFiltered} onExport={onExport} onCustom={onCustom} onCreateSub={onCreateSub} current={current} />)}
    </>
  );
}
