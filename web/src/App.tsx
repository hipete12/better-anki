import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Layers, Plus, Search, BarChart3, Settings, LogOut, Shapes, ShieldCheck, Moon, Sun, Lock } from "lucide-react";
import { api, setCredentials, setUnauthorizedHandler, subscribeEvents, transportSecurity } from "./lib/api";
import { loadCredentials, clearCredentials, type Credentials } from "./lib/secureStore";
import { emitChange, SessionCtx, useIsDark, applyTheme } from "./lib/hooks";
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
  { to: "/notetypes", label: "Note Types", icon: Shapes, desktopOnly: true },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function App() {
  const [creds, setCreds] = useState<Credentials | null | undefined>(undefined);
  const navigate = useNavigate();
  const loc = useLocation();
  const dark = useIsDark();

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
          <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-app bg-panel px-3 py-4">
            <div className="flex items-center gap-2.5 px-2 mb-6">
              <img src="/icon.svg" className="size-8" alt="" />
              <div>
                <div className="font-bold tracking-tight leading-tight">Better Anki</div>
                <div className="text-[11px] text-muted leading-tight">{creds.username ?? "signed in"}</div>
              </div>
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 h-10 text-sm font-medium transition", isActive ? "bg-brand-500/12 text-brand-700 dark:text-brand-300" : "text-muted hover:text-app hover:bg-panel-2")}>
                  <n.icon className="size-[18px]" />
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-auto flex flex-col gap-2">
              <div className={cx("flex items-center gap-2 rounded-xl px-3 py-2 text-xs", transport.secure ? "bg-green-500/10 text-green-700 dark:text-green-300" : "bg-amber-500/12 text-amber-700 dark:text-amber-300")} title="Data is AES-256 encrypted at rest on the server">
                {transport.secure ? <ShieldCheck className="size-4" /> : <Lock className="size-4" />}
                <span>
                  Encrypted at rest
                  <br />
                  <span className="opacity-80">Transport: {transport.reason}</span>
                </span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => applyTheme(dark ? "light" : "dark")} className="flex-1 flex items-center justify-center gap-2 rounded-xl h-9 text-sm text-muted hover:bg-panel-2 hover:text-app">
                  {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {dark ? "Light" : "Dark"}
                </button>
                <button onClick={logout} className="flex-1 flex items-center justify-center gap-2 rounded-xl h-9 text-sm text-muted hover:bg-panel-2 hover:text-app">
                  <LogOut className="size-4" /> Sign out
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
          <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 flex justify-around border-t border-app bg-panel/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
            {NAV.filter((n) => !n.desktopOnly).map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx("flex flex-col items-center gap-0.5 py-2 px-3 text-[11px] font-medium", isActive ? "text-brand-600 dark:text-brand-300" : "text-muted")}>
                <n.icon className="size-5" />
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </SessionCtx.Provider>
  );
}
