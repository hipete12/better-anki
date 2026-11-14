import { useEffect, useRef, useState } from "react";
import { UploadCloud, FileArchive, FileText, CheckCircle2 } from "lucide-react";
import { api, type Notetype } from "../lib/api";
import { Button, Modal, Select, Switch, Field, useToast, cx, Badge } from "./ui";

interface PackageResult {
  notesAdded: number;
  notesUpdated: number;
  notesSkipped: number;
  cardsAdded: number;
  decks: string[];
  notetypes: string[];
  media: number;
  revlog: number;
  warnings: string[];
}
interface CsvPreview {
  delimiter: string;
  html: boolean;
  columns: string[];
  rows: string[][];
  notetype?: string;
  deck?: string;
  tags: string[];
  tagsColumn?: number;
}

export default function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [scheduling, setScheduling] = useState(true);
  const [updateMode, setUpdateMode] = useState("ifNewer");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PackageResult | null>(null);
  const [csv, setCsv] = useState<{ token: string; preview: CsvPreview } | null>(null);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setFile(null);
      setResult(null);
      setCsv(null);
    }
  }, [open]);

  const isPackage = file && /\.(apkg|colpkg|zip)$/i.test(file.name);

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("options", JSON.stringify({ includeScheduling: scheduling, updateNotes: updateMode }));
      const res = await api.post<{ kind: "package"; result: PackageResult } | { kind: "text"; token: string; preview: CsvPreview }>("/api/import", fd);
      if (res.kind === "package") {
        setResult(res.result);
        onDone?.();
      } else setCsv({ token: res.token, preview: res.preview });
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Import" wide={!!csv}>
      {result ? (
        <div className="text-center py-4">
          <CheckCircle2 className="size-12 text-green-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold">Import complete</h3>
          <div className="grid grid-cols-2 gap-2 mt-5 text-sm text-left">
            <Stat label="Notes added" v={result.notesAdded} />
            <Stat label="Cards added" v={result.cardsAdded} />
            <Stat label="Notes updated" v={result.notesUpdated} />
            <Stat label="Duplicates skipped" v={result.notesSkipped} />
            <Stat label="Media files" v={result.media} />
            <Stat label="Review history" v={result.revlog} />
          </div>
          {result.decks.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 justify-center">
              {result.decks.map((d) => (
                <Badge key={d} color="brand">
                  {d}
                </Badge>
              ))}
            </div>
          )}
          {result.warnings.length > 0 && <div className="mt-3 text-xs text-amber-600">{result.warnings.slice(0, 5).join(" · ")}</div>}
          <Button variant="primary" className="mt-6 w-full" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : csv ? (
        <CsvMapper token={csv.token} preview={csv.preview} onDone={() => (onDone?.(), onClose())} />
      ) : (
        <div className="space-y-4">
          <div
            onDragOver={(e) => (e.preventDefault(), setDrag(true))}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={cx("cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition", drag ? "border-brand-500 bg-brand-500/5" : "border-app hover:border-brand-400")}
          >
            <input ref={inputRef} type="file" accept=".apkg,.colpkg,.zip,.txt,.csv,.tsv" hidden onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                {isPackage ? <FileArchive className="size-8 text-brand-500" /> : <FileText className="size-8 text-brand-500" />}
                <div className="text-left">
                  <div className="font-medium">{file.name}</div>
                  <div className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                </div>
              </div>
            ) : (
              <>
                <UploadCloud className="size-10 text-brand-500 mx-auto mb-2" />
                <div className="font-medium">Drop an Anki deck here</div>
                <div className="text-xs text-muted mt-1">.apkg, .colpkg (shared decks &amp; backups) or .txt / .csv</div>
              </>
            )}
          </div>
          {isPackage && (
            <div className="space-y-3">
              <Switch checked={scheduling} onChange={setScheduling} label="Include scheduling information" hint="Keep review history, due dates and FSRS memory state. Turn off to start fresh." />
              <Field label="Existing notes">
                <Select value={updateMode} onChange={(e) => setUpdateMode(e.target.value)}>
                  <option value="ifNewer">Update if the incoming note is newer</option>
                  <option value="always">Always update</option>
                  <option value="never">Never update</option>
                </Select>
              </Field>
            </div>
          )}
          <p className="text-xs text-muted">The file is decoded in server memory and stored encrypted. No plaintext copy is written to disk.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!file} loading={busy} onClick={run}>
              Import
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-xl bg-panel-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold tabular-nums">{v}</div>
    </div>
  );
}

