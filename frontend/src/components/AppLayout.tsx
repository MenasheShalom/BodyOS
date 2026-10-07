import { ChartLine, Ellipsis, House, Images, Plus, Utensils } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { env } from "../lib/env";
import type { Meal } from "../lib/types";
import { LogSheet } from "./LogSheet";
import { TrophyCelebration } from "./trophies/TrophyCelebration";
import { WakingBanner } from "./WakingBanner";

export type LogTab = "food" | "weigh-in" | "measurements" | "photo";
/** Where food gets logged when the sheet opens on the Food tab. */
export type FoodTarget = { day?: string; meal?: Meal };
type LogSheetApi = { open: (tab?: LogTab, food?: FoodTarget) => void };
const LogSheetContext = createContext<LogSheetApi>({ open: () => {} });

export function useLogSheet(): LogSheetApi {
  return useContext(LogSheetContext);
}

// Photos lives under More on phones; the sidebar has room for it.
const NAV = [
  { to: "/", label: "Home", icon: House, end: true, mobile: true },
  { to: "/food", label: "Food", icon: Utensils, end: false, mobile: true },
  { to: "/trends", label: "Trends", icon: ChartLine, end: false, mobile: true },
  { to: "/photos", label: "Photos", icon: Images, end: false, mobile: false },
  { to: "/more", label: "More", icon: Ellipsis, end: false, mobile: true },
];
const MOBILE_NAV = NAV.filter((n) => n.mobile);

const sideLink = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2 ${isActive ? "bg-surface text-text" : "text-muted hover:text-text"}`;
const tabLink = ({ isActive }: { isActive: boolean }) =>
  `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? "text-accent" : "text-muted"}`;

export function AppLayout() {
  const [sheet, setSheet] = useState<{ tab: LogTab; food: FoodTarget } | null>(null);
  const logSheet = useMemo<LogSheetApi>(
    () => ({ open: (tab = "weigh-in", food = {}) => setSheet({ tab, food }) }),
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
        {MOBILE_NAV.slice(0, 2).map(({ to, label, icon: Icon, end }) => (
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
        {MOBILE_NAV.slice(2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={tabLink}>
            <Icon size={20} /> {label}
          </NavLink>
        ))}
      </nav>
      <TrophyCelebration />
      {sheet && (
        <LogSheet initialTab={sheet.tab} food={sheet.food} onClose={() => setSheet(null)} />
      )}
    </LogSheetContext.Provider>
  );
}
