import { formatDay, formatValue } from "../lib/format";
import { metricInfo } from "../lib/metrics";
import type { Goal } from "../lib/types";

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

export function GoalProgress({ goal }: { goal: Goal }) {
  const { label, unit } = metricInfo(goal.metric);
  const pct = goal.projection.progress_pct ?? 0;
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
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {Math.round(pct)}% of the way. {goalStatusText(goal)}
        {goal.target_date && `. Target date ${formatDay(goal.target_date)}`}
      </p>
    </div>
  );
}
