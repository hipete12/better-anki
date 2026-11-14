import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Tag, Flag, ChevronDown, ChevronUp, MoreHorizontal, PauseCircle, Trash2, FolderInput, Tags, CalendarClock, RotateCcw, ListOrdered, Replace, Download, Filter, Info, Star, SlidersHorizontal, X, Eye, EyeOff, PanelLeft } from "lucide-react";
import { api, type BrowseRow, type CardState, type NoteData } from "../lib/api";
import { useApi, useLocalStorage, useIsDark } from "../lib/hooks";
import { Button, cx, Field, IconButton, Input, Loading, Menu, Modal, Select, Switch, Tabs, useDialogs, useToast, Badge } from "../components/ui";
import NoteEditor from "../components/NoteEditor";
import CardFrame from "../components/CardFrame";
import CardInfoDialog from "../components/CardInfoDialog";
import ExportDialog from "../components/ExportDialog";
import FilteredDeckDialog from "../components/FilteredDeckDialog";

const COLUMNS: { key: keyof BrowseRow; label: string; sort?: string; cls?: string; center?: boolean; notes?: boolean; cards?: boolean }[] = [
  { key: "sortField", label: "Card", sort: "sortField", cls: "min-w-48" },
  { key: "state", label: "State", sort: "state", cls: "w-16", center: true, cards: true },
  { key: "question", label: "Question", cls: "min-w-48", cards: true },
  { key: "answer", label: "Answer", cls: "min-w-40", cards: true },
  { key: "deck", label: "Deck", sort: "deck" },
  { key: "due", label: "Due", sort: "due", cards: true },
  { key: "ivl", label: "Interval", sort: "ivl", cards: true },
  { key: "ease", label: "Ease", sort: "ease", cards: true },
  { key: "difficulty", label: "Difficulty", sort: "difficulty", cards: true },
  { key: "stability", label: "Stability", sort: "stability", cards: true },
  { key: "reps", label: "Reviews", sort: "reps", cards: true },
  { key: "lapses", label: "Lapses", sort: "lapses", cards: true },
  { key: "notetype", label: "Note Type", sort: "notetype" },
  { key: "template", label: "Card type", sort: "template", cards: true },
  { key: "cards", label: "Cards", notes: true },
  { key: "tags", label: "Tags" },
  { key: "created", label: "Created", sort: "created" },
  { key: "modified", label: "Modified", sort: "modified" },
];
const DEFAULT_COLS = ["sortField", "state", "deck", "due", "ivl", "ease", "tags"];
/** State dots, in the server's sort order. Review (not due yet) is a hollow ring, due is filled. */
const STATES: Record<CardState, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-new" },
  learning: { label: "Learning", cls: "bg-learn" },
  review: { label: "Review (not due yet)", cls: "border-[1.5px] border-due" },
  due: { label: "Due", cls: "bg-due" },
  suspended: { label: "Suspended", cls: "bg-yellow-500 dark:bg-yellow-400" },
  buried: { label: "Buried", cls: "bg-zinc-400 dark:bg-zinc-500" },
  marked: { label: "Marked", cls: "bg-violet-600 dark:bg-violet-400" },
  leech: { label: "Leech", cls: "bg-orange-600 dark:bg-orange-400" },
};
const FLAG_COLORS = ["", "#ef4444", "#f97316", "#22c55e", "#3b82f6", "#ec4899", "#14b8a6", "#a855f7"];
const FLAG_NAMES = ["No flag", "Red", "Orange", "Green", "Blue", "Pink", "Turquoise", "Purple"];

