import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { download } from "../lib/api";
import { Button, Modal, Switch, Tabs, useToast } from "./ui";

export default function ExportDialog({ open, onClose, deckId, noteIds }: { open: boolean; onClose: () => void; deckId: number | null; noteIds?: number[] }) {
  const [format, setFormat] = useState<"apkg" | "text">("apkg");
  const [scheduling, setScheduling] = useState(true);
  const [media, setMedia] = useState(true);
  const [html, setHtml] = useState(true);
  const [tags, setTags] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async () => {
    setBusy(true);
    try {
      const q = new URLSearchParams();
      if (deckId) q.set("deck", String(deckId));
      if (noteIds?.length) q.set(format === "apkg" ? "notes" : "q", format === "apkg" ? noteIds.join(",") : `nid:${noteIds.join(",")}`);
      if (format === "apkg") {
        q.set("scheduling", scheduling ? "1" : "0");
        q.set("media", media ? "1" : "0");
        await download(`/api/export/apkg?${q}`, "export.apkg");
      } else {
        q.set("html", html ? "1" : "0");
        q.set("tags", tags ? "1" : "0");
        q.set("meta", "1");
        await download(`/api/export/notes?${q}`, "notes.txt");
      }
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={noteIds?.length ? `Export ${noteIds.length} notes` : deckId ? "Export deck" : "Export collection"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={run} loading={busy}>
            Export
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Tabs
          value={format}
          onChange={setFormat}
          tabs={[
            { value: "apkg", label: "Anki package (.apkg)" },
            { value: "text", label: "Notes as text" },
          ]}
        />
        {format === "apkg" ? (
          <div className="space-y-3">
            <Switch checked={scheduling} onChange={setScheduling} label="Include scheduling information" hint="Review history, due dates and memory state" />
            <Switch checked={media} onChange={setMedia} label="Include media" />
            <p className="text-xs text-muted">Opens in Anki desktop, AnkiDroid and AnkiMobile.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Switch checked={html} onChange={setHtml} label="Include HTML and media references" />
            <Switch checked={tags} onChange={setTags} label="Include tags" />
          </div>
        )}
        <div className="flex gap-2 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs">
          <ShieldAlert className="size-4 shrink-0" />
          Exported files are not encrypted (Anki can't read encrypted packages). Keep them somewhere safe.
        </div>
      </div>
    </Modal>
  );
}
