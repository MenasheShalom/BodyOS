import { Camera, ChevronRight, Images, Plus, Scale, Utensils } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { type LogTab, useLogSheet } from "../components/AppLayout";
import { ReportCard } from "../components/ai/ReportCard";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { GoalProgress } from "../components/GoalProgress";
import { CheckInCard } from "../components/nutrition/CheckInCard";
import { FoodTodayCard } from "../components/nutrition/FoodTodayCard";
import { RecentWeighIns } from "../components/RecentWeighIns";
import { StatCard } from "../components/StatCard";
import { TrainingCard } from "../components/training/TrainingCard";
import type { Direction } from "../lib/format";
import { useDashboard } from "../lib/queries";
import type { Dashboard } from "../lib/types";

export const DEFAULT_DIRECTION: Record<string, Direction> = {
  weight_kg: "down",
  body_fat_pct: "down",
  muscle_mass_kg: "up",
  waist_cm: "down",
};

const MARKER: Record<string, string> = {
  weight_kg: "var(--color-series-1)",
  body_fat_pct: "var(--color-series-2)",
  muscle_mass_kg: "var(--color-series-1)",
  waist_cm: "var(--color-series-2)",
};

const NUDGE_ICON: Record<LogTab, typeof Scale> = {
  food: Utensils,
  "weigh-in": Scale,
  measurements: Scale,
  photo: Camera,
};

export function greeting(now: Date): string {
  const h = now.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

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

  const tracked = d.cards.filter((s) => s.latest != null);
  const untracked = d.cards.filter((s) => s.latest == null);
  const now = new Date();

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted">
          {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </p>
        <h1 className="readout mt-0.5 text-2xl">{greeting(now)}</h1>
      </header>

      {nudgeMessages(d.nudges).length > 0 && (
        <div className="space-y-2">
          {nudgeMessages(d.nudges).map((n) => {
            const Icon = NUDGE_ICON[n.tab];
            return (
              <button
                key={n.text}
                type="button"
                onClick={() => logSheet.open(n.tab)}
                className="flex w-full items-center gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/15"
              >
                <Icon size={18} aria-hidden="true" className="shrink-0 text-accent" />
                <span className="flex-1">{n.text}</span>
                <ChevronRight size={18} aria-hidden="true" className="text-muted" />
              </button>
            );
          })}
        </div>
      )}

      {d.check_in && <CheckInCard suggestion={d.check_in} />}
      <ReportCard />

      <Section
        title="Body composition"
        action={
          <Link to="/trends" className="text-sm text-muted underline">
            Trends
          </Link>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {d.hero.map((s) => (
            <StatCard
              key={s.metric}
              summary={s}
              size="hero"
              showSparkline
              marker={MARKER[s.metric]}
              fallbackDirection={DEFAULT_DIRECTION[s.metric]}
            />
          ))}
          {tracked.map((s) => (
            <StatCard
              key={s.metric}
              summary={s}
              showSparkline
              marker={MARKER[s.metric]}
              fallbackDirection={DEFAULT_DIRECTION[s.metric]}
            />
          ))}
          {d.secondary.map((s) => (
            <StatCard key={s.metric} summary={s} showSparkline />
          ))}
          {untracked.length > 0 && (
            <button
              type="button"
              onClick={() =>
                logSheet.open(untracked.some((s) => s.metric === "waist_cm") ? "measurements" : "weigh-in")
              }
              className="flex flex-col items-start justify-between gap-2 rounded-2xl border border-dashed border-border p-4 text-left text-sm transition-colors hover:bg-surface"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-accent">
                <Plus size={16} aria-hidden="true" />
              </span>
              <span>
                <span className="block font-medium">Track more</span>
                <span className="block text-muted">
                  Add {untracked.map((s) => s.label.toLowerCase()).join(" and ")} to see them here
                </span>
              </span>
            </button>
          )}
        </div>
      </Section>

      <Section title="Goals">
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
      </Section>

      {d.food_today && (
        <Section title="Today">
          <FoodTodayCard food={d.food_today} />
          <TrainingCard />
        </Section>
      )}
      {!d.food_today && <TrainingCard />}

      <RecentWeighIns />

      <Link
        to="/photos"
        className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 text-sm transition-colors hover:bg-surface-2"
      >
        <span className="flex items-center gap-2">
          <Images size={18} className="text-muted" /> Progress photos
        </span>
        <span className="flex items-center gap-2 text-muted">
          {d.nudges.days_since_photo != null && (
            <span className="tabular">
              {d.nudges.days_since_photo === 0 ? "Today" : `${d.nudges.days_since_photo}d ago`}
            </span>
          )}
          <ChevronRight size={18} />
        </span>
      </Link>
    </div>
  );
}
