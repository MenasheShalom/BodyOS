import { ChevronRight, Images } from "lucide-react";
import { Link } from "react-router";
import { type LogTab, useLogSheet } from "../components/AppLayout";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { GoalProgress } from "../components/GoalProgress";
import { CheckInCard } from "../components/nutrition/CheckInCard";
import { FoodTodayCard } from "../components/nutrition/FoodTodayCard";
import { RecentWeighIns } from "../components/RecentWeighIns";
import { StatCard } from "../components/StatCard";
import type { Direction } from "../lib/format";
import { useDashboard } from "../lib/queries";
import type { Dashboard } from "../lib/types";

export const DEFAULT_DIRECTION: Record<string, Direction> = {
  fat_mass_kg: "down",
  lean_mass_kg: "up",
  body_fat_pct: "down",
  muscle_mass_kg: "up",
};

const MARKER: Record<string, string> = {
  fat_mass_kg: "var(--color-series-1)",
  lean_mass_kg: "var(--color-series-2)",
  body_fat_pct: "var(--color-series-1)",
  muscle_mass_kg: "var(--color-series-2)",
};

export function nudgeMessages(n: Dashboard["nudges"]): { text: string; tab: LogTab }[] {
  const out: { text: string; tab: LogTab }[] = [];
  if (n.no_food_today) {
    out.push({ text: "Nothing logged for food today yet", tab: "food" });
  }
  if (n.days_since_weigh_in != null && n.days_since_weigh_in >= 2) {
    out.push({ text: `Last weigh-in: ${n.days_since_weigh_in} days ago`, tab: "weigh-in" });
  }
  if (n.days_since_photo == null) {
    out.push({ text: "No progress photos yet. Add your first?", tab: "photo" });
  } else if (n.days_since_photo >= 28) {
    out.push({
      text: `No photos in ${Math.floor(n.days_since_photo / 7)} weeks. Time for a check-in?`,
      tab: "photo",
    });
  }
  return out;
}

export function Home() {
  const dashboard = useDashboard();
  const logSheet = useLogSheet();
  if (dashboard.isPending) return <Spinner />;
  if (dashboard.isError) {
    return (
      <ErrorState message={dashboard.error.message} onRetry={() => void dashboard.refetch()} />
    );
  }
  const d = dashboard.data;
  const hasData = [...d.hero, ...d.cards, ...d.secondary].some((s) => s.latest != null);

  if (!hasData) {
    return (
      <EmptyState
        title="Welcome to BodyOS"
        body="Log your first weigh-in to start seeing trends."
        action={
          <button
            type="button"
            onClick={() => logSheet.open("weigh-in")}
            className="rounded-xl bg-accent px-4 py-2 font-medium text-bg"
          >
            Log weigh-in
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {nudgeMessages(d.nudges).map((n) => (
        <button
          key={n.text}
          type="button"
          onClick={() => logSheet.open(n.tab)}
          className="block w-full rounded-2xl border border-border px-4 py-3 text-left text-sm"
        >
          {n.text}
        </button>
      ))}

      {d.check_in && <CheckInCard suggestion={d.check_in} />}

      <section aria-label="Body composition" className="grid grid-cols-2 gap-3">
        {d.hero.map((s) => (
          <StatCard
            key={s.metric}
            summary={s}
            size="hero"
            marker={MARKER[s.metric]}
            fallbackDirection={DEFAULT_DIRECTION[s.metric]}
          />
        ))}
      </section>

      {d.food_today && <FoodTodayCard food={d.food_today} />}

      <section className="grid grid-cols-2 gap-3">
        {d.cards.map((s) => (
          <StatCard
            key={s.metric}
            summary={s}
            showSparkline
            marker={MARKER[s.metric]}
            fallbackDirection={DEFAULT_DIRECTION[s.metric]}
          />
        ))}
      </section>

      <RecentWeighIns />

      <Link
        to="/photos"
        className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 text-sm"
      >
        <span className="flex items-center gap-2">
          <Images size={18} className="text-muted" /> Progress photos
        </span>
        <ChevronRight size={18} className="text-muted" />
      </Link>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Goals</h2>
        {d.goals.length === 0 ? (
          <Link
            to="/goals"
            className="block rounded-2xl border border-dashed border-border p-4 text-sm"
          >
            Set a goal for body fat or muscle mass
          </Link>
        ) : (
          d.goals.map((g) => <GoalProgress key={g.id} goal={g} />)
        )}
      </section>

      <section className="grid grid-cols-3 gap-3">
        {d.secondary.map((s) => (
          <StatCard key={s.metric} summary={s} size="mini" />
        ))}
      </section>
    </div>
  );
}
