import { formatDay, formatValue } from "../lib/format";
import { metricInfo } from "../lib/metrics";
import type { Goal } from "../lib/types";

const STATE_CLASS: Record<Goal["projection"]["state"], string> = {
  on_track: "text-good",
  reached: "text-good",
  not_on_pace: "text-bad",
  insufficient_data: "text-muted",
};

export function goalStatusText(goal: Goal): string {
  const p = goal.projection;
  switch (p.state) {
    case "on_track":
      return p.projected_date ? `On track for ${formatDay(p.projected_date)}` : "On track";
    case "reached":
      return "Goal reached";
    case "not_on_pace":
      return "Not on pace at current rate";
    default:
      return "Need more data";
  }
}

/** How far is left to the target, e.g. "8.7 pts to go". */
export function remainingText(goal: Goal, unit: string): string | null {
  const current = goal.projection.current;
  if (current == null || goal.projection.state === "reached") return null;
  const left = Math.abs(goal.target_value - current);
  // A gap in a percentage is in percentage points.
  return `${formatValue(left, unit === "%" ? "pts" : unit)} to go`;
}

export function GoalProgress({ goal }: { goal: Goal }) {
  const { label, unit } = metricInfo(goal.metric);
  const pct = goal.projection.progress_pct ?? 0;
  const remaining = remainingText(goal, unit);
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{label}</p>
        <p className="tabular text-sm text-muted">
          {formatValue(goal.projection.current, unit)} now, target{" "}
          {formatValue(goal.target_value, unit)}
        </p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} goal progress`}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <div className="tabular mt-1.5 flex justify-between text-xs text-muted">
        <span>
          Start {formatValue(goal.start_value, unit)} · {formatDay(goal.start_date)}
        </span>
        <span>{remaining ?? formatValue(goal.target_value, unit)}</span>
      </div>
      <p className="mt-2 text-sm">
        <span className={STATE_CLASS[goal.projection.state]}>{goalStatusText(goal)}</span>
        <span className="text-muted">
          {" "}
          · {Math.round(pct)}% of the way
          {goal.target_date && ` · target date ${formatDay(goal.target_date)}`}
        </span>
      </p>
    </div>
  );
}
