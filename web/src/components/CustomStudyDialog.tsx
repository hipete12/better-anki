import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Button, Field, Input, Modal, Select, useToast, cx } from "./ui";

const MODES = [
  { id: "newLimit", label: "Increase today's new card limit", unit: "cards" },
  { id: "reviewLimit", label: "Increase today's review limit", unit: "cards" },
  { id: "forgotten", label: "Review forgotten cards", unit: "days back" },
  { id: "ahead", label: "Review ahead", unit: "days ahead" },
  { id: "previewNew", label: "Preview new cards", unit: "days back (added)" },
  { id: "cram", label: "Study by card state or tag", unit: "cards" },
] as const;

export default function CustomStudyDialog({ deckId, onClose }: { deckId: number; onClose: () => void }) {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("newLimit");
  const [value, setValue] = useState(10);
  const [kind, setKind] = useState("due");
  const [tagsInclude, setTagsInclude] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const tags = useApi(() => api.get<string[]>("/api/tags"), []);
  const navigate = useNavigate();
  const toast = useToast();
  const run = async () => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { mode };
      if (mode === "newLimit" || mode === "reviewLimit") body.value = value;
      else if (mode === "cram") Object.assign(body, { kind, limit: value, tagsInclude });
      else body.days = value;
      const r = await api.post<{ deckId: number }>(`/api/decks/${deckId}/custom-study`, body);
      onClose();
      navigate(`/study/${r.deckId}`);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const m = MODES.find((x) => x.id === mode)!;
  return (
    <Modal
      open
      onClose={onClose}
      title="Custom study"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} loading={busy}>
            Start
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {MODES.map((x) => (
          <button key={x.id} onClick={() => setMode(x.id)} className={cx("w-full text-left rounded-xl border px-3 py-2.5 text-sm transition", mode === x.id ? "border-brand-500 bg-brand-500/8" : "border-app hover:bg-panel-2")}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {mode === "cram" && (
          <Field label="Cards">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="new">New cards only</option>
              <option value="due">Due cards only</option>
              <option value="review">All review cards in random order</option>
              <option value="all">All cards in random order (don't reschedule)</option>
            </Select>
          </Field>
        )}
        <Field label={m.unit[0].toUpperCase() + m.unit.slice(1)}>
          <Input type="number" min={1} value={value} onChange={(e) => setValue(+e.target.value)} />
        </Field>
        {mode === "cram" && (tags.data?.length ?? 0) > 0 && (
          <Field label="Limit to tags (optional)">
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {tags.data!.map((t) => (
                <button key={t} onClick={() => setTagsInclude(tagsInclude.includes(t) ? tagsInclude.filter((x) => x !== t) : [...tagsInclude, t])} className={cx("rounded-full px-2.5 py-1 text-xs border", tagsInclude.includes(t) ? "bg-brand-600 text-white border-brand-600" : "border-app hover:bg-panel-2")}>
                  {t}
                </button>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}
