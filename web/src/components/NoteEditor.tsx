import { useEffect, useRef, useState, useCallback } from "react";
import { Bold, Italic, Underline, Superscript, Subscript, Eraser, Brackets, ImagePlus, Mic, Square, Code2, Pin, PinOff, List, Palette, X, Highlighter } from "lucide-react";
import { api, type Notetype } from "../lib/api";
import { useApi } from "../lib/hooks";
import { cx, useToast } from "./ui";

let mediaBaseCache: { base: string; at: number } | null = null;
export async function getMediaBase(): Promise<string> {
  if (mediaBaseCache && Date.now() - mediaBaseCache.at < 3600_000) return mediaBaseCache.base;
  const r = await api.get<{ base: string }>("/api/media-base");
  mediaBaseCache = { base: r.base, at: Date.now() };
  return r.base;
}

/** Stored HTML references media by bare filename; for display, point at signed media URLs. */
function toDisplay(html: string, base: string): string {
  if (!base) return html;
  return html.replace(/(<(?:img|audio|video|source)\b[^>]*?\bsrc=)(["'])([^"']+)\2/gi, (m, pre, q, src) => (/^(https?:|data:|blob:|\/)/i.test(src) ? m : `${pre}${q}${base}${encodeURIComponent(src)}${q}`));
}
function fromDisplay(html: string, base: string): string {
  if (!base) return html;
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(`(src=["'])${esc}([^"']+)(["'])`, "g"), (_m, a, f, b) => `${a}${decodeURIComponent(f)}${b}`);
}

export async function uploadMedia(file: Blob, name: string): Promise<string> {
  const fd = new FormData();
  fd.append("file", file, name);
  const r = await api.post<{ filename: string }>("/api/media", fd);
  return r.filename;
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

interface FieldEditorProps {
  value: string;
  onChange: (v: string) => void;
  label: string;
  description?: string;
  sticky?: boolean;
  onToggleSticky?: () => void;
  isCloze?: boolean;
  allFields: string[];
  autoFocus?: boolean;
  rtl?: boolean;
  plainText?: boolean;
  dupe?: boolean;
}

function FieldEditor({ value, onChange, label, description, sticky, onToggleSticky, isCloze, allFields, autoFocus, rtl, plainText, dupe }: FieldEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(plainText ?? false);
  const [base, setBase] = useState("");
  const [recording, setRecording] = useState<MediaRecorder | null>(null);
  const toast = useToast();
  const last = useRef<string>("");

  useEffect(() => {
    getMediaBase().then(setBase).catch(() => {});
  }, []);

  useEffect(() => {
    if (html || !ref.current) return;
    if (value !== last.current) {
      ref.current.innerHTML = toDisplay(value, base);
      last.current = value;
    }
  }, [value, html, base]);

  useEffect(() => {
    if (autoFocus) setTimeout(() => ref.current?.focus(), 50);
  }, [autoFocus]);

  const emit = useCallback(() => {
    if (!ref.current) return;
    let v = fromDisplay(ref.current.innerHTML, base);
    if (v === "<br>") v = "";
    last.current = v;
    onChange(v);
  }, [base, onChange]);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const insertHtml = (h: string) => {
    ref.current?.focus();
    document.execCommand("insertHTML", false, h);
    emit();
  };

  const cloze = (same: boolean) => {
    const nums = allFields.join(" ").match(/\{\{c(\d+)::/g)?.map((m) => +m.slice(3, -2)) ?? [];
    const max = nums.length ? Math.max(...nums) : 0;
    const n = same ? Math.max(1, max) : max + 1;
    const sel = window.getSelection();
    const text = sel && sel.rangeCount ? sel.toString() : "";
    ref.current?.focus();
    document.execCommand("insertText", false, `{{c${n}::${text}}}`);
    if (!text && sel?.rangeCount) {
      // place caret inside the braces
      const r = sel.getRangeAt(0);
      r.setStart(r.startContainer, Math.max(0, r.startOffset - 2));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    emit();
  };

  const addFiles = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      try {
        const name = await uploadMedia(f, f.name || `pasted-${Date.now()}.png`);
        if (f.type.startsWith("image/")) insertHtml(`<img src="${escapeAttr(base + encodeURIComponent(name))}">`);
        else if (f.type.startsWith("audio/") || f.type.startsWith("video/")) insertHtml(`[sound:${name}]`);
        else insertHtml(`<a href="${escapeAttr(name)}">${escapeAttr(name)}</a>`);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    }
  };

  const record = async () => {
    if (recording) {
      recording.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        const blob = new Blob(chunks, { type: rec.mimeType });
        const ext = rec.mimeType.includes("ogg") ? "ogg" : rec.mimeType.includes("mp4") ? "m4a" : "webm";
        const name = await uploadMedia(blob, `rec-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`);
        insertHtml(`[sound:${name}]`);
      };
      rec.start();
      setRecording(rec);
    } catch {
      toast("Microphone not available (requires HTTPS or localhost)", "error");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && (e.key === "C" || e.key === "c")) {
      e.preventDefault();
      cloze(e.altKey);
    } else if (mod && e.key === "b") {
      e.preventDefault();
      exec("bold");
    } else if (mod && e.key === "i") {
      e.preventDefault();
      exec("italic");
    } else if (mod && e.key === "u") {
      e.preventDefault();
      exec("underline");
    } else if (mod && e.key === "r" && !e.shiftKey) {
      e.preventDefault();
      exec("removeFormat");
    } else if (mod && e.key === "=") {
      e.preventDefault();
      exec(e.shiftKey ? "superscript" : "subscript");
    }
  };

  const tools: { icon: React.ReactNode; label: string; on: () => void; active?: boolean }[] = [
    { icon: <Bold />, label: "Bold (Ctrl+B)", on: () => exec("bold") },
    { icon: <Italic />, label: "Italic (Ctrl+I)", on: () => exec("italic") },
    { icon: <Underline />, label: "Underline (Ctrl+U)", on: () => exec("underline") },
    { icon: <Superscript />, label: "Superscript", on: () => exec("superscript") },
    { icon: <Subscript />, label: "Subscript", on: () => exec("subscript") },
    { icon: <List />, label: "Bullet list", on: () => exec("insertUnorderedList") },
    { icon: <Palette />, label: "Text color", on: () => exec("foreColor", "#e11d48") },
    { icon: <Highlighter />, label: "Highlight", on: () => exec("hiliteColor", "#fde047") },
    { icon: <Eraser />, label: "Clear formatting (Ctrl+R)", on: () => exec("removeFormat") },
    ...(isCloze ? [{ icon: <Brackets />, label: "Cloze deletion (Ctrl+Shift+C)", on: () => cloze(false) }] : []),
    { icon: <ImagePlus />, label: "Attach image/audio", on: () => fileRef.current?.click() },
    { icon: recording ? <Square className="text-red-500" /> : <Mic />, label: recording ? "Stop recording" : "Record audio", on: record, active: !!recording },
    { icon: <Code2 />, label: "HTML editor", on: () => setHtml(!html), active: html },
  ];
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
          {dupe && <span className="ml-2 normal-case tracking-normal text-amber-600 font-medium">Duplicate</span>}
        </label>
        {onToggleSticky && (
          <button type="button" onClick={onToggleSticky} title={sticky ? "Unpin field (keeps content after adding)" : "Pin field (keep content after adding)"} className={cx("p-1 rounded-md", sticky ? "text-brand-500" : "text-muted/50 hover:text-muted")}>
            {sticky ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
          </button>
        )}
      </div>
      <div className={cx("rounded-xl border bg-panel transition focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15", dupe ? "border-amber-500" : "border-app")}>
        <div className="flex flex-wrap gap-0.5 px-1.5 pt-1.5 opacity-60 group-focus-within:opacity-100 transition">
          {tools.map((t, i) => (
            <button key={i} type="button" title={t.label} onMouseDown={(e) => e.preventDefault()} onClick={t.on} className={cx("size-7 flex items-center justify-center rounded-md text-muted hover:bg-panel-2 hover:text-app [&>svg]:size-[15px]", t.active && "bg-brand-500/15 text-brand-600")}>
              {t.icon}
            </button>
          ))}
          <input ref={fileRef} type="file" hidden multiple accept="image/*,audio/*,video/*" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>
        {html ? (
          <textarea value={value} onChange={(e) => onChange(e.target.value)} className="w-full min-h-24 px-3 py-2 bg-transparent font-mono text-[13px] outline-none resize-y" spellCheck={false} />
        ) : (
          <div
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            dir={rtl ? "rtl" : undefined}
            data-placeholder={description || label}
            className="field-editor px-3 py-2 text-[15px]"
            onInput={emit}
            onBlur={emit}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
                return;
              }
              if (plainText) {
                e.preventDefault();
                document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
              }
            }}
            onDrop={(e) => {
              if (e.dataTransfer.files.length) {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

export function TagInput({ value, onChange }: { value: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const all = useApi(() => api.get<string[]>("/api/tags"), [], { live: ["notes", "import"] });
  const suggestions = text ? (all.data ?? []).filter((t) => t.toLowerCase().includes(text.toLowerCase()) && !value.includes(t)).slice(0, 8) : [];
  const add = (t: string) => {
    const parts = t.split(/\s+/).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.some((v) => v.toLowerCase() === p.toLowerCase()))]);
    setText("");
  };
  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-app bg-panel px-2 py-1.5 min-h-10 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-brand-500/12 text-brand-700 dark:text-brand-300 px-2 py-0.5 text-xs font-medium">
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={text}
          onChange={(e) => (/\s/.test(e.target.value) ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === "," || e.key === " ") && text) {
              e.preventDefault();
              add(suggestions[0] && e.key === "Enter" && suggestions[0].toLowerCase().startsWith(text.toLowerCase()) ? suggestions[0] : text);
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => (setFocus(false), text && add(text)), 150)}
          placeholder={value.length ? "" : "Add tags…"}
          className="flex-1 min-w-24 bg-transparent outline-none text-sm py-0.5"
        />
      </div>
      {focus && suggestions.length > 0 && (
        <div className="absolute z-30 mt-1 w-full panel rounded-xl shadow-lg py-1 max-h-52 overflow-y-auto">
          {suggestions.map((s) => (
            <button key={s} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-panel-2">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NoteEditor({ notetype, fields, onFieldsChange, tags, onTagsChange, sticky, onToggleSticky, autoFocus, dupe }: { notetype: Notetype; fields: string[]; onFieldsChange: (f: string[]) => void; tags: string[]; onTagsChange: (t: string[]) => void; sticky?: boolean[]; onToggleSticky?: (i: number) => void; autoFocus?: boolean; dupe?: boolean }) {
  return (
    <div className="space-y-4">
      {notetype.fields.map((f, i) => (
        <FieldEditor
          key={`${notetype.id}-${i}`}
          label={f.name}
          description={f.description}
          value={fields[i] ?? ""}
          onChange={(v) => {
            const next = [...fields];
            while (next.length < notetype.fields.length) next.push("");
            next[i] = v;
            onFieldsChange(next);
          }}
          sticky={sticky?.[i]}
          onToggleSticky={onToggleSticky ? () => onToggleSticky(i) : undefined}
          isCloze={notetype.kind === 1}
          allFields={fields}
          autoFocus={autoFocus && i === 0}
          rtl={f.rtl}
          plainText={f.plainText}
          dupe={dupe && i === 0}
        />
      ))}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-muted mb-1 block">Tags</label>
        <TagInput value={tags} onChange={onTagsChange} />
      </div>
    </div>
  );
}
