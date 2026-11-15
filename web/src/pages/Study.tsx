import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Undo2, MoreHorizontal, Flag, Star, EyeOff, PauseCircle, Pencil, Info, Volume2, Trash2, CalendarClock, RotateCcw, Settings2, Clock, ZoomIn, ZoomOut } from "lucide-react";
import { api, type StudyState } from "../lib/api";
import { useIsDark, useLocalStorage } from "../lib/hooks";
import { Button, cx, IconButton, Loading, Menu, useDialogs, useToast, Kbd } from "../components/ui";
import { Stat } from "../components/visual";
import CardFrame, { type CardFrameHandle } from "../components/CardFrame";
import EditNoteDialog from "../components/EditNoteDialog";
import CardInfoDialog from "../components/CardInfoDialog";
import CustomStudyDialog from "../components/CustomStudyDialog";

const FLAGS = [
  { n: 1, name: "Red", color: "#ef4444" },
  { n: 2, name: "Orange", color: "#f97316" },
  { n: 3, name: "Green", color: "#22c55e" },
  { n: 4, name: "Blue", color: "#3b82f6" },
  { n: 5, name: "Pink", color: "#ec4899" },
  { n: 6, name: "Turquoise", color: "#14b8a6" },
  { n: 7, name: "Purple", color: "#a855f7" },
];

const BUTTONS = [
  { ease: 1, label: "Again", text: "text-again", hover: "hover:border-again/50" },
  { ease: 2, label: "Hard", text: "text-hard", hover: "hover:border-hard/50" },
  { ease: 3, label: "Good", text: "text-good", hover: "hover:border-good/50" },
  { ease: 4, label: "Easy", text: "text-easy", hover: "hover:border-easy/50" },
];

