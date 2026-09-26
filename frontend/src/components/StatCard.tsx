import { Link } from "react-router";
import { changeTone, type Direction, formatChange, formatValue } from "../lib/format";
import type { MetricSummary } from "../lib/types";
import { Sparkline } from "./charts/Sparkline";

const TONE_CLASS = { good: "text-good", bad: "text-bad", neutral: "text-muted" } as const;
const SIZE_CLASS = { hero: "text-4xl", card: "text-2xl", mini: "text-lg" } as const;

type Props = {
  summary: MetricSummary;
  fallbackDirection?: Direction | null;
  size?: "hero" | "card" | "mini";
  showSparkline?: boolean;
  /** Series colour shown as a small marker next to the label (identity, never text). */
  marker?: string;
};

export function StatCard({
  summary,
  fallbackDirection = null,
  size = "card",
  showSparkline = false,
  marker,
}: Props) {
  const tone = changeTone(summary.change_30d, summary.goal_direction ?? fallbackDirection);
  return (
    <Link
      to={`/trends?metric=${summary.metric}`}
      className="block rounded-2xl bg-surface p-4 hover:bg-surface-2"
    >
      <p className="flex items-center gap-2 text-sm text-muted">
        {marker && (
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: marker }} />
        )}
        {summary.label}
      </p>
      <p className={`readout mt-1 ${SIZE_CLASS[size]}`}>
        {formatValue(summary.latest, summary.unit)}
      </p>
      {size !== "mini" && summary.change_30d != null && (
        <p className="tabular mt-1 text-sm">
          <span className={TONE_CLASS[tone]} data-tone={tone}>
            {formatChange(summary.change_30d, summary.unit)}
          </span>{" "}
          <span className="text-muted">in 30 days</span>
        </p>
      )}
      {showSparkline && summary.sparkline.length > 1 && (
        <Sparkline points={summary.sparkline} color={marker} />
      )}
    </Link>
  );
}
