import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useLogSheet } from "../components/AppLayout";
import { ErrorState, Spinner } from "../components/EmptyState";
import { DateStrip } from "../components/nutrition/DateStrip";
import { EntrySheet } from "../components/nutrition/EntrySheet";
import { MealSection } from "../components/nutrition/MealSection";
import { NutritionSummary } from "../components/nutrition/NutritionSummary";
import { isoDay, MEALS } from "../lib/meals";
import { useFoodDay, useNutritionSettings } from "../lib/queries";
import type { FoodLogEntry } from "../lib/types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function Food() {
  const [params, setParams] = useSearchParams();
  const today = isoDay(new Date());
  const requested = params.get("day");
  const day = requested && DAY.test(requested) && requested <= today ? requested : today;
  const foodDay = useFoodDay(day);
  const settings = useNutritionSettings();
  const logSheet = useLogSheet();
  const [editing, setEditing] = useState<FoodLogEntry | null>(null);

  const setDay = (d: string) => setParams(d === today ? {} : { day: d });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Food</h1>
      <DateStrip day={day} today={today} onChange={setDay} />

      {settings.data && !settings.data.configured && (
        <Link
          to="/nutrition/setup"
          className="block rounded-2xl border border-dashed border-border p-4 text-sm"
        >
          <span className="block font-medium">Set up nutrition targets</span>
          <span className="text-muted">
            Get calorie and protein targets for your recomposition.
          </span>
        </Link>
      )}

      {foodDay.isPending ? (
        <Spinner />
      ) : foodDay.isError ? (
        <ErrorState message={foodDay.error.message} onRetry={() => void foodDay.refetch()} />
      ) : (
        <>
          <NutritionSummary totals={foodDay.data.totals} target={foodDay.data.target} />
          {MEALS.map((m) => (
            <MealSection
              key={m.key}
              label={m.label}
              entries={foodDay.data.entries.filter((e) => e.meal === m.key)}
              onAdd={() => logSheet.open("food", { day, meal: m.key })}
              onOpen={setEditing}
            />
          ))}
        </>
      )}
      {editing && <EntrySheet entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
