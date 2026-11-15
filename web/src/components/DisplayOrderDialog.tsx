// Display order: choose which front/back layout the selected cards use, or make a new one.
// A layout is a copy of the cards' note type with that card type's template changed (see server/src/layouts.ts),
// so assigning one only affects the selected cards and keeps their review history.
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { Button, cx, Field, Input, Loading, Modal, Textarea, useToast } from "./ui";

interface LayoutOption {
  notetypeId: number;
  name: string;
  isDefault: boolean;
  qfmt: string;
  afmt: string;
  selected: number;
}
type Options = { ok: false; reason: string } | { ok: true; notetype: string; cardType: string; fields: string[]; options: LayoutOption[] };

const NEW = -1;

export default function DisplayOrderDialog({ cardIds, onClose, onDone }: { cardIds: number[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", qfmt: "", afmt: "" });
  const [busy, setBusy] = useState(false);
  const lastFocus = useRef<{ el: HTMLTextAreaElement; key: "qfmt" | "afmt" } | null>(null);

  useEffect(() => {
    api
      .post<Options>("/api/layouts/options", { cardIds })
      .then((d) => {
        setData(d);
        if (d.ok) {
          // start on the layout most of the selected cards use
          const current = [...d.options].sort((a, b) => b.selected - a.selected)[0];
          setChoice(current.notetypeId);
          setDraft({ name: "", qfmt: current.qfmt, afmt: current.afmt });
        }
      })
      .catch((e) => setError((e as Error).message));
  }, [cardIds]);

  const opts = data?.ok ? data.options : [];
  const chosen = opts.find((o) => o.notetypeId === choice);
  const unchanged = !!chosen && chosen.selected === cardIds.length;
  const canApply = choice === NEW ? !!draft.name.trim() && !!draft.qfmt.trim() : choice !== null && !unchanged;

  const insertField = (name: string) => {
    const f = lastFocus.current;
    const token = `{{${name}}}`;
    if (!f) return setDraft((d) => ({ ...d, qfmt: d.qfmt + token }));
    const { el, key } = f;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const value = el.value.slice(0, start) + token + el.value.slice(end);
    setDraft((d) => ({ ...d, [key]: value }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const apply = async () => {
    setBusy(true);
    try {
      if (choice === NEW) {
        const r = await api.post<{ changed: number }>("/api/layouts?history=browse", { cardIds, ...draft });
        toast(`Created "${draft.name.trim()}" for ${r.changed} card${r.changed === 1 ? "" : "s"}`, "success");
      } else {
        const r = await api.post<{ changed: number }>("/api/layouts/assign?history=browse", { cardIds, notetypeId: choice });
        toast(`${r.changed} card${r.changed === 1 ? "" : "s"} now use "${chosen?.name}"`, "success");
      }
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Display order"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {data && !data.ok ? "Close" : "Cancel"}
          </Button>
          {data?.ok && (
            <Button variant="primary" disabled={!canApply || busy} onClick={apply}>
              {choice === NEW ? "Create and apply" : "Apply"}
            </Button>
          )}
        </>
      }
    >
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !data ? (
        <Loading />
      ) : !data.ok ? (
        <p className="text-sm text-muted">{data.reason}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-muted">
            Choose what the front and back of {cardIds.length === 1 ? "this card" : `these ${cardIds.length} cards`} show. Only the selected cards change, and they keep their review history.
            <span className="block mt-0.5 text-faint">
              {data.notetype} · {data.cardType}
            </span>
          </p>
          <div className="rounded-xl border border-app divide-y divide-[var(--border)]" role="radiogroup" aria-label="Layouts">
            {opts.map((o) => (
              <LayoutRow key={o.notetypeId} checked={choice === o.notetypeId} onSelect={() => setChoice(o.notetypeId)} title={o.name} note={o.selected === cardIds.length ? "Current" : o.selected ? `${o.selected} selected use this` : undefined}>
                <TemplateLine label="Front" value={o.qfmt} />
                <TemplateLine label="Back" value={o.afmt} />
              </LayoutRow>
            ))}
            <LayoutRow checked={choice === NEW} onSelect={() => setChoice(NEW)} title={<span className="inline-flex items-center gap-1.5"><Plus className="size-3.5" /> New layout</span>}>
              <span className="text-xs text-muted">Start from the selected layout and change the front or back.</span>
            </LayoutRow>
          </div>

          {choice === NEW && (
            <div className="space-y-3">
              <Field label="Name">
                <Input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. English → Spanish" />
              </Field>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                Insert field:
                {[...data.fields, "FrontSide"].map((f) => (
                  <button key={f} type="button" onClick={() => insertField(f)} className="rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-[12px] text-app hover:bg-[var(--border)]">
                    {`{{${f}}}`}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Front template">
                  <Textarea rows={6} value={draft.qfmt} onFocus={(e) => (lastFocus.current = { el: e.currentTarget, key: "qfmt" })} onChange={(e) => setDraft({ ...draft, qfmt: e.target.value })} spellCheck={false} className="w-full resize-y" />
                </Field>
                <Field label="Back template" hint="{{FrontSide}} repeats the front.">
                  <Textarea rows={6} value={draft.afmt} onFocus={(e) => (lastFocus.current = { el: e.currentTarget, key: "afmt" })} onChange={(e) => setDraft({ ...draft, afmt: e.target.value })} spellCheck={false} className="w-full resize-y" />
                </Field>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function LayoutRow({ checked, onSelect, title, note, children }: { checked: boolean; onSelect: () => void; title: React.ReactNode; note?: string; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onSelect} className={cx("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl", checked ? "bg-brand-500/8" : "hover:bg-panel-2/60")}>
      <span className={cx("mt-1 grid size-4 shrink-0 place-items-center rounded-full border", checked ? "border-brand-600 dark:border-brand-400" : "border-strong")}>
        {checked && <span className="size-2 rounded-full bg-brand-600 dark:bg-brand-400" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{title}</span>
          {note && <span className="text-xs text-muted">{note}</span>}
        </span>
        <span className="mt-1 block space-y-0.5">{children}</span>
      </span>
    </button>
  );
}

function TemplateLine({ label, value }: { label: string; value: string }) {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return (
    <span className="flex gap-2 text-xs">
      <span className="w-10 shrink-0 text-faint">{label}</span>
      <span className="truncate font-mono text-[12px] text-muted">{oneLine || "(empty)"}</span>
    </span>
  );
}
