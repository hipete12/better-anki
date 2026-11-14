import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { Button, Field, Input, Modal, Select, Switch, useToast, IconButton } from "./ui";

export const FILTER_ORDERS = ["Oldest seen first", "Random", "Increasing intervals", "Decreasing intervals", "Most lapses", "Order added", "Order due", "Latest added first", "Retrievability ascending", "Retrievability descending", "Relative overdueness"];

interface Term {
  search: string;
  limit: number;
  order: number;
}

export default function FilteredDeckDialog({ open, deckId, onClose, onDone, initialSearch }: { open: boolean; deckId?: number; onClose: () => void; onDone?: (id: number) => void; initialSearch?: string }) {
  const [name, setName] = useState("Filtered Deck 1");
  const [terms, setTerms] = useState<Term[]>([{ search: "is:due", limit: 100, order: 6 }]);
  const [reschedule, setReschedule] = useState(true);
  const [preview, setPreview] = useState([60, 600, 0]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    if (deckId) {
      api.get<{ deck: { name: string; filtered: { terms: Term[]; reschedule: boolean; previewAgainSecs: number; previewHardSecs: number; previewGoodSecs: number } } }>(`/api/decks/${deckId}`).then((r) => {
        setName(r.deck.name);
        setTerms(r.deck.filtered.terms);
        setReschedule(r.deck.filtered.reschedule);
        setPreview([r.deck.filtered.previewAgainSecs, r.deck.filtered.previewHardSecs, r.deck.filtered.previewGoodSecs]);
      });
    } else {
      setName(`Filtered Deck ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      setTerms([{ search: initialSearch ?? "is:due", limit: 100, order: 6 }]);
      setReschedule(true);
    }
  }, [open, deckId, initialSearch]);
  const save = async () => {
    setBusy(true);
    try {
      const cfg = { terms, reschedule, previewAgainSecs: preview[0], previewHardSecs: preview[1], previewGoodSecs: preview[2] };
      let id = deckId;
      if (deckId) {
        await api.patch(`/api/decks/${deckId}`, { name, filtered: cfg });
        const r = await api.post<{ count: number }>(`/api/decks/${deckId}/rebuild`);
        toast(`Rebuilt with ${r.count} cards`, "success");
      } else {
        const r = await api.post<{ deck: { id: number }; count: number }>("/api/decks/filtered", { name, ...cfg });
        id = r.deck.id;
        toast(`Created with ${r.count} cards`, r.count ? "success" : "info");
      }
      onDone?.(id!);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const upd = (i: number, p: Partial<Term>) => setTerms(terms.map((t, j) => (j === i ? { ...t, ...p } : t)));
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={deckId ? "Edit filtered deck" : "Create filtered deck"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {deckId ? "Rebuild" : "Build"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {terms.map((t, i) => (
          <div key={i} className="rounded-xl border border-app p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{i === 0 ? "Filter" : "Second filter"}</span>
              {i > 0 && (
                <IconButton label="Remove filter" onClick={() => setTerms(terms.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </IconButton>
              )}
            </div>
            <Field label="Search" hint='Anki search syntax, e.g. deck:"Spanish" is:due, tag:hard, rated:7:1, prop:ivl>30'>
              <Input value={t.search} onChange={(e) => upd(i, { search: e.target.value })} className="font-mono" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Limit">
                <Input type="number" min={1} value={t.limit} onChange={(e) => upd(i, { limit: +e.target.value })} />
              </Field>
              <Field label="Order">
                <Select value={t.order} onChange={(e) => upd(i, { order: +e.target.value })}>
                  {FILTER_ORDERS.map((o, j) => (
                    <option key={j} value={j}>
                      {o}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        ))}
        {terms.length < 2 && (
          <Button size="sm" variant="ghost" onClick={() => setTerms([...terms, { search: "", limit: 20, order: 1 }])}>
            <Plus className="size-4" /> Add second filter
          </Button>
        )}
        <Switch checked={reschedule} onChange={setReschedule} label="Reschedule cards based on my answers in this deck" hint="Off = preview mode: answers don't affect scheduling" />
        {!reschedule && (
          <div className="grid grid-cols-3 gap-3">
            {["Again (secs)", "Hard (secs)", "Good (secs, 0 = return)"].map((l, i) => (
              <Field key={l} label={l}>
                <Input type="number" min={0} value={preview[i]} onChange={(e) => setPreview(preview.map((p, j) => (j === i ? +e.target.value : p)))} />
              </Field>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
