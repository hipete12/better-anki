import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Layers, Plus, Search, BarChart3, Settings, LogOut, Shapes, ShieldCheck, Moon, Sun, Lock } from "lucide-react";
import { api, setCredentials, setUnauthorizedHandler, subscribeEvents, transportSecurity, type DeckNode } from "./lib/api";
import { loadCredentials, clearCredentials, type Credentials } from "./lib/secureStore";
import { emitChange, SessionCtx, useIsDark, applyTheme, useApi } from "./lib/hooks";
import { cx, Loading } from "./components/ui";
import Connect from "./pages/Connect";
import Decks from "./pages/Decks";

const Study = lazy(() => import("./pages/Study"));
const AddNote = lazy(() => import("./pages/AddNote"));
const Browse = lazy(() => import("./pages/Browse"));
const Stats = lazy(() => import("./pages/Stats"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const DeckOptions = lazy(() => import("./pages/DeckOptions"));
const DeckOverview = lazy(() => import("./pages/DeckOverview"));
const Notetypes = lazy(() => import("./pages/Notetypes"));

const NAV = [
  { to: "/", label: "Decks", icon: Layers, end: true },
  { to: "/add", label: "Add", icon: Plus },
  { to: "/browse", label: "Browse", icon: Search },
  { to: "/stats", label: "Stats", icon: BarChart3 },
  { to: "/notetypes", label: "Note Types", icon: Shapes },
  { to: "/settings", label: "Settings", icon: Settings },
];
const MOBILE_NAV = ["/", "/add", "/browse", "/stats", "/settings"].map((to) => NAV.find((n) => n.to === to)!);

/** Cards waiting today across all top-level decks (for the nav badge). */
function useDueCount(enabled: boolean) {
  const { data } = useApi(() => (enabled ? api.get<{ tree: DeckNode[] }>("/api/decks") : Promise.resolve(null)), [enabled], { live: true });
  return (data?.tree ?? []).reduce((a, d) => a + d.counts.new + d.counts.learn + d.counts.review, 0);
}

export default function App() {
  const [creds, setCreds] = useState<Credentials | null | undefined>(undefined);
  const navigate = useNavigate();
  const loc = useLocation();
  const dark = useIsDark();
  const due = useDueCount(!!creds);

  useEffect(() => {
    loadCredentials().then((c) => {
      setCredentials(c);
      setCreds(c);
    });
    setUnauthorizedHandler(() => {
      setCredentials(null);
      setCreds(null);
    });
  }, []);

  useEffect(() => {
    if (!creds) return;
    return subscribeEvents(emitChange);
  }, [creds]);

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {}
    await clearCredentials();
    setCredentials(null);
    setCreds(null);
    navigate("/");
  };

  if (creds === undefined) return <Loading />;
  if (!creds)
    return (
      <Connect
        onConnected={(c) => {
          setCredentials(c);
          setCreds(c);
        }}
      />
    );

  const studying = loc.pathname.startsWith("/study/");
  const transport = transportSecurity(creds.server || location.origin);

  return (
    <SessionCtx.Provider value={{ server: creds.server, username: creds.username, logout }}>
      <div className="flex h-full">
        {!studying && (
          <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-app bg-panel px-3 pt-5 pb-3">
            <div className="flex items-center gap-2 px-2 mb-6">
              <img src="/icon.svg" className="size-6" alt="" />
              <div className="text-[15px] font-semibold tracking-tight">Better Anki</div>
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-sm transition-colors", isActive ? "bg-panel-2 text-app font-medium" : "text-muted hover:text-app hover:bg-panel-2/60")}>
                  {({ isActive }) => (
                    <>
                      <n.icon className={cx("size-4", isActive ? "text-brand-600 dark:text-brand-400" : "text-faint")} />
                      <span className="flex-1">{n.label}</span>
                      {n.to === "/" && due > 0 && <span className="text-xs font-medium text-muted tnum">{due}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto border-t border-app pt-3 px-1">
              <div className="px-1.5 pb-2">
                <div className="truncate text-sm font-medium">{creds.username ?? "Signed in"}</div>
                <div className={cx("flex items-center gap-1 text-xs", transport.secure ? "text-muted" : "text-amber-600 dark:text-amber-400")} title={`Encrypted at rest · transport: ${transport.reason}`}>
                  {transport.secure ? <ShieldCheck className="size-3 text-green-600 dark:text-green-400" /> : <Lock className="size-3" />}
                  {transport.secure ? `Encrypted · ${transport.reason}` : "Unencrypted transport"}
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => applyTheme(dark ? "light" : "dark")} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg h-8 text-[13px] text-muted hover:bg-panel-2 hover:text-app">
                  {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
                  {dark ? "Light" : "Dark"}
                </button>
                <button onClick={logout} className="flex-1 flex items-center justify-center gap-1.5 rounded-lg h-8 text-[13px] text-muted hover:bg-panel-2 hover:text-app">
                  <LogOut className="size-3.5" /> Sign out
                </button>
              </div>
            </div>
          </aside>
        )}
        <main className={cx("flex-1 min-w-0 overflow-y-auto", !studying && "pb-20 md:pb-0")}>
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Decks />} />
              <Route path="/deck/:id" element={<DeckOverview />} />
              <Route path="/study/:id" element={<Study />} />
              <Route path="/add" element={<AddNote />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/notetypes" element={<Notetypes />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/options/:deckId" element={<DeckOptions />} />
              <Route path="*" element={<Decks />} />
            </Routes>
          </Suspense>
        </main>
        {!studying && (
          <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex justify-around border-t border-app bg-panel pb-[env(safe-area-inset-bottom)]">
            {MOBILE_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px]", isActive ? "text-brand-600 dark:text-brand-400 font-medium" : "text-muted")}>
                <n.icon className="size-5" />
                {n.label}
                {n.to === "/" && due > 0 && <span className="absolute top-1 left-[calc(50%+6px)] min-w-4 rounded-full bg-brand-600 px-1 text-[9px] font-semibold leading-4 text-white tnum">{due > 99 ? "99+" : due}</span>}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </SessionCtx.Provider>
  );
}