export default function Study() {
  const { id } = useParams();
  const deckId = Number(id);
  const navigate = useNavigate();
  const dark = useIsDark();
  const toast = useToast();
  const dialogs = useDialogs();
  const [state, setState] = useState<StudyState | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [answerPage, setAnswerPage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editNote, setEditNote] = useState<number | null>(null);
  const [infoCard, setInfoCard] = useState<number | null>(null);
  const [custom, setCustom] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const shownAt = useRef(Date.now());
  const sessionStart = useRef(Date.now());
  const sessionCount = useRef(0);
  const [session, setSession] = useState({ count: 0, again: 0, ms: 0 });
  const frame = useRef<CardFrameHandle>(null);
  const q = `?night=${dark ? 1 : 0}&platform=web`;
  // card zoom (like Anki's Ctrl +/-): a little larger by default on big screens
  const [zoom, setZoom] = useLocalStorage<number>("ba.cardZoom", typeof window !== "undefined" && window.innerWidth >= 768 ? 1.2 : 1);
  const bumpZoom = useCallback((d: number) => setZoom(d === 0 ? 1 : Math.round(Math.min(2.5, Math.max(0.6, zoom + d)) * 10) / 10), [zoom, setZoom]);
  const zoomed = (html: string) => (zoom === 1 ? html : html.replace("<head>", `<head><style>html{zoom:${zoom}}body{min-height:calc(100vh / ${zoom})}</style>`));

  const apply = useCallback((s: StudyState) => {
    setState(s);
    setShowAnswer(false);
    setAnswerPage(null);
    shownAt.current = Date.now();
    setElapsed(0);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.get<StudyState>(`/api/study/${deckId}${q}`));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [deckId, q, apply, toast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, dark]);

  const card = state?.card ?? null;

  // timer
  useEffect(() => {
    if (!card) return;
    const t = setInterval(() => setElapsed(Date.now() - shownAt.current), 1000);
    return () => clearInterval(t);
  }, [card?.id]);

  // learning cards becoming due while on the congrats screen
  useEffect(() => {
    if (card || !state?.nextLearnDue) return;
    const ms = state.nextLearnDue * 1000 - Date.now();
    if (ms > 30 * 60_000) return;
    const t = setTimeout(load, Math.max(1000, ms + 500));
    return () => clearTimeout(t);
  }, [card, state?.nextLearnDue, load]);

  const reveal = useCallback(async () => {
    if (!card || showAnswer) return;
    if (card.hasTypeAnswer) {
      const typed = await frame.current?.getTyped();
      try {
        const r = await api.post<{ answer: string }>("/api/study/answer-page", { cardId: card.id, typed: typed ?? "", night: dark, platform: "web" });
        setAnswerPage(r.answer);
      } catch {
        setAnswerPage(card.answer);
      }
    } else setAnswerPage(card.answer);
    setShowAnswer(true);
  }, [card, showAnswer, dark]);

  const answer = useCallback(
    async (ease: number) => {
      if (!card || !showAnswer || busy) return;
      setBusy(true);
      try {
        const s = await api.post<StudyState>(`/api/study/${deckId}/answer${q}`, { cardId: card.id, ease, timeMs: Date.now() - shownAt.current });
        sessionCount.current++;
        setSession((p) => ({ count: p.count + 1, again: p.again + (ease === 1 ? 1 : 0), ms: p.ms + Math.min(Date.now() - shownAt.current, (card.options.capAnswerSecs || 60) * 1000) }));
        if (s.answered?.leech) toast(s.answered.suspended ? "Leech: card suspended" : "Leech: card tagged 'leech'", "info");
        const tb = s.timeboxMins;
        if (tb > 0 && Date.now() - sessionStart.current > tb * 60_000) {
          toast(`${sessionCount.current} cards studied in ${Math.round((Date.now() - sessionStart.current) / 60000)} minutes`, "success");
          sessionStart.current = Date.now();
          sessionCount.current = 0;
        }
        apply(s);
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setBusy(false);
      }
    },
    [card, showAnswer, busy, deckId, q, apply, toast],
  );

  const doUndo = useCallback(async () => {
    try {
      const s = await api.post<StudyState>(`/api/study/${deckId}/undo${q}`);
      if (s.undone) toast(`Undid ${s.undone}`, "info");
      apply(s);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [deckId, q, apply, toast]);

  const action = useCallback(
    async (act: string, extra: Record<string, unknown> = {}, msg?: string) => {
      if (!card) return;
      try {
        const s = await api.post<StudyState>(`/api/study/${deckId}/action${q}`, { cardId: card.id, action: act, ...extra });
        if (msg) toast(msg, "info", { label: "Undo", onClick: doUndo });
        if (act === "flag" || act === "mark") {
          // keep the current side
          setState((prev) => (prev && s.card && prev.card?.id === s.card.id ? { ...prev, card: { ...prev.card!, flags: s.card.flags, marked: s.card.marked }, undo: s.undo } : s));
        } else apply(s);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [card, deckId, q, apply, toast, doUndo],
  );

  const setDue = useCallback(async () => {
    const days = await dialogs.prompt({ title: "Set due date", label: "Days from today (e.g. 0 = today, 1-7 = random range, 5! = also set interval)", value: "1", confirm: "Set" });
    if (days) action("setDue", { days }, "Due date changed");
  }, [dialogs, action]);

  const deleteNote = useCallback(async () => {
    if (await dialogs.confirm({ title: "Delete note?", body: "This deletes the note and all of its cards.", confirm: "Delete", danger: true })) action("delete", {}, "Note deleted");
  }, [dialogs, action]);

  const handleKey = useCallback(
    (e: { key: string; code?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean; preventDefault?: () => void }) => {
      const mod = e.ctrl || e.meta;
      if (editNote || infoCard || custom) return;
      if (mod && e.key === "z") return doUndo();
      if (mod && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")) {
        e.preventDefault?.();
        return bumpZoom(e.key === "-" ? -0.1 : e.key === "0" ? 0 : 0.1);
      }
      if (mod && /^[1-7]$/.test(e.key)) {
        e.preventDefault?.();
        return action("flag", { flag: Number(e.key) });
      }
      if (mod) return;
      switch (e.key) {
        case " ":
        case "Enter":
          e.preventDefault?.();
          return showAnswer ? answer(3) : reveal();
        case "1":
        case "2":
        case "3":
        case "4":
          return showAnswer ? answer(Number(e.key)) : undefined;
        case "u":
          return doUndo();
        case "e":
          return card && setEditNote(card.nid);
        case "i":
          return card && setInfoCard(card.id);
        case "r":
        case "F5":
          return frame.current?.replay();
        case "-":
          return action("bury", {}, "Card buried");
        case "=":
          return action("buryNote", {}, "Note buried");
        case "@":
          return action("suspend", {}, "Card suspended");
        case "!":
          return action("suspendNote", {}, "Note suspended");
        case "*":
          return action("mark");
        case "Escape":
          return navigate(`/deck/${deckId}`);
        case "Delete":
          return deleteNote();
      }
    },
    [showAnswer, answer, reveal, doUndo, card, action, navigate, deckId, deleteNote, editNote, infoCard, custom, bumpZoom],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      handleKey({ key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey, preventDefault: () => e.preventDefault() });
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [handleKey]);

  // auto advance
  useEffect(() => {
    if (!card) return;
    const o = card.options;
    if (!showAnswer && o.autoAdvanceQuestionSecs > 0) {
      const t = setTimeout(reveal, o.autoAdvanceQuestionSecs * 1000);
      return () => clearTimeout(t);
    }
    if (showAnswer && o.autoAdvanceAnswerSecs > 0) {
      const t = setTimeout(() => {
        const a = o.autoAdvanceAnswerAction;
        if (a === 0) action("bury");
        else if (a === 1) answer(1);
        else if (a === 2) answer(3);
        else if (a === 3) answer(2);
        else toast("Time's up", "info");
      }, o.autoAdvanceAnswerSecs * 1000);
      return () => clearTimeout(t);
    }
  }, [card, showAnswer, reveal, answer, action, toast]);

  if (!state) return <Loading />;

  const counts = state.counts;
  const total = counts.new + counts.learn + counts.review;
  const done = state.today.cards;
  const progress = done + total ? (done / (done + total)) * 100 : 100;
  const qn = card?.queueName;
  const flag = FLAGS.find((f) => f.n === card?.flags);

  const countCls = (n: number, which: string, color: string) => cx("tnum", n ? color : "text-faint", qn === which && "underline decoration-2 underline-offset-4");

  return (
    <div className="flex flex-col h-full bg-app">
      {/* top bar */}
      <header className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 h-14 border-b border-app bg-panel">
        <IconButton label="Back (Esc)" onClick={() => navigate(`/deck/${deckId}`)}>
          <ArrowLeft className="size-5" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight">{state.deck.name.split("::").pop()}</div>
          {card && card.deckName !== state.deck.name && <div className="truncate text-[11px] text-muted leading-tight">{card.deckName.split("::").slice(-2).join(" / ")}</div>}
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold mx-1">
          <span title="New" className={countCls(counts.new, "new", "text-new")}>{counts.new}</span>
          <span title="Learning" className={countCls(counts.learn, "learn", "text-learn")}>{counts.learn}</span>
          <span title="To review" className={countCls(counts.review, "review", "text-due")}>{counts.review}</span>
        </div>
        {card?.options.showTimer && (
          <span className="hidden sm:inline-flex items-center gap-1 text-xs text-muted tnum w-12">
            <Clock className="size-3.5" />
            {Math.min(Math.floor(elapsed / 1000), card.options.capAnswerSecs)}s
          </span>
        )}
        {flag && <Flag className="size-4 mx-1" style={{ color: flag.color, fill: flag.color }} />}
        {card?.marked && <Star className="size-4 mx-1 text-amber-500 fill-amber-500" />}
        <IconButton label="Undo (Ctrl+Z)" onClick={doUndo} disabled={!state.undo.available}>
          <Undo2 className="size-[18px]" />
        </IconButton>
        {card && (
          <Menu
            trigger={(t) => (
              <IconButton label="More" onClick={t}>
                <MoreHorizontal className="size-5" />
              </IconButton>
            )}
            items={[
              { label: "Edit note", icon: <Pencil />, shortcut: "E", onClick: () => setEditNote(card.nid) },
              { label: "Card info", icon: <Info />, shortcut: "I", onClick: () => setInfoCard(card.id) },
              { label: "Replay audio", icon: <Volume2 />, shortcut: "R", onClick: () => frame.current?.replay() },
              { label: `Zoom in (${Math.round(zoom * 100)}%)`, icon: <ZoomIn />, shortcut: "Ctrl+=", onClick: () => bumpZoom(0.1) },
              { label: "Zoom out", icon: <ZoomOut />, shortcut: "Ctrl+-", onClick: () => bumpZoom(-0.1) },
              { divider: true, label: "" },
              { label: card.marked ? "Unmark note" : "Mark note", icon: <Star />, shortcut: "*", onClick: () => action("mark") },
              ...FLAGS.map((f) => ({ label: `${card.flags === f.n ? "Remove" : ""} ${f.name} flag`.trim(), icon: <Flag style={{ color: f.color, fill: card.flags === f.n ? f.color : "none" }} />, shortcut: `Ctrl+${f.n}`, onClick: () => action("flag", { flag: f.n }) })),
              { divider: true, label: "" },
              { label: "Bury card", icon: <EyeOff />, shortcut: "-", onClick: () => action("bury", {}, "Card buried") },
              { label: "Bury note", icon: <EyeOff />, shortcut: "=", onClick: () => action("buryNote", {}, "Note buried") },
              { label: "Suspend card", icon: <PauseCircle />, shortcut: "@", onClick: () => action("suspend", {}, "Card suspended") },
              { label: "Suspend note", icon: <PauseCircle />, shortcut: "!", onClick: () => action("suspendNote", {}, "Note suspended") },
              { label: "Set due date", icon: <CalendarClock />, onClick: setDue },
              { label: "Reset (forget)", icon: <RotateCcw />, onClick: () => action("forget", {}, "Card reset to new") },
              { divider: true, label: "" },
              { label: "Options", icon: <Settings2 />, onClick: () => navigate(`/options/${deckId}`) },
              { label: "Delete note", icon: <Trash2 />, danger: true, shortcut: "Del", onClick: deleteNote },
            ]}
          />
        )}
      </header>
      <div className="h-0.5 bg-panel-2" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Today's progress">
        <div className="h-full bg-brand-500 transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>

      {card ? (
        <>
          <div className="flex-1 min-h-0 sm:px-6 sm:pt-6">
            <div className="relative mx-auto h-full max-w-[860px] overflow-hidden bg-panel sm:rounded-xl sm:border sm:border-app">
              <CardFrame ref={frame} key={`${card.id}-${showAnswer ? "a" : "q"}`} html={zoomed(showAnswer ? (answerPage ?? card.answer) : card.question)} onKey={handleKey} onMessage={(type) => (type === "showAnswer" ? reveal() : type === "doubleTap" && state.undo.available && doUndo())} className="absolute inset-0 w-full h-full border-0" />
            </div>
          </div>
          <footer className="border-t border-app bg-panel sm:border-0 sm:bg-transparent px-3 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-6">
            <div className="mx-auto max-w-[560px]">
              {!showAnswer ? (
                <Button variant="primary" size="lg" className="w-full h-12" onClick={reveal}>
                  Show answer <Kbd onBrand className="hidden sm:inline-flex ml-1">Space</Kbd>
                </Button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {BUTTONS.map((b) => {
                    const info = card.buttons.find((x) => x.ease === b.ease);
                    return (
                      <button key={b.ease} disabled={busy} onClick={() => answer(b.ease)} title={`${b.label} (${b.ease})`} className={cx("panel flex h-14 flex-col items-center justify-center rounded-lg transition-colors hover:bg-panel-2 active:bg-panel-2 disabled:opacity-60", b.hover)}>
                        <span className={cx("text-sm font-semibold", b.text)}>{b.label}</span>
                        <span className="mt-0.5 text-xs text-muted tnum">{info?.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </footer>
        </>
      ) : (
        <Congrats state={state} deckId={deckId} session={session} onCustom={() => setCustom(true)} onReload={load} />
      )}
      <EditNoteDialog noteId={editNote} onClose={() => setEditNote(null)} onSaved={load} />
      <CardInfoDialog cardId={infoCard} onClose={() => setInfoCard(null)} />
      {custom && <CustomStudyDialog deckId={deckId} onClose={() => setCustom(false)} />}
    </div>
  );
}

function Congrats({ state, deckId, session, onCustom, onReload }: { state: StudyState; deckId: number; session: { count: number; again: number; ms: number }; onCustom: () => void; onReload: () => void }) {
  const nextIn = state.nextLearnDue ? Math.max(0, Math.round((state.nextLearnDue * 1000 - Date.now()) / 60000)) : null;
  const t = state.today;
  return (
    <div className="flex-1 overflow-y-auto flex items-center justify-center p-6">
      <div className="w-full max-w-sm text-center">
        <h2 className="text-2xl font-semibold">{session.count ? "Session complete" : "All done"}</h2>
        <p className="text-muted mt-1.5 text-sm">You've finished this deck for now.</p>
        <div className="mt-7 grid grid-cols-3 gap-4">
          <Stat value={session.count} label="this session" valueClass="text-brand-600 dark:text-brand-400" />
          <Stat value={t.cards} label="today" />
          <Stat value={t.cards ? `${Math.round(((t.cards - t.again) / t.cards) * 100)}%` : "–"} label="correct" valueClass={t.cards ? "text-due" : "text-faint"} />
        </div>
        {nextIn !== null && <p className="mt-6 text-sm text-muted">The next learning card is ready in {nextIn < 1 ? "less than a minute" : `${nextIn} minute${nextIn === 1 ? "" : "s"}`}.</p>}
        <div className="flex flex-col gap-2 mt-8">
          <Link to="/">
            <Button variant="primary" className="w-full">
              Back to decks
            </Button>
          </Link>
          {state.deck.kind === 0 && <Button onClick={onCustom}>Custom study session</Button>}
          {state.buried > 0 && (
            <Button
              onClick={async () => {
                await api.post(`/api/decks/${deckId}/unbury`);
                onReload();
              }}
            >
              Unbury {state.buried} card{state.buried === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
