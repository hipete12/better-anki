import { useEffect, useState } from "react";
import { Server, ShieldCheck, ShieldAlert, KeyRound, ArrowRight, Lock } from "lucide-react";
import { api, normalizeServer, transportSecurity, ApiError } from "../lib/api";
import { saveCredentials, deviceName, secureContextAvailable, type Credentials } from "../lib/secureStore";
import { Button, Input, Field, Card, cx } from "../components/ui";

type Health = Awaited<ReturnType<typeof api.health>>;

export default function Connect({ onConnected }: { onConnected: (c: Credentials) => void }) {
  // When the web app is served by the server itself, use same-origin requests.
  const [server, setServer] = useState(() => localStorage.getItem("ba.lastServer") ?? (location.port === "5173" ? "" : location.origin));
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [busy, setBusy] = useState(false);

  const srv = server ? normalizeServer(server) : "";
  const transport = transportSecurity(srv || location.origin);

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const h = await api.health(srv);
      if (h.name !== "Better Anki") throw new Error("That server isn't a Better Anki server");
      setHealth(h);
      localStorage.setItem("ba.lastServer", server);
    } catch (e) {
      setHealth(null);
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!health) return check();
    setBusy(true);
    setError(null);
    try {
      if (health.setupRequired && password !== password2) throw new Error("Passwords don't match");
      const res = health.setupRequired ? await api.setup(srv, username || "owner", password, deviceName(), setupCode || undefined) : await api.login(srv, username, password, deviceName());
      const creds = { server: srv, token: res.token, username: res.username };
      await saveCredentials(creds);
      onConnected(creds);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src="/icon.svg" alt="" className="size-12 mb-4" />
          <h1 className="text-2xl font-semibold">Better Anki</h1>
          <p className="text-muted text-sm mt-1">Spaced repetition, on your own encrypted server.</p>
        </div>
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            <Field label="Server" hint={!server ? "Using this page's server" : undefined}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Server className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted" />
                  <Input value={server} onChange={(e) => (setServer(e.target.value), setHealth(null))} placeholder="http://100.x.y.z:8765 or https://host.ts.net" className="pl-9" onBlur={() => !health && server && check()} />
                </div>
                <Button type="button" onClick={check} loading={checking}>
                  Connect
                </Button>
              </div>
            </Field>
            <div className={cx("flex items-start gap-2 rounded-xl px-3 py-2 text-xs", transport.secure ? "bg-green-500/10 text-green-700 dark:text-green-300" : "bg-amber-500/12 text-amber-700 dark:text-amber-300")}>
              {transport.secure ? <ShieldCheck className="size-4 shrink-0" /> : <ShieldAlert className="size-4 shrink-0" />}
              <span>
                {transport.secure ? `Connection encrypted in transit (${transport.reason}).` : "This connection is not encrypted in transit. Use HTTPS or your Tailscale address."} Your collection is AES-256 encrypted at rest on the server.
                {!secureContextAvailable() && " This browser context can't encrypt saved credentials, so you'll stay signed in only for this tab."}
              </span>
            </div>

            {health && (
              <div className="space-y-4 animate-fade">
                {health.setupRequired ? (
                  <div className="rounded-xl bg-brand-500/8 border border-brand-500/20 px-4 py-3 text-sm">
                    <div className="font-semibold flex items-center gap-2">
                      <KeyRound className="size-4" /> Create your account
                    </div>
                    <p className="text-muted text-xs mt-1">Your password protects the key that encrypts your collection. It can't be recovered if forgotten, so store it safely.</p>
                  </div>
                ) : health.locked ? (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <Lock className="size-3.5" /> Server is locked. Signing in unlocks your encrypted collection.
                  </div>
                ) : null}
                <Field label="Username">
                  <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={health.setupRequired ? "owner" : ""} required={!health.setupRequired} />
                </Field>
                <Field label="Password">
                  <Input type="password" autoComplete={health.setupRequired ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={health.setupRequired ? 8 : undefined} />
                </Field>
                {health.setupRequired && (
                  <Field label="Confirm password">
                    <Input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
                  </Field>
                )}
                {health.setupRequired && health.setupNeedsCode && (
                  <Field label="Setup code" hint="Printed in the server console on first start. Not needed when connecting from the server machine itself.">
                    <Input value={setupCode} onChange={(e) => setSetupCode(e.target.value.toUpperCase())} className="font-mono tracking-widest" required />
                  </Field>
                )}
              </div>
            )}
            {error && <div className="rounded-xl bg-red-500/10 text-red-600 dark:text-red-300 px-3 py-2 text-sm">{error}</div>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!health}>
              {health?.setupRequired ? "Create account" : "Sign in"} <ArrowRight className="size-4" />
            </Button>
          </form>
        </Card>
        {health && <p className="text-center text-xs text-muted mt-4">Server v{health.version}</p>}
      </div>
    </div>
  );
}