function CsvMapper({ token, preview: initial, onDone }: { token: string; preview: CsvPreview; onDone: () => void }) {
  const [preview, setPreview] = useState(initial);
  const [notetypes, setNotetypes] = useState<Notetype[]>([]);
  const [decks, setDecks] = useState<{ id: number; name: string; kind: number }[]>([]);
  const [ntid, setNtid] = useState<number>(0);
  const [did, setDid] = useState<number>(1);
  const [map, setMap] = useState<number[]>([]);
  const [tagsCol, setTagsCol] = useState<number>(initial.tagsColumn ?? -1);
  const [html, setHtml] = useState(initial.html);
  const [dupe, setDupe] = useState("update");
  const [header, setHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    Promise.all([api.get<Notetype[]>("/api/notetypes"), api.get<typeof decks>("/api/decks/list")]).then(([n, d]) => {
      setNotetypes(n);
      setDecks(d.filter((x) => x.kind === 0));
      const pick = n.find((x) => x.name === initial.notetype) ?? n.find((x) => x.name === "Basic") ?? n[0];
      setNtid(pick.id);
      const dk = d.find((x) => x.name === initial.deck);
      if (dk) setDid(dk.id);
    });
  }, [initial]);
  const nt = notetypes.find((n) => n.id === ntid);
  useEffect(() => {
    if (nt) setMap(nt.fields.map((_, i) => (i < preview.columns.length ? i : -1)));
  }, [ntid, notetypes.length]); // eslint-disable-line
  const changeDelim = async (d: string) => setPreview(await api.post<CsvPreview>("/api/import/csv/preview", { token, delimiter: d }));
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ added: number; updated: number; skipped: number; errors: string[] }>("/api/import/csv", { token, notetypeId: ntid, deckId: did, fieldColumns: map, tagsColumn: tagsCol, html, dupeMode: dupe, firstRowIsHeader: header, delimiter: preview.delimiter });
      toast(`Imported ${r.added} new, ${r.updated} updated, ${r.skipped} skipped${r.errors.length ? `, ${r.errors.length} errors` : ""}`, r.errors.length ? "error" : "success");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const colOptions = preview.columns.map((c, i) => (
    <option key={i} value={i}>
      {c}
    </option>
  ));
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Separator">
          <Select value={preview.delimiter} onChange={(e) => changeDelim(e.target.value)}>
            <option value={"\t"}>Tab</option>
            <option value=",">Comma</option>
            <option value=";">Semicolon</option>
            <option value="|">Pipe</option>
            <option value=" ">Space</option>
          </Select>
        </Field>
        <Field label="Note type">
          <Select value={ntid} onChange={(e) => setNtid(+e.target.value)}>
            {notetypes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deck">
          <Select value={did} onChange={(e) => setDid(+e.target.value)}>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="rounded-xl border border-app overflow-x-auto max-h-44">
        <table className="text-xs w-full">
          <thead className="bg-panel-2">
            <tr>
              {preview.columns.map((c, i) => (
                <th key={i} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 6).map((r, i) => (
              <tr key={i} className="border-t border-app">
                {preview.columns.map((_, j) => (
                  <td key={j} className="px-2 py-1 max-w-48 truncate">
                    {r[j]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {nt?.fields.map((f, i) => (
          <Field key={f.name} label={f.name}>
            <Select value={map[i] ?? -1} onChange={(e) => setMap(map.map((m, j) => (j === i ? +e.target.value : m)))}>
              <option value={-1}>(nothing)</option>
              {colOptions}
            </Select>
          </Field>
        ))}
        <Field label="Tags">
          <Select value={tagsCol} onChange={(e) => setTagsCol(+e.target.value)}>
            <option value={-1}>(nothing)</option>
            {colOptions}
          </Select>
        </Field>
        <Field label="If first field matches an existing note">
          <Select value={dupe} onChange={(e) => setDupe(e.target.value)}>
            <option value="update">Update it</option>
            <option value="ignore">Skip</option>
            <option value="duplicate">Import as duplicate</option>
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-6">
        <Switch checked={html} onChange={setHtml} label="Allow HTML in fields" />
        <Switch checked={header} onChange={setHeader} label="First row is a header" />
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={run} loading={busy} disabled={!ntid}>
          Import {preview.rows.length >= 20 ? "" : `${preview.rows.length - (header ? 1 : 0)} rows`}
        </Button>
      </div>
    </div>
  );
}
