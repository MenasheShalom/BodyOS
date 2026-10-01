import { useState } from "react";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { FoodName } from "../components/nutrition/FoodName";
import { useDeleteSavedMeal, useSavedMeals } from "../lib/queries";
import { amountLabel } from "../lib/serving";

export function SavedMeals() {
  const meals = useSavedMeals();
  const remove = useDeleteSavedMeal();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Saved meals</h1>
      {meals.isPending ? (
        <Spinner />
      ) : meals.isError ? (
        <ErrorState message={meals.error.message} onRetry={() => void meals.refetch()} />
      ) : meals.data.length === 0 ? (
        <EmptyState
          title="No saved meals yet"
          body='On the Food tab, use "Save as meal" on any meal you eat often.'
        />
      ) : (
        meals.data.map((m) => (
          <details key={m.id} className="rounded-2xl bg-surface">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
              <span dir="auto" className="truncate text-left font-medium">
                {m.name}
              </span>
              <span className="tabular shrink-0 text-sm text-muted">
                {Math.round(m.totals.energy_kcal ?? 0)} kcal
              </span>
            </summary>
            <ul className="divide-y divide-border border-t border-border">
              {m.items.map((item, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0">
                    <FoodName name={item.name} />
                    <span className="block text-xs text-muted">{amountLabel(item) || "—"}</span>
                  </span>
                  <span className="tabular shrink-0">
                    {Math.round(item.nutrients.energy_kcal ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="px-4 py-3 text-sm">
              {confirming === m.id ? (
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => remove.mutate(m.id, { onSettled: () => setConfirming(null) })}
                    className="rounded-lg bg-bad px-3 py-1.5 text-bg"
                  >
                    Delete meal
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="px-3 py-1.5">
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirming(m.id)} className="text-bad">
                  Delete
                </button>
              )}
            </div>
          </details>
        ))
      )}
    </section>
  );
}
