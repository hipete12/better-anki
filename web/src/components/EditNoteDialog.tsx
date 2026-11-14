import { useEffect, useState } from "react";
import { api, type NoteData } from "../lib/api";
import { Button, Loading, Modal, useToast } from "./ui";
import NoteEditor from "./NoteEditor";

export default function EditNoteDialog({ noteId, onClose, onSaved }: { noteId: number | null; onClose: () => void; onSaved?: () => void }) {
  const [note, setNote] = useState<NoteData | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!noteId) return;
    setNote(null);
    api.get<NoteData>(`/api/notes/${noteId}`).then((n) => {
      setNote(n);
      setFields(n.fields);
      setTags(n.tags);
    });
  }, [noteId]);
  const save = async () => {
    if (!note) return;
    setBusy(true);
    try {
      await api.put(`/api/notes/${note.id}`, { fields, tags });
      onSaved?.();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={!!noteId}
      onClose={onClose}
      wide
      title={note ? `Edit note · ${note.notetype.name}` : "Edit note"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!note}>
            Save
          </Button>
        </>
      }
    >
      <div
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            save();
          }
        }}
      >
        {note ? <NoteEditor notetype={note.notetype} fields={fields} onFieldsChange={setFields} tags={tags} onTagsChange={setTags} autoFocus /> : <Loading />}
      </div>
    </Modal>
  );
}
