import { ChartLine, Ellipsis, House, Images, Plus } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { env } from "../lib/env";
import { LogSheet } from "./LogSheet";
import { WakingBanner } from "./WakingBanner";

export type LogTab = "weigh-in" | "measurements" | "photo";
type LogSheetApi = { open: (tab?: LogTab) => void };
const LogSheetContext = createContext<LogSheetApi>({ open: () => {} });

export function useLogSheet(): LogSheetApi {
  return useContext(LogSheetContext);
}

const NAV = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/trends", label: "Trends", icon: ChartLine, end: false },
  { to: "/photos", label: "Photos", icon: Images, end: false },
  { to: "/more", label: "More", icon: Ellipsis, end: false },
];

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2 ${isActive ? "bg-surface text-text" : "text-muted hover:text-text"}`;
const tabLink = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? "text-accent" : "text-muted"}`;

export function AppLayout() {
  const [sheetTab, setSheetTab] = useState<LogTab | null>(null);
  const logSheet = useMemo<LogSheetApi>(
    () => ({ open: (tab = "weigh-in") => setSheetTab(tab) }),
    [],
  );

  useEffect(() => {
    // Warm up the Render instance while the user looks around.
    void fetch(`${env.apiUrl}/health`).catch(() => {});
  }, []);

  return (
    <LogSheetContext.Provider value={logSheet}>
      <WakingBanner />
      <div className="md:flex">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-border p-4 md:flex">
          <p className="readout mb-4 px-3 text-lg">BodyOS</p>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={sideLink}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => logSheet.open()}
            className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-accent py-2 font-medium text-bg"
          >
            <Plus size={18} /> Log
          </button>
        </aside>
        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:pb-10">
          <Outlet />
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.slice(0, 2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabLink}>
            <Icon size={20} /> {label}
          </NavLink>
        ))}
        <button
          type="button"
          aria-label="Log"
          onClick={() => logSheet.open()}
          className="mx-auto -mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg shadow-lg"
        >
          <Plus size={26} />
        </button>
        {NAV.slice(2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabLink}>
            <Icon size={20} /> {label}
          </NavLink>
        ))}
      </nav>
      {sheetTab && <LogSheet initialTab={sheetTab} onClose={() => setSheetTab(null)} />}
    </LogSheetContext.Provider>
  );
}
