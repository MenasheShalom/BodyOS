import { Link } from "react-router";
import type { MacroTargets, Nutrients } from "../../lib/types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

function Meter({ label, value, target }: { label: string; value: number; target: number }) {
  const over = value > target;
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  // Same-hue track under the fill; over target switches both to the warning hue.
  return (
    <div
      className={`h-2 overflow-hidden rounded-full ${over ? "bg-bad/15" : "bg-accent/15"}`}
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={target}
    >
      <div
        className={`h-full rounded-full ${over ? "bg-bad" : "bg-accent"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const MACROS: { key: "protein_g" | "carbs_g" | "fat_g"; label: string }[] = [
  { key: "protein_g", label: "Protein" },
  { key: "carbs_g", label: "Carbs" },
  { key: "fat_g", label: "Fat" },
];

type Props = { totals: Nutrients; target: MacroTargets | null };

export function NutritionSummary({ totals, target }: Props) {
  const kcal = totals.energy_kcal ?? 0;
  const remaining = target ? target.energy_kcal - kcal : null;
  return (
    <section aria-label="Daily summary" className="space-y-4 rounded-2xl bg-surface p-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p>
            <span className="readout text-3xl">{fmt(kcal)}</span>
            <span className="ml-1 text-sm text-muted">
              {target ? `of ${fmt(target.energy_kcal)} kcal` : "kcal"}
            </span>
          </p>
          {remaining != null && (
            <p className={`text-sm ${remaining < 0 ? "text-bad" : "text-muted"}`}>
              {remaining < 0 ? `${fmt(-remaining)} over` : `${fmt(remaining)} left`}
            </p>
          )}
        </div>
        {target && (
          <div className="mt-2">
            <Meter label="Calories" value={kcal} target={target.energy_kcal} />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {MACROS.map(({ key, label }, i) => {
          const value = totals[key] ?? 0;
          const goal = target?.[key];
          return (
            <div key={key} className={i === 0 ? "sm:col-span-1" : undefined}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className={i === 0 ? "font-medium" : "text-muted"}>{label}</span>
                <span className="tabular">
                  {fmt(value)}
                  {goal != null ? ` / ${fmt(goal)} g` : " g"}
                </span>
              </div>
              {goal != null && <Meter label={label} value={value} target={goal} />}
            </div>
          );
        })}
      </div>

      {!target && (
        <Link to="/nutrition/setup" className="block text-sm text-accent">
          Set targets
        </Link>
      )}
    </section>
  );
}
