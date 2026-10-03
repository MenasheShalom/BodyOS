import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useLogSheet } from "../components/AppLayout";
import { ErrorState, Spinner } from "../components/EmptyState";
import { DateStrip } from "../components/nutrition/DateStrip";
import { EntrySheet } from "../components/nutrition/EntrySheet";
import { CheckInCard } from "../components/nutrition/CheckInCard";
import { CopyDialog, SaveMealDialog } from "../components/nutrition/MealDialogs";
import { MealSection } from "../components/nutrition/MealSection";
import { NutrientsTab } from "../components/nutrition/NutrientsTab";
import { NutritionSummary } from "../components/nutrition/NutritionSummary";
import { isoDay, MEALS } from "../lib/meals";
import { useFlagDay, useFoodDay, useNutritionSettings, useSuggestion } from "../lib/queries";
import type { FoodLogEntry, Meal } from "../lib/types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function Food() {
  const [params, setParams] = useSearchParams();
  const today = isoDay(new Date());
  const requested = params.get("day");
  const day = requested && DAY.test(requested) && requested <= today ? requested : today;
  const tab = params.get("tab") === "nutrients" ? "nutrients" : "day";
  const foodDay = useFoodDay(day);
  const settings = useNutritionSettings();
  const suggestion = useSuggestion();
  const flag = useFlagDay();
  const logSheet = useLogSheet();
  const [editing, setEditing] = useState<FoodLogEntry | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "copy"; meal?: Meal } | { kind: "save"; meal: Meal } | null
  >(null);

  const setDay = (d: string) => setParams(d === today ? {} : { day: d });
  const setTab = (t: "day" | "nutrients") =>
    setParams(t === "nutrients" ? { tab: t } : day === today ? {} : { day });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Food</h1>
      {suggestion.data && <CheckInCard suggestion={suggestion.data} />}
      <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {(
          [
            ["day", "Day"],
            ["nutrients", "Nutrients"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-1.5 text-sm ${
              tab === key ? "bg-surface shadow-sm" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "nutrients" ? (
        <NutrientsTab />
      ) : (
        <>
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
              {foodDay.data.excluded && (
                <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  Marked incomplete: this day isn't counted in your burn estimate or averages.
                </p>
              )}
              <NutritionSummary totals={foodDay.data.totals} target={foodDay.data.target} />
              {MEALS.map((m) => (
                <MealSection
                  key={m.key}
                  label={m.label}
                  entries={foodDay.data.entries.filter((e) => e.meal === m.key)}
                  onAdd={() => logSheet.open("food", { day, meal: m.key })}
                  onOpen={setEditing}
                  onCopy={() => setDialog({ kind: "copy", meal: m.key })}
                  onSave={() => setDialog({ kind: "save", meal: m.key })}
                />
              ))}
              <div className="flex flex-col items-center gap-1 text-sm text-muted">
                <button type="button" onClick={() => setDialog({ kind: "copy" })} className="py-1">
                  Copy a whole day into this one…
                </button>
                {foodDay.data.entries.length > 0 && (
                  <button
                    type="button"
                    disabled={flag.isPending}
                    onClick={() => flag.mutate({ day, excluded: !foodDay.data.excluded })}
                    className="py-1"
                  >
                    {foodDay.data.excluded
                      ? "Count this day again"
                      : "Mark day incomplete (leave it out of your averages)"}
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      {editing && <EntrySheet entry={editing} onClose={() => setEditing(null)} />}
      {dialog?.kind === "copy" && (
        <CopyDialog day={day} meal={dialog.meal} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "save" && (
        <SaveMealDialog day={day} meal={dialog.meal} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
