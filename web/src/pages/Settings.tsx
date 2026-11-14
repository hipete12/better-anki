import { useState } from "react";
import { ShieldCheck, Monitor, Smartphone, Trash2, KeyRound, Database, Wrench, ImageOff, Archive, Moon, Sun, Laptop, LogOut, Lock } from "lucide-react";
import { api, fmt, transportSecurity, type CollectionConfig } from "../lib/api";
import { useApi, useSession, applyTheme, type Theme, useLocalStorage } from "../lib/hooks";
import { secureContextAvailable } from "../lib/secureStore";
import { Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, Switch, Tabs, useDialogs, useToast } from "../components/ui";

interface SessionInfo {
  id: string;
  device: string;
  created: number;
  lastSeen: number;
  lastIp: string;
  current?: boolean;
}

export default function Settings() {
  const session = useSession();
  const cfg = useApi(() => api.get<CollectionConfig>("/api/config"), [], { live: ["config"] });
  const info = useApi(() => api.get<{ version: string; counts: Record<string, number> }>("/api/info"), []);
  const sessions = useApi(() => api.get<SessionInfo[]>("/api/auth/sessions"), []);
  const backups = useApi(() => api.get<{ name: string; size: number }[]>("/api/backups"), []);
  const [theme, setTheme] = useLocalStorage<Theme>("ba.themePref", (localStorage.getItem("ba.theme") as Theme) || "system");
  const [pwOpen, setPwOpen] = useState(false);
  const [report, setReport] = useState<{ title: string; lines: string[]; action?: { label: string; run: () => Promise<void> } } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const dialogs = useDialogs();
  const transport = transportSecurity(session.server || location.origin);

  const setCfg = async (patch: Partial<CollectionConfig>) => {
    try {
      cfg.setData({ ...cfg.data!, ...patch });
      await api.put("/api/config", patch);
      if (patch.fsrs) toast("FSRS enabled; memory states computed from your review history", "success");
    } catch (e) {
      toast((e as Error).message, "error");
      cfg.reload();
    }
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10 space-y-5">
      <PageHeader title="Settings" />

      <Card className="p-5">
        <h2 className="font-semibold flex items-center gap-2 mb-3">
          <ShieldCheck className="size-5 text-green-500" /> Security &amp; encryption
        </h2>
        <ul className="text-sm space-y-2">
          <li className="flex gap-2">
            <Lock className="size-4 mt-0.5 text-green-500 shrink-0" />
            <span>
              <b>At rest:</b> collection, media, filenames and backups are AES-256-GCM encrypted on the server. The key exists only in server memory, unwrapped by your password or an authorized device.
            </span>
          </li>
          <li className="flex gap-2">
            <Lock className={`size-4 mt-0.5 shrink-0 ${transport.secure ? "text-green-500" : "text-amber-500"}`} />
            <span>
              <b>In transit:</b> {transport.reason}
              {!transport.secure && ": use your Tailscale address or HTTPS (tailscale cert) to encrypt traffic."}
            </span>
          </li>
          <li className="flex gap-2">
            <Lock className={`size-4 mt-0.5 shrink-0 ${secureContextAvailable() ? "text-green-500" : "text-amber-500"}`} />
            <span>
              <b>This device:</b> {secureContextAvailable() ? "credentials encrypted with a non-extractable WebCrypto key." : "insecure browser context, so credentials are kept only for this tab."}
            </span>
          </li>
        </ul>
        <div className="flex flex-wrap gap-2 mt-4">
          <Button onClick={() => setPwOpen(true)}>
            <KeyRound className="size-4" /> Change password
          </Button>
          <Button onClick={session.logout}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-1">Signed-in devices</h2>
        <p className="text-xs text-muted mb-3">Each device holds its own key to unlock the collection. Revoking a device destroys its key.</p>
        {!sessions.data ? (
          <Loading />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {sessions.data.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-2.5">
                {/android|ios/i.test(s.device) ? <Smartphone className="size-5 text-muted" /> : <Monitor className="size-5 text-muted" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {s.device} {s.current && <Badge color="green">This device</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    Last active {fmt.datetime(s.lastSeen)} · {s.lastIp}
                  </div>
                </div>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (await dialogs.confirm({ title: "Revoke device?", body: `${s.device} will be signed out and its key destroyed.`, confirm: "Revoke", danger: true })) {
                        await api.del(`/api/auth/sessions/${s.id}`);
                        sessions.reload();
                      }
                    }}
                  >
                    <Trash2 className="size-4" /> Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Appearance</h2>
        <Tabs
          value={theme}
          onChange={(t) => (setTheme(t), applyTheme(t))}
          tabs={[
            { value: "light", label: <span className="flex items-center gap-1.5"><Sun className="size-4" /> Light</span> },
            { value: "dark", label: <span className="flex items-center gap-1.5"><Moon className="size-4" /> Dark</span> },
            { value: "system", label: <span className="flex items-center gap-1.5"><Laptop className="size-4" /> System</span> },
          ]}
        />
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-4">Scheduling</h2>
        {!cfg.data ? (
          <Loading />
        ) : (
          <div className="space-y-4">
            <Switch checked={cfg.data.fsrs} onChange={(v) => setCfg({ fsrs: v })} label="FSRS scheduler" hint="Modern memory model (FSRS-6) that predicts when you'll forget. Turn off for Anki's classic SM-2." />
            <Switch checked={cfg.data.loadBalancer} onChange={(v) => setCfg({ loadBalancer: v })} label="Load balancer" hint="Spread reviews evenly across days within each card's fuzz range." />
            <div className="grid sm:grid-cols-3 gap-3">
              <Field label="Next day starts at" hint="Hours past midnight">
                <Select value={cfg.data.rolloverHour} onChange={(e) => setCfg({ rolloverHour: +e.target.value })}>
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}:00
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Learn ahead limit" hint="Minutes">
                <Input type="number" min={0} value={cfg.data.learnAheadMins} onChange={(e) => setCfg({ learnAheadMins: +e.target.value })} />
              </Field>
              <Field label="Timebox" hint="Minutes (0 = off)">
                <Input type="number" min={0} value={cfg.data.timeboxMins} onChange={(e) => setCfg({ timeboxMins: +e.target.value })} />
              </Field>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-1">Maintenance</h2>
        <p className="text-xs text-muted mb-4">
          {info.data && `${info.data.counts.notes.toLocaleString()} notes · ${info.data.counts.cards.toLocaleString()} cards · ${info.data.counts.media.toLocaleString()} media files · ${info.data.counts.revlog.toLocaleString()} reviews · server v${info.data.version}`}
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          <Button loading={busy === "db"} onClick={() => run("db", async () => setReport({ title: "Check database", lines: (await api.post<{ report: string[] }>("/api/check-database")).report }))}>
            <Database className="size-4" /> Check database
          </Button>
          <Button
            loading={busy === "empty"}
            onClick={() =>
              run("empty", async () => {
                const r = await api.get<{ noteId: number; cardIds: number[]; ords: number[]; preview: string }[]>("/api/empty-cards");
                const ids = r.flatMap((x) => x.cardIds);
                setReport({
                  title: "Empty cards",
                  lines: r.length ? r.map((x) => `${x.preview || "(note)"}: card ${x.ords.join(", ")}`) : ["No empty cards found."],
                  action: ids.length ? { label: `Delete ${ids.length} empty cards`, run: async () => void (await api.post("/api/empty-cards", { cardIds: ids })) } : undefined,
                });
              })
            }
          >
            <Wrench className="size-4" /> Empty cards
          </Button>
          <Button
            loading={busy === "media"}
            onClick={() =>
              run("media", async () => {
                const r = await api.get<{ unused: string[]; missing: string[]; total: number }>("/api/check-media");
                setReport({
                  title: "Check media",
                  lines: [`${r.total} media files (all encrypted).`, `${r.missing.length} referenced but missing${r.missing.length ? ": " + r.missing.slice(0, 20).join(", ") : ""}.`, `${r.unused.length} unused${r.unused.length ? ": " + r.unused.slice(0, 20).join(", ") : ""}.`],
                  action: r.unused.length ? { label: `Delete ${r.unused.length} unused files`, run: async () => void (await api.post("/api/media/delete", { files: r.unused })) } : undefined,
                });
              })
            }
          >
            <ImageOff className="size-4" /> Check media
          </Button>
          <Button loading={busy === "backup"} onClick={() => run("backup", async () => (await api.post("/api/backups"), backups.reload(), toast("Encrypted backup created", "success")))}>
            <Archive className="size-4" /> Create backup now
          </Button>
        </div>
        {backups.data && backups.data.length > 0 && (
          <p className="text-xs text-muted mt-3">
            {backups.data.length} encrypted backups on the server · latest {backups.data[0].name.replace(/^collection-|\.enc$/g, "")}
          </p>
        )}
      </Card>

      <Modal open={!!report} onClose={() => setReport(null)} title={report?.title} footer={report?.action && <Button variant="danger" onClick={() => run("act", async () => (await report.action!.run(), setReport(null), toast("Done", "success")))}>{report.action.label}</Button>}>
        <ul className="text-sm space-y-1.5 max-h-80 overflow-y-auto">
          {report?.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </Modal>
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} onDone={sessions.reload} />}
    </div>
  );
}

function PasswordDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [oldPw, setOld] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [others, setOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async () => {
    if (pw !== pw2) return toast("Passwords don't match", "error");
    setBusy(true);
    try {
      await api.post("/api/auth/password", { oldPassword: oldPw, newPassword: pw, signOutOthers: others });
      toast("Password changed; your encryption key was re-wrapped", "success");
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
      title="Change password"
      footer={
        <Button variant="primary" onClick={save} loading={busy} disabled={!oldPw || pw.length < 8}>
          Change password
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOld(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <Switch checked={others} onChange={setOthers} label="Sign out all other devices" />
      </div>
    </Modal>
  );
}
