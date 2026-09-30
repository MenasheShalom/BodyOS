import { useSearchParams } from "react-router";
import { TrendChart } from "../components/charts/TrendChart";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { bmiZone, healthyWeightRange } from "../lib/bmi";
import { formatChange, formatValue } from "../lib/format";
import { SERIES_METRICS } from "../lib/metrics";
import { goals, useProfile, useSeries } from "../lib/queries";
import type { RangeKey } from "../lib/types";

const RANGES: RangeKey[] = ["1M", "3M", "6M", "1Y", "ALL"];
const GROUPS = ["Composition", "Scale", "Tape"] as const;

function MetricSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-xl border border-border bg-surface px-3 py-2"
    >
      {GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {SERIES_METRICS.filter((m) => m.group === g).map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function Trends() {
  const [params, setParams] = useSearchParams();
  const metric = params.get("metric") ?? "fat_mass_kg";
  const range = (params.get("range") as RangeKey | null) ?? "3M";
  const vs = params.get("vs");
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const primary = useSeries(metric, range, true);
  const secondary = useSeries(vs ?? metric, range, vs !== null);
  const goalList = goals.useList();
  const profile = useProfile();
  const goalValue =
    goalList.data?.find((g) => g.metric === metric && g.status === "active")?.target_value ??
    null;
  const s = primary.data;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Trends</h1>
      <div className="flex flex-wrap items-center gap-2">
        <MetricSelect label="Metric" value={metric} onChange={(v) => update({ metric: v })} />
        {vs !== null ? (
          <>
            <span className="text-sm text-muted">and</span>
            <MetricSelect label="Compare with" value={vs} onChange={(v) => update({ vs: v })} />
            <button
              type="button"
              onClick={() => update({ vs: null })}
              className="text-sm text-muted underline"
            >
              Remove
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() =>
              update({ vs: metric === "fat_mass_kg" ? "lean_mass_kg" : "fat_mass_kg" })
            }
            className="text-sm text-muted underline"
          >
            Compare with another metric
          </button>
        )}
      </div>
      <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={r === range}
            onClick={() => update({ range: r })}
            className={`flex-1 rounded-lg py-1.5 text-sm ${
              r === range ? "bg-surface text-text shadow-sm" : "text-muted"
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {primary.isPending && <Spinner />}
      {primary.isError && (
        <ErrorState message={primary.error.message} onRetry={() => void primary.refetch()} />
      )}
      {s && s.points.length < 2 && (
        <EmptyState
          title="Not enough data yet"
          body={`Log at least 2 ${s.label.toLowerCase()} readings in this range to see a trend.`}
        />
      )}
      {s && s.points.length >= 2 && (
        <>
          <div className="rounded-2xl bg-surface p-4">
            <TrendChart
              primary={s}
              secondary={vs !== null ? secondary.data : undefined}
              goalValue={goalValue}
            />
          </div>
          {metric === "bmi" && s.latest != null && (
            <div className="space-y-1 rounded-2xl bg-surface p-4 text-sm">
              <p className="font-medium">
                You're in the {bmiZone(s.latest)} range (BMI {s.latest.toFixed(1)})
              </p>
              {profile.data && (
                <p className="text-muted">
                  {(() => {
                    const [lo, hi] = healthyWeightRange(profile.data.height_cm);
                    return `Healthy BMI (18.5–24.9) for ${profile.data.height_cm} cm is ${lo.toFixed(1)}–${hi.toFixed(1)} kg`;
                  })()}
                </p>
              )}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Change", formatChange(s.change, s.unit)],
              [
                "Weekly rate",
                s.weekly_rate == null ? "—" : `${formatChange(s.weekly_rate, s.unit)}/wk`,
              ],
              ["Low", formatValue(s.min, s.unit)],
              ["High", formatValue(s.max, s.unit)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-surface p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="readout mt-1 text-lg">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