export default function Browse() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "deck:current");
  const [input, setInput] = useState(query);
  const [mode, setMode] = useLocalStorage<"cards" | "notes">("ba.browse.mode", "cards");
  const [sort, setSort] = useLocalStorage<{ col: string; desc: boolean }>("ba.browse.sort", { col: "created", desc: true });
  const [cols, setCols] = useLocalStorage<string[]>("ba.browse.cols", DEFAULT_COLS);
  // show the State column once for people with saved column choices from before it existed
  useEffect(() => {
    try {
      if (localStorage.getItem("ba.browse.stateCol")) return;
      localStorage.setItem("ba.browse.stateCol", "1");
    } catch {
      return;
    }
    if (!cols.includes("state")) setCols(cols.flatMap((c) => (c === "sortField" ? [c, "state"] : [c])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [rows, setRows] = useState<BrowseRow[]>([]);
  const [ids, setIds] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [infoCard, setInfoCard] = useState<number | null>(null);
  const [exportNotes, setExportNotes] = useState<number[] | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [modal, setModal] = useState<null | "deck" | "tags-add" | "tags-remove" | "due" | "reposition" | "replace" | "columns" | "editor">(null);
  const seq = useRef(0);
  const dialogs = useDialogs();
  const toast = useToast();

  const search = useCallback(
    async (offset = 0) => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const r = await api.get<{ total: number; rows: BrowseRow[]; ids: number[] }>(`/api/browse?${new URLSearchParams({ q: query, mode, sort: sort.col, desc: sort.desc ? "1" : "0", offset: String(offset), limit: "150" })}`);
        if (my !== seq.current) return;
        setError(null);
        setTotal(r.total);
        setIds(r.ids);
        setRows((old) => (offset ? [...old, ...r.rows] : r.rows));
      } catch (e) {
        if (my === seq.current) setError((e as Error).message);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [query, mode, sort],
  );

  useEffect(() => {
    search(0);
    setSelected(new Set());
  }, [search]);

  const runSearch = (q: string) => {
    setInput(q);
    setQuery(q);
    setParams(q ? { q } : {}, { replace: true });
  };

  const selIds = useMemo(() => [...selected], [selected]);
  const selRows = rows.filter((r) => selected.has(mode === "notes" ? r.nid : r.id));
  const single = selRows.length === 1 ? selRows[0] : null;
  const selCardIds = async (): Promise<number[]> => {
    if (mode === "cards") return selIds;
    const r = await api.get<{ ids: number[] }>(`/api/browse?${new URLSearchParams({ q: `nid:${selIds.join(",")}`, mode: "cards", limit: "1" })}`);
    return r.ids;
  };
  const selNoteIds = () => (mode === "notes" ? selIds : [...new Set(selRows.map((r) => r.nid))]);

  const cardAct = async (body: Record<string, unknown>, msg: string) => {
    try {
      const cardIds = await selCardIds();
      await api.post("/api/cards/actions", { ...body, cardIds });
      toast(msg, "success", { label: "Undo", onClick: () => api.post("/api/undo").then(() => search(0)) });
      search(0);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const click = (row: BrowseRow, idx: number, e: React.MouseEvent) => {
    const id = mode === "notes" ? row.nid : row.id;
    const next = new Set(e.ctrlKey || e.metaKey ? selected : []);
    if (e.shiftKey && anchor !== null) {
      const [a, b] = [Math.min(anchor, idx), Math.max(anchor, idx)];
      for (let i = a; i <= b; i++) next.add(mode === "notes" ? rows[i].nid : rows[i].id);
    } else if ((e.ctrlKey || e.metaKey) && selected.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
    if (!e.shiftKey) setAnchor(idx);
    if (window.innerWidth < 1024 && !e.ctrlKey && !e.shiftKey && !e.metaKey) setModal("editor");
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        setSelected(new Set(ids));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        document.getElementById("browse-search")?.focus();
      } else if (e.key === "Delete" && selected.size) removeNotes();
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const cur = anchor ?? -1;
        const n = Math.max(0, Math.min(rows.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
        if (rows[n]) {
          setSelected(new Set([mode === "notes" ? rows[n].nid : rows[n].id]));
          setAnchor(n);
          document.getElementById(`row-${n}`)?.scrollIntoView({ block: "nearest" });
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const removeNotes = async () => {
    const nids = selNoteIds();
    if (!(await dialogs.confirm({ title: `Delete ${nids.length} note${nids.length === 1 ? "" : "s"}?`, body: "All cards of these notes will be deleted.", confirm: "Delete", danger: true }))) return;
    await api.post("/api/notes/delete", { noteIds: nids });
    toast(`Deleted ${nids.length} notes`, "success");
    search(0);
  };

  const visibleCols = COLUMNS.filter((c) => cols.includes(c.key) && !(mode === "notes" && c.cards) && !(mode === "cards" && c.notes));
  const anySuspended = selRows.some((r) => r.queue === -1);

  return (
    <div className="flex h-full">
      {sidebar && <BrowseSidebar onSearch={runSearch} current={query} />}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-b border-app bg-panel">
          <IconButton label="Toggle sidebar" onClick={() => setSidebar(!sidebar)} className="hidden md:inline-flex">
            <PanelLeft className="size-5" />
          </IconButton>
          <form
            className="relative flex-1 min-w-56"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(input);
            }}
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
            <Input id="browse-search" value={input} onChange={(e) => setInput(e.target.value)} placeholder='Search: dog, deck:"Spanish", tag:verb, is:due, prop:ivl>30, "exact phrase"' className="pl-9 font-mono text-[13px]" />
          </form>
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: "cards", label: "Cards" },
              { value: "notes", label: "Notes" },
            ]}
          />
          <IconButton label="Columns" onClick={() => setModal("columns")}>
            <SlidersHorizontal className="size-5" />
          </IconButton>
        </div>
        <div className="flex items-center gap-2 px-3 sm:px-4 h-11 border-b border-app text-sm">
          <span className="text-muted">
            {total.toLocaleString()} {mode} {selected.size > 0 && <span className="text-app font-medium">· {selected.size} selected</span>}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setModal("deck")}>
                  <FolderInput className="size-4" /> <span className="hidden sm:inline">Change deck</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => cardAct({ action: anySuspended ? "unsuspend" : "suspend" }, anySuspended ? "Unsuspended" : "Suspended")}>
                  <PauseCircle className="size-4" /> <span className="hidden sm:inline">{anySuspended ? "Unsuspend" : "Suspend"}</span>
                </Button>
                <Menu
                  trigger={(t) => (
                    <Button size="sm" variant="ghost" onClick={t}>
                      <Flag className="size-4" /> <span className="hidden sm:inline">Flag</span>
                    </Button>
                  )}
                  items={FLAG_NAMES.map((n, i) => ({ label: n, icon: <Flag style={{ color: FLAG_COLORS[i] || undefined, fill: FLAG_COLORS[i] || "none" }} />, onClick: () => cardAct({ action: "flag", flag: i }, i ? `Flagged ${n.toLowerCase()}` : "Flag removed") }))}
                />
              </>
            )}
            <Menu
              trigger={(t) => (
                <IconButton label="More actions" onClick={t}>
                  <MoreHorizontal className="size-5" />
                </IconButton>
              )}
              items={[
                { label: "Select all", shortcut: "Ctrl+A", onClick: () => setSelected(new Set(ids)) },
                { divider: true, label: "" },
                { label: "Add tags", icon: <Tags />, disabled: !selected.size, onClick: () => setModal("tags-add") },
                { label: "Remove tags", icon: <Tag />, disabled: !selected.size, onClick: () => setModal("tags-remove") },
                { label: "Toggle mark", icon: <Star />, disabled: !selected.size, onClick: () => api.post("/api/notes/tags", selRows.every((r) => r.marked) ? { noteIds: selNoteIds(), remove: ["marked"] } : { noteIds: selNoteIds(), add: ["marked"] }).then(() => search(0)) },
                { label: "Bury / unbury", icon: <EyeOff />, disabled: !selected.size, onClick: () => cardAct({ action: selRows.some((r) => r.queue === -2 || r.queue === -3) ? "unbury" : "bury" }, "Updated") },
                { label: "Set due date", icon: <CalendarClock />, disabled: !selected.size, onClick: () => setModal("due") },
                { label: "Reset (forget)", icon: <RotateCcw />, disabled: !selected.size, onClick: () => cardAct({ action: "forget" }, "Reset to new") },
                { label: "Reposition new cards", icon: <ListOrdered />, disabled: !selected.size, onClick: () => setModal("reposition") },
                { label: "Find and replace", icon: <Replace />, disabled: !selected.size, onClick: () => setModal("replace") },
                { label: "Card info", icon: <Info />, disabled: !single || mode !== "cards", onClick: () => single && setInfoCard(single.id) },
                { divider: true, label: "" },
                { label: "Create filtered deck from search", icon: <Filter />, onClick: () => setFilterOpen(true) },
                { label: "Export selected notes", icon: <Download />, disabled: !selected.size, onClick: () => setExportNotes(selNoteIds()) },
                { divider: true, label: "" },
                { label: "Delete notes", icon: <Trash2 />, danger: true, disabled: !selected.size, shortcut: "Del", onClick: removeNotes },
              ]}
            />
          </div>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div
            className="flex-1 min-w-0 overflow-auto scrollbar-thin"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (!loading && rows.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 300) search(rows.length);
            }}
          >
            {error ? (
              <div className="p-6 text-sm text-red-600">{error}</div>
            ) : (
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-panel-2">
                  <tr>
                    <th className="w-1.5 border-b border-app" />
                    {visibleCols.map((c) => (
                      <th key={c.key} className={cx("font-medium text-xs text-muted px-3 py-2 border-b border-app whitespace-nowrap select-none", c.center ? "text-center" : "text-left", c.sort && "cursor-pointer hover:text-app")} onClick={() => c.sort && setSort({ col: c.sort, desc: sort.col === c.sort ? !sort.desc : false })}>
                        <span className={cx("inline-flex items-center gap-1", c.center && "justify-center")}>
                          {c.label}
                          {sort.col === c.sort && (sort.desc ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const id = mode === "notes" ? r.nid : r.id;
                    const sel = selected.has(id);
                    return (
                      <tr
                        id={`row-${i}`}
                        key={`${id}`}
                        onClick={(e) => click(r, i, e)}
                        className={cx("cursor-default", sel ? "bg-brand-500/15" : r.queue === -1 ? "bg-amber-400/10" : r.marked ? "bg-violet-500/8" : r.queue === -2 || r.queue === -3 ? "bg-zinc-500/8" : "hover:bg-panel-2/70")}
                      >
                        <td className="border-b border-app p-0">
                          <div className="w-1.5 h-9" style={{ background: FLAG_COLORS[r.flags] || "transparent" }} />
                        </td>
                        {visibleCols.map((c) => (
                          <td key={c.key} className={cx("px-3 py-2 border-b border-app max-w-80 truncate", c.center && "text-center", c.cls)}>
                            {c.key === "state" ? (
                              <span role="img" aria-label={STATES[r.state].label} title={STATES[r.state].label} className={cx("inline-block size-2.5 rounded-full align-middle", STATES[r.state].cls)} />
                            ) : c.key === "tags" ? (
                              <span className="flex gap-1">
                                {r.tags.slice(0, 3).map((t) => (
                                  <Badge key={t}>{t}</Badge>
                                ))}
                                {r.tags.length > 3 && <span className="text-xs text-muted">+{r.tags.length - 3}</span>}
                              </span>
                            ) : (
                              String(r[c.key] ?? "")
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {loading && <Loading />}
            {!loading && !rows.length && !error && <div className="p-10 text-center text-sm text-muted">No {mode} match this search.</div>}
          </div>
          {single && (
            <aside className="hidden lg:flex w-[440px] xl:w-[520px] shrink-0 border-l border-app bg-panel flex-col">
              <SideEditor key={single.nid} row={single} mode={mode} onSaved={() => search(0)} />
            </aside>
          )}
        </div>
      </div>
      <Modal open={modal === "editor" && !!single} onClose={() => setModal(null)} title="Edit" wide>
        {single && <SideEditor row={single} mode={mode} onSaved={() => search(0)} compact />}
      </Modal>
      {modal === "deck" && <ChangeDeckDialog onClose={() => setModal(null)} onPick={(deckId) => cardAct({ action: "setDeck", deckId }, "Moved")} />}
      {(modal === "tags-add" || modal === "tags-remove") && (
        <TagsDialog
          remove={modal === "tags-remove"}
          onClose={() => setModal(null)}
          onApply={async (tags) => {
            await api.post("/api/notes/tags", modal === "tags-add" ? { noteIds: selNoteIds(), add: tags } : { noteIds: selNoteIds(), remove: tags });
            toast("Tags updated", "success");
            search(0);
          }}
        />
      )}
      {modal === "due" && (
        <SimplePrompt
          title="Set due date"
          label="Days from today: 0 = today, 1-7 = random in range, add ! to also set interval (e.g. 30!)"
          initial="0"
          onClose={() => setModal(null)}
          onOk={(v) => cardAct({ action: "setDue", days: v }, "Due date set")}
        />
      )}
      {modal === "reposition" && <RepositionDialog onClose={() => setModal(null)} onOk={(o) => cardAct({ action: "reposition", ...o }, "Repositioned")} />}
      {modal === "replace" && <FindReplaceDialog onClose={() => setModal(null)} noteIds={selNoteIds()} onDone={() => search(0)} />}
      {modal === "columns" && (
        <Modal open onClose={() => setModal(null)} title="Columns">
          <div className="grid grid-cols-2 gap-3">
            {COLUMNS.map((c) => (
              <Switch key={c.key} checked={cols.includes(c.key)} onChange={(v) => setCols(v ? [...cols, c.key] : cols.filter((x) => x !== c.key))} label={c.label} />
            ))}
          </div>
        </Modal>
      )}
      <CardInfoDialog cardId={infoCard} onClose={() => setInfoCard(null)} />
      <ExportDialog open={!!exportNotes} onClose={() => setExportNotes(null)} deckId={null} noteIds={exportNotes ?? undefined} />
      <FilteredDeckDialog open={filterOpen} onClose={() => setFilterOpen(false)} initialSearch={query} />
    </div>
  );
}

function BrowseSidebar({ onSearch, current }: { onSearch: (q: string) => void; current: string }) {
  const decks = useApi(() => api.get<{ id: number; name: string; kind: number }[]>("/api/decks/list"), [], { live: ["decks"] });
  const nts = useApi(() => api.get<{ id: number; name: string }[]>("/api/notetypes"), [], { live: ["notetypes"] });
  const tags = useApi(() => api.get<string[]>("/api/tags"), [], { live: ["notes", "import"] });
  const Item = ({ q, label, icon, depth = 0 }: { q: string; label: React.ReactNode; icon?: React.ReactNode; depth?: number }) => (
    <button onClick={() => onSearch(q)} className={cx("w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-left truncate", current === q ? "bg-panel-2 text-app font-medium" : "text-muted hover:text-app hover:bg-panel-2")} style={{ paddingLeft: 8 + depth * 12 }}>
      {icon && <span className="[&>svg]:size-3.5 shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
    </button>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-4">
      <div className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{title}</div>
      {children}
    </div>
  );
  return (
    <aside className="hidden md:block w-56 shrink-0 border-r border-app bg-panel overflow-y-auto scrollbar-thin px-2 py-3">
      <Section title="Saved searches">
        <Item q="" label="Whole collection" />
        <Item q="deck:current" label="Current deck" />
        <Item q="added:1" label="Added today" />
        <Item q="rated:1" label="Studied today" />
        <Item q="rated:1:1" label="Again today" />
        <Item q="edited:1" label="Edited today" />
      </Section>
      <Section title="Card state">
        {(
          [
            ["is:new", "New", "new"],
            ["is:learn", "Learning", "learning"],
            ["is:review", "Review", "review"],
            ["is:due", "Due", "due"],
            ["is:suspended", "Suspended", "suspended"],
            ["is:buried", "Buried", "buried"],
            ["tag:marked", "Marked", "marked"],
            ["tag:leech", "Leeches", "leech"],
          ] as const
        ).map(([q, label, state]) => (
          <Item key={q} q={q} label={label} icon={<span className={cx("block size-2 rounded-full", STATES[state].cls)} />} />
        ))}
      </Section>
      <Section title="Flags">
        {FLAG_NAMES.slice(1).map((n, i) => (
          <Item key={n} q={`flag:${i + 1}`} label={n} icon={<span className="block size-2 rounded-full" style={{ background: FLAG_COLORS[i + 1] }} />} />
        ))}
      </Section>
      <Section title="Decks">
        {decks.data?.map((d) => (
          <Item key={d.id} q={`deck:"${d.name}"`} label={d.name.split("::").pop()} depth={d.name.split("::").length - 1} />
        ))}
      </Section>
      <Section title="Note types">
        {nts.data?.map((n) => (
          <Item key={n.id} q={`note:"${n.name}"`} label={n.name} />
        ))}
      </Section>
      <Section title="Tags">
        {tags.data?.length ? tags.data.map((t) => <Item key={t} q={`tag:"${t}"`} label={t.split("::").pop()} depth={t.split("::").length - 1} />) : <div className="px-2 text-xs text-muted">No tags</div>}
      </Section>
    </aside>
  );
}

function SideEditor({ row, mode, onSaved, compact }: { row: BrowseRow; mode: string; onSaved: () => void; compact?: boolean }) {
  const [note, setNote] = useState<NoteData | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [side, setSide] = useState<"question" | "answer">("question");
  const dark = useIsDark();
  const toast = useToast();
  useEffect(() => {
    api.get<NoteData>(`/api/notes/${row.nid}`).then((n) => {
      setNote(n);
      setFields(n.fields);
      setTags(n.tags);
      setDirty(false);
    });
  }, [row.nid]);
  const save = useCallback(async () => {
    if (!note || !dirty) return;
    try {
      await api.put(`/api/notes/${note.id}`, { fields, tags });
      setDirty(false);
      onSaved();
      toast("Saved", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [note, dirty, fields, tags, onSaved, toast]);
  const cardId = mode === "cards" ? row.id : note?.cards[0]?.id;
  const pv = useApi(() => (preview && cardId ? api.get<{ question: string; answer: string }>(`/api/cards/${cardId}?night=${dark ? 1 : 0}`) : Promise.resolve(null)), [preview, cardId, dark, note?.mtime]);
  if (!note) return <Loading />;
  return (
    <div className={cx("flex flex-col", compact ? "" : "h-full")}>
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-app">
        <div className="min-w-0 text-sm">
          <div className="font-semibold truncate">{note.notetype.name}</div>
          <div className="text-xs text-muted truncate">{note.cards.map((c) => c.deck).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</div>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={preview ? "subtle" : "ghost"} onClick={() => setPreview(!preview)}>
            <Eye className="size-4" /> Preview
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>
            Save
          </Button>
        </div>
      </div>
      <div className={cx("overflow-y-auto scrollbar-thin p-4", !compact && "flex-1")} onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && (e.preventDefault(), save())} onBlur={() => dirty && save()}>
        {preview && (
          <div className="mb-4">
            <Tabs
              value={side}
              onChange={setSide}
              className="mb-2"
              tabs={[
                { value: "question", label: "Front" },
                { value: "answer", label: "Back" },
              ]}
            />
            <div className="h-64 rounded-xl border border-app overflow-hidden">{pv.data ? <CardFrame html={side === "question" ? pv.data.question : pv.data.answer} /> : <Loading />}</div>
          </div>
        )}
        <NoteEditor notetype={note.notetype} fields={fields} onFieldsChange={(f) => (setFields(f), setDirty(true))} tags={tags} onTagsChange={(t) => (setTags(t), setDirty(true))} />
      </div>
    </div>
  );
}

function ChangeDeckDialog({ onClose, onPick }: { onClose: () => void; onPick: (id: number) => void }) {
  const decks = useApi(() => api.get<{ id: number; name: string; kind: number }[]>("/api/decks/list"), []);
  const [filter, setFilter] = useState("");
  return (
    <Modal open onClose={onClose} title="Change deck">
      <Input autoFocus placeholder="Filter decks…" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3" />
      <div className="max-h-80 overflow-y-auto -mx-2">
        {decks.data
          ?.filter((d) => d.kind === 0 && d.name.toLowerCase().includes(filter.toLowerCase()))
          .map((d) => (
            <button key={d.id} onClick={() => (onPick(d.id), onClose())} className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-panel-2">
              {d.name}
            </button>
          ))}
      </div>
    </Modal>
  );
}

function TagsDialog({ remove, onClose, onApply }: { remove: boolean; onClose: () => void; onApply: (t: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <SimplePrompt title={remove ? "Remove tags" : "Add tags"} label="Space-separated tags" initial={v} onClose={onClose} onOk={(x) => (setV(x), onApply(x.split(/\s+/).filter(Boolean)))} />
  );
}

function SimplePrompt({ title, label, initial, onClose, onOk }: { title: string; label: string; initial: string; onClose: () => void; onOk: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => (onOk(v), onClose())}>
            Apply
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => (e.preventDefault(), onOk(v), onClose())}>
        <div className="text-sm text-muted mb-2">{label}</div>
        <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} />
      </form>
    </Modal>
  );
}

function RepositionDialog({ onClose, onOk }: { onClose: () => void; onOk: (o: { start: number; step: number; randomize: boolean; shift: boolean }) => void }) {
  const [start, setStart] = useState(0);
  const [step, setStep] = useState(1);
  const [randomize, setRandomize] = useState(false);
  const [shift, setShift] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Reposition new cards"
      footer={
        <Button variant="primary" onClick={() => (onOk({ start, step, randomize, shift }), onClose())}>
          Reposition
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="Start position">
          <Input type="number" value={start} onChange={(e) => setStart(+e.target.value)} />
        </Field>
        <Field label="Step">
          <Input type="number" min={1} value={step} onChange={(e) => setStep(+e.target.value)} />
        </Field>
      </div>
      <div className="space-y-3">
        <Switch checked={randomize} onChange={setRandomize} label="Randomize order" />
        <Switch checked={shift} onChange={setShift} label="Shift position of existing cards" />
      </div>
    </Modal>
  );
}

function FindReplaceDialog({ onClose, noteIds, onDone }: { onClose: () => void; noteIds: number[]; onDone: () => void }) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [field, setField] = useState("");
  const toast = useToast();
  const run = async () => {
    try {
      const r = await api.post<{ changed: number }>("/api/notes/find-replace", { noteIds, find, replace, regex, matchCase, field: field || null });
      toast(`${r.changed} notes updated`, "success");
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Find and replace in ${noteIds.length} notes`}
      footer={
        <Button variant="primary" onClick={run} disabled={!find}>
          Replace
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Find">
          <Input autoFocus value={find} onChange={(e) => setFind(e.target.value)} />
        </Field>
        <Field label="Replace with">
          <Input value={replace} onChange={(e) => setReplace(e.target.value)} />
        </Field>
        <Field label="In">
          <Select value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">All fields</option>
            <option value="__tags__">Tags</option>
          </Select>
        </Field>
        <Switch checked={regex} onChange={setRegex} label="Treat input as regular expression" />
        <Switch checked={matchCase} onChange={setMatchCase} label="Match case" />
      </div>
    </Modal>
  );
}

void X;
