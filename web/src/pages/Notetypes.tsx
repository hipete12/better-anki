import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Copy, ArrowUp, ArrowDown, LayoutTemplate, ListPlus, Shapes } from "lucide-react";
import { api, type Notetype, type FieldDef, type TemplateDef } from "../lib/api";
import { useApi, useIsDark } from "../lib/hooks";
import { Button, Card, Field, IconButton, Input, Loading, Menu, Modal, PageHeader, Select, Switch, Tabs, useDialogs, useToast, Badge, cx } from "../components/ui";
import CardFrame from "../components/CardFrame";

export default function Notetypes() {
  const list = useApi(() => api.get<Notetype[]>("/api/notetypes"), [], { live: ["notetypes"] });
  const stock = useApi(() => api.get<{ key: string; name: string }[]>("/api/notetypes/stock"), []);
  const [fieldsFor, setFieldsFor] = useState<Notetype | null>(null);
  const [cardsFor, setCardsFor] = useState<Notetype | null>(null);
  const dialogs = useDialogs();
  const toast = useToast();

  const add = async (stockKey?: string, cloneFrom?: number, base?: string) => {
    const name = await dialogs.prompt({ title: "New note type", value: base ?? "", confirm: "Create" });
    if (!name) return;
    try {
      await api.post("/api/notetypes", { stock: stockKey, cloneFrom, name });
      list.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-6 sm:py-10">
      <PageHeader
        title="Note types"
        subtitle="Fields, card templates and styling"
        actions={
          <Menu
            trigger={(t) => (
              <Button variant="primary" onClick={t}>
                <Plus className="size-4" /> Add
              </Button>
            )}
            items={[...(stock.data ?? []).map((s) => ({ label: `Add: ${s.name}`, icon: <Shapes />, onClick: () => add(s.key, undefined, s.name) })), { divider: true, label: "" }, ...(list.data ?? []).map((n) => ({ label: `Clone: ${n.name}`, icon: <Copy />, onClick: () => add(undefined, n.id, `${n.name} copy`) }))]}
          />
        }
      />
      {!list.data ? (
        <Loading />
      ) : (
        <Card className="divide-y divide-[var(--border)]">
          {list.data.map((n) => (
            <div key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-48">
                <div className="font-medium flex items-center gap-2">
                  {n.name} {n.kind === 1 && <Badge color="brand">Cloze</Badge>}
                </div>
                <div className="text-xs text-muted">
                  {n.noteCount ?? 0} notes · {n.fields.length} fields · {n.templates.length} card type{n.templates.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => setFieldsFor(n)}>
                  <ListPlus className="size-4" /> Fields
                </Button>
                <Button size="sm" onClick={() => setCardsFor(n)}>
                  <LayoutTemplate className="size-4" /> Cards
                </Button>
                <IconButton
                  label="Rename"
                  onClick={async () => {
                    const name = await dialogs.prompt({ title: "Rename note type", value: n.name, confirm: "Rename" });
                    if (name) await api.put(`/api/notetypes/${n.id}`, { name }).then(list.reload, (e) => toast(e.message, "error"));
                  }}
                >
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton
                  label="Delete"
                  onClick={async () => {
                    if (await dialogs.confirm({ title: `Delete "${n.name}"?`, body: `This deletes ${n.noteCount ?? 0} notes and their cards.`, danger: true, confirm: "Delete" })) await api.del(`/api/notetypes/${n.id}`).then(list.reload, (e) => toast(e.message, "error"));
                  }}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>
          ))}
        </Card>
      )}
      {fieldsFor && <FieldsDialog nt={fieldsFor} onClose={() => setFieldsFor(null)} onSaved={list.reload} />}
      {cardsFor && <TemplatesDialog nt={cardsFor} onClose={() => setCardsFor(null)} onSaved={list.reload} />}
    </div>
  );
}

function FieldsDialog({ nt, onClose, onSaved }: { nt: Notetype; onClose: () => void; onSaved: () => void }) {
  const [fields, setFields] = useState<FieldDef[]>(nt.fields.map((f, i) => ({ ...f, origOrd: i })));
  const [sel, setSel] = useState(0);
  const [sortIdx, setSortIdx] = useState(nt.sortIdx);
  const [busy, setBusy] = useState(false);
  const dialogs = useDialogs();
  const toast = useToast();
  const f = fields[sel];
  const upd = (p: Partial<FieldDef>) => setFields(fields.map((x, i) => (i === sel ? { ...x, ...p } : x)));
  const move = (d: number) => {
    const j = sel + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[sel], next[j]] = [next[j], next[sel]];
    setFields(next);
    if (sortIdx === sel) setSortIdx(j);
    else if (sortIdx === j) setSortIdx(sel);
    setSel(j);
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/notetypes/${nt.id}`, { fields: fields.map((x, i) => ({ ...x, ord: i })), sortIdx });
      toast("Fields saved", "success");
      onSaved();
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
      title={`Fields · ${nt.name}`}
      footer={
        <Button variant="primary" onClick={save} loading={busy}>
          Save
        </Button>
      }
    >
      <div className="grid sm:grid-cols-[220px_1fr] gap-4">
        <div>
          <div className="rounded-xl border border-app overflow-hidden">
            {fields.map((x, i) => (
              <button key={i} onClick={() => setSel(i)} className={cx("w-full text-left px-3 py-2 text-sm border-b border-app last:border-0", i === sel ? "bg-brand-500/12 font-medium" : "hover:bg-panel-2")}>
                {i + 1}. {x.name}
                {i === sortIdx && <span className="text-xs text-muted ml-1">(sort)</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-1 mt-2">
            <Button
              size="sm"
              onClick={async () => {
                const name = await dialogs.prompt({ title: "Add field", confirm: "Add" });
                if (name) {
                  setFields([...fields, { name, ord: fields.length, origOrd: null }]);
                  setSel(fields.length);
                }
              }}
            >
              <Plus className="size-4" /> Add
            </Button>
            <IconButton label="Move up" onClick={() => move(-1)}>
              <ArrowUp className="size-4" />
            </IconButton>
            <IconButton label="Move down" onClick={() => move(1)}>
              <ArrowDown className="size-4" />
            </IconButton>
            <IconButton
              label="Delete field"
              disabled={fields.length < 2}
              onClick={async () => {
                if (await dialogs.confirm({ title: `Delete field "${f.name}"?`, body: "Its content is removed from all notes of this type.", danger: true, confirm: "Delete" })) {
                  setFields(fields.filter((_, i) => i !== sel));
                  setSel(Math.max(0, sel - 1));
                  if (sortIdx >= fields.length - 1) setSortIdx(0);
                }
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        </div>
        {f && (
          <div className="space-y-3">
            <Field label="Name" hint="Renaming updates templates automatically">
              <Input value={f.name} onChange={(e) => upd({ name: e.target.value })} />
            </Field>
            <Field label="Description" hint="Shown as placeholder in the editor">
              <Input value={f.description ?? ""} onChange={(e) => upd({ description: e.target.value })} />
            </Field>
            <Switch checked={sortIdx === sel} onChange={(v) => v && setSortIdx(sel)} label="Sort by this field in the browser" />
            <Switch checked={!!f.sticky} onChange={(v) => upd({ sticky: v })} label="Remember last input when adding" />
            <Switch checked={!!f.rtl} onChange={(v) => upd({ rtl: v })} label="Right-to-left text" />
            <Switch checked={!!f.plainText} onChange={(v) => upd({ plainText: v })} label="Use plain text editor by default" />
            <Switch checked={!!f.excludeFromSearch} onChange={(v) => upd({ excludeFromSearch: v })} label="Exclude from unqualified searches" />
          </div>
        )}
      </div>
    </Modal>
  );
}

function TemplatesDialog({ nt, onClose, onSaved }: { nt: Notetype; onClose: () => void; onSaved: () => void }) {
  const [tmpls, setTmpls] = useState<TemplateDef[]>(nt.templates.map((t, i) => ({ ...t, origOrd: i })));
  const [css, setCss] = useState(nt.css);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<"qfmt" | "afmt" | "css">("qfmt");
  const [preview, setPreview] = useState<{ question: string; answer: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dark = useIsDark();
  const dialogs = useDialogs();
  const toast = useToast();
  const t = tmpls[sel];

  useEffect(() => {
    const h = setTimeout(() => {
      const draft = { ...nt, css, templates: tmpls };
      const fields = nt.fields.map((f) => (nt.kind === 1 && f.name === "Text" ? "This is a {{c1::cloze}} deletion." : `(${f.name})`));
      api
        .post<{ question: string; answer: string }>("/api/render/preview", { notetype: draft, fields, ord: nt.kind === 1 ? 0 : sel, night: dark })
        .then(setPreview)
        .catch(() => {});
    }, 300);
    return () => clearTimeout(h);
  }, [tmpls, css, sel, dark, nt]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/notetypes/${nt.id}`, { css, templates: tmpls.map((x, i) => ({ ...x, ord: i })) });
      toast("Card types saved", "success");
      onSaved();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  const value = tab === "css" ? css : (t?.[tab] ?? "");
  const setValue = (v: string) => (tab === "css" ? setCss(v) : setTmpls(tmpls.map((x, i) => (i === sel ? { ...x, [tab]: v } : x))));
  return (
    <Modal
      open
      onClose={onClose}
      wide="xl"
      title={`Card types · ${nt.name}`}
      footer={
        <Button variant="primary" onClick={save} loading={busy}>
          Save
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Select value={sel} onChange={(e) => setSel(+e.target.value)} className="w-auto">
          {tmpls.map((x, i) => (
            <option key={i} value={i}>
              {i + 1}: {x.name}
            </option>
          ))}
        </Select>
        {nt.kind === 0 && (
          <>
            <Button
              size="sm"
              onClick={async () => {
                const name = await dialogs.prompt({ title: "Add card type", value: `Card ${tmpls.length + 1}`, confirm: "Add" });
                if (name) {
                  setTmpls([...tmpls, { name, ord: tmpls.length, qfmt: tmpls[0].qfmt, afmt: tmpls[0].afmt, origOrd: null }]);
                  setSel(tmpls.length);
                }
              }}
            >
              <Plus className="size-4" /> Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const name = await dialogs.prompt({ title: "Rename card type", value: t.name, confirm: "Rename" });
                if (name) setTmpls(tmpls.map((x, i) => (i === sel ? { ...x, name } : x)));
              }}
            >
              <Pencil className="size-4" /> Rename
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={tmpls.length < 2}
              onClick={async () => {
                if (await dialogs.confirm({ title: `Remove "${t.name}"?`, body: "All cards of this type will be deleted.", danger: true, confirm: "Remove" })) {
                  setTmpls(tmpls.filter((_, i) => i !== sel));
                  setSel(0);
                }
              }}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          </>
        )}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <Tabs
            value={tab}
            onChange={setTab}
            className="mb-2"
            tabs={[
              { value: "qfmt", label: "Front template" },
              { value: "afmt", label: "Back template" },
              { value: "css", label: "Styling" },
            ]}
          />
          <textarea value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} className="w-full h-[50vh] rounded-xl border border-app bg-panel-2 px-3 py-2 font-mono text-[13px] leading-relaxed outline-none focus:border-brand-500 resize-none" />
          <p className="text-xs text-muted mt-1">
            Use {"{{Field}}"}, {"{{#Field}}…{{/Field}}"}, {"{{FrontSide}}"}, {"{{cloze:Text}}"}, {"{{type:Field}}"}, {"{{hint:Field}}"}, {"{{text:Field}}"}, {"{{Tags}}"}, {"{{Deck}}"}.
          </p>
        </div>
        <div className="grid grid-rows-2 gap-2 h-[56vh]">
          {preview ? (
            <>
              <div className="rounded-xl border border-app overflow-hidden relative">
                <span className="absolute top-1 right-2 text-[10px] text-muted z-10">Front</span>
                <CardFrame html={preview.question} />
              </div>
              <div className="rounded-xl border border-app overflow-hidden relative">
                <span className="absolute top-1 right-2 text-[10px] text-muted z-10">Back</span>
                <CardFrame html={preview.answer} />
              </div>
            </>
          ) : (
            <Loading />
          )}
        </div>
      </div>
    </Modal>
  );
}
