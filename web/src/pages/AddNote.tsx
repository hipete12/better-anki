import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, Plus, History, Check } from "lucide-react";
import { api, type Notetype } from "../lib/api";
import { useApi, useLocalStorage, useIsDark } from "../lib/hooks";
import { Button, Card, Field, Loading, Modal, PageHeader, Select, Tabs, useToast } from "../components/ui";
import NoteEditor from "../components/NoteEditor";
import CardFrame from "../components/CardFrame";
import EditNoteDialog from "../components/EditNoteDialog";

export default function AddNote() {
  const [params] = useSearchParams();
  const nts = useApi(() => api.get<Notetype[]>("/api/notetypes"), [], { live: ["notetypes"] });
  const decks = useApi(() => api.get<{ id: number; name: string; kind: number }[]>("/api/decks/list"), [], { live: ["decks"] });
  const cfg = useApi(() => api.get<{ lastNotetypeId: number; lastDeckId: number; currentDeckId: number }>("/api/config"), []);
  const [ntid, setNtid] = useState(0);
  const [did, setDid] = useState(0);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useLocalStorage<string[]>("ba.add.tags", []);
  const [stickyMap, setStickyMap] = useLocalStorage<Record<string, boolean[]>>("ba.add.sticky", {});
  const [dupe, setDupe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<{ id: number; text: string }[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const toast = useToast();

  useEffect(() => {
    if (!nts.data || !cfg.data || ntid) return;
    const nt = nts.data.find((n) => n.id === cfg.data!.lastNotetypeId) ?? nts.data.find((n) => n.name === "Basic") ?? nts.data[0];
    setNtid(nt.id);
    setDid(Number(params.get("deck")) || cfg.data.lastDeckId || cfg.data.currentDeckId || 1);
  }, [nts.data, cfg.data, ntid, params]);

  const nt = nts.data?.find((n) => n.id === ntid);
  const sticky = useMemo(() => (nt ? (stickyMap[nt.id] ?? nt.fields.map((f) => !!f.sticky)) : []), [nt, stickyMap]);

  useEffect(() => {
    if (nt) setFields((old) => nt.fields.map((_, i) => old[i] ?? ""));
  }, [nt]);

  // duplicate check while typing
  useEffect(() => {
    if (!nt || !fields[0]) return setDupe(false);
    const t = setTimeout(() => {
      api.post<{ duplicate: boolean }>("/api/notes/check", { notetypeId: nt.id, fields }).then((r) => setDupe(r.duplicate)).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [fields, nt]);

  const add = async () => {
    if (!nt || busy) return;
    setBusy(true);
    try {
      const r = await api.post<{ id: number; cards: number }>("/api/notes", { notetypeId: nt.id, deckId: did, fields, tags });
      toast(`Added ${r.cards} card${r.cards === 1 ? "" : "s"}`, "success");
      setHistory((h) => [{ id: r.id, text: fields[0].replace(/<[^>]+>/g, "").slice(0, 60) || "(empty)" }, ...h].slice(0, 20));
      setFields(nt.fields.map((_, i) => (sticky[i] ? fields[i] : "")));
      setResetKey((k) => k + 1);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!nts.data || !decks.data) return <Loading />;
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10" onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && (e.preventDefault(), add())}>
      <PageHeader
        title="Add"
        subtitle="Ctrl+Enter to add · Ctrl+Shift+C for cloze"
        actions={
          <>
            <Button onClick={() => setPreview(true)} disabled={!nt}>
              <Eye className="size-4" /> Preview
            </Button>
            <Button variant="primary" onClick={add} loading={busy}>
              <Plus className="size-4" /> Add
            </Button>
          </>
        }
      />
      <Card className="p-5 sm:p-6">
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          <Field label="Type">
            <Select value={ntid} onChange={(e) => setNtid(+e.target.value)}>
              {nts.data.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Deck">
            <Select value={did} onChange={(e) => setDid(+e.target.value)}>
              {decks.data
                .filter((d) => d.kind === 0)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        {nt && (
          <NoteEditor
            key={`${nt.id}-${resetKey}`}
            notetype={nt}
            fields={fields}
            onFieldsChange={setFields}
            tags={tags}
            onTagsChange={setTags}
            sticky={sticky}
            onToggleSticky={(i) => setStickyMap({ ...stickyMap, [nt.id]: sticky.map((s, j) => (j === i ? !s : s)) })}
            autoFocus
            dupe={dupe}
          />
        )}
      </Card>
      {history.length > 0 && (
        <Card className="mt-4 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2">
            <History className="size-4" /> Added this session
          </div>
          <div className="divide-y divide-[var(--border)]">
            {history.map((h) => (
              <button key={h.id} onClick={() => setEditId(h.id)} className="w-full flex items-center gap-2 py-2 text-sm text-left hover:text-brand-600">
                <Check className="size-4 text-green-500" /> <span className="truncate">{h.text}</span>
              </button>
            ))}
          </div>
        </Card>
      )}
      {preview && nt && <PreviewDialog nt={nt} fields={fields} tags={tags} onClose={() => setPreview(false)} />}
      <EditNoteDialog noteId={editId} onClose={() => setEditId(null)} />
    </div>
  );
}

export function PreviewDialog({ nt, fields, tags, onClose }: { nt: Notetype; fields: string[]; tags: string[]; onClose: () => void }) {
  const dark = useIsDark();
  const [side, setSide] = useState<"question" | "answer">("question");
  const [ord, setOrd] = useState(0);
  const { data } = useApi(() => api.post<{ question: string; answer: string; ords: number[] }>("/api/render/preview", { notetype: nt, fields, ord, tags: tags.join(" "), night: dark }), [ord, dark]);
  const ords = data?.ords.length ? data.ords : [0];
  return (
    <Modal open onClose={onClose} title="Preview" wide>
      <div className="flex flex-wrap gap-2 justify-between mb-3">
        <Tabs
          value={side}
          onChange={setSide}
          tabs={[
            { value: "question", label: "Front" },
            { value: "answer", label: "Back" },
          ]}
        />
        {ords.length > 1 && (
          <Select value={ord} onChange={(e) => setOrd(+e.target.value)} className="w-auto">
            {ords.map((o) => (
              <option key={o} value={o}>
                {nt.kind === 1 ? `Cloze ${o + 1}` : nt.templates[o]?.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="h-[55vh] rounded-xl border border-app overflow-hidden">{data ? <CardFrame html={side === "question" ? data.question : data.answer} /> : <Loading />}</div>
    </Modal>
  );
}
