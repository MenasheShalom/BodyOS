import { useState } from "react";
import { NUTRIENT } from "../../lib/nutrients";
import { useMicros } from "../../lib/queries";
import type { Micro } from "../../lib/types";
import { ErrorState, Spinner } from "../EmptyState";

const STATUS_TEXT: Record<Micro["status"], string> = {
  ok: "",
  low: "Low",
  over_limit: "Over",
  not_enough_data: "Not enough data",
  no_reference: "",
};

const num = (n: number) =>
  n >= 100 ? Math.round(n).toLocaleString("en-GB") : String(Number(n.toFixed(1)));

function Row({ m }: { m: Micro }) {
  const spec = NUTRIENT[m.key];
  const unknown = m.status === "not_enough_data";
  const pct = m.average != null && m.reference ? m.average / m.reference : null;
  const over = m.status === "over_limit";
  // Same-hue track under the fill; over a limit both turn to the warning hue. Not enough data
  // stays grey and says so, so a gap in the food data never reads as a deficiency.
  const fill = unknown ? "bg-muted/40" : over ? "bg-bad" : "bg-accent";
  const track = unknown ? "bg-muted/15" : over ? "bg-bad/15" : "bg-accent/15";
  const target =
    m.reference == null
      ? null
      : m.kind === "limit"
        ? `stay under ${num(m.reference)} ${spec.unit}`
        : `of ${num(m.reference)} ${spec.unit}`;
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={unknown ? "text-muted" : undefined}>{spec.label}</span>
        <span className="tabular text-right">
          {m.average == null ? "—" : `${num(m.average)} ${spec.unit}`}
          {target && <span className="text-muted"> {target}</span>}
        </span>
      </div>
      {m.reference != null && (
        <div
          className={`mt-1.5 h-2 overflow-hidden rounded-full ${track}`}
          role="meter"
          aria-label={spec.label}
          aria-valuenow={m.average ?? 0}
          aria-valuemin={0}
          aria-valuemax={m.reference}
        >
          <div
            className={`h-full rounded-full ${fill}`}
            style={{ width: `${unknown ? 0 : Math.min(100, (pct ?? 0) * 100)}%` }}
          />
        </div>
      )}
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span className={m.status === "low" || over ? "text-text" : undefined}>
          {STATUS_TEXT[m.status]}
          {unknown && ` (${Math.round(m.coverage * 100)}% of your food reports it)`}
        </span>
        {pct != null && !unknown && <span className="tabular">{Math.round(pct * 100)}%</span>}
      </div>
    </li>
  );
}

/** Averages over recent logged days against reference intakes (spec §5.5). */
export function NutrientsTab() {
  const [window, setWindow] = useState<7 | 28>(7);
  const micros = useMicros(window);
  return (
    <section aria-label="Nutrients" className="space-y-3">
      <div role="radiogroup" aria-label="Period" className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {([7, 28] as const).map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={window === w}
            onClick={() => setWindow(w)}
            className={`flex-1 rounded-lg py-1.5 text-sm ${
              window === w ? "bg-surface shadow-sm" : "text-muted"
            }`}
          >
            Last {w} days
          </button>
        ))}
      </div>
      {micros.isPending ? (
        <Spinner />
      ) : micros.isError ? (
        <ErrorState message={micros.error.message} onRetry={() => void micros.refetch()} />
      ) : micros.data.days_counted === 0 ? (
        <p className="rounded-2xl bg-surface p-4 text-sm text-muted">
          Log food for a few days to see your averages here.
        </p>
      ) : (
        <div className="rounded-2xl bg-surface px-4 py-2">
          <p className="py-1 text-xs text-muted">
            Daily average over {micros.data.days_counted} logged{" "}
            {micros.data.days_counted === 1 ? "day" : "days"}
          </p>
          <ul className="divide-y divide-border">
            {micros.data.nutrients.map((m) => (
              <Row key={m.key} m={m} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
