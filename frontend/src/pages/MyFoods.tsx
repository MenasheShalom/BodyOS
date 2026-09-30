import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { FoodName } from "../components/nutrition/FoodName";
import { useDeleteCustomFood, useMyFoods } from "../lib/queries";

export function MyFoods() {
  const foods = useMyFoods();
  const remove = useDeleteCustomFood();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My foods</h1>
        <Link
          to="/nutrition/foods/new"
          className="flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-bg"
        >
          <Plus size={16} /> New food
        </Link>
      </div>
      {foods.isPending ? (
        <Spinner />
      ) : foods.isError ? (
        <ErrorState message={foods.error.message} onRetry={() => void foods.refetch()} />
      ) : foods.data.length === 0 ? (
        <EmptyState
          title="No foods yet"
          body="Create foods for home recipes or products the database doesn't have."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
          {foods.data.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link to={`/nutrition/foods/${f.id}`} className="min-w-0 flex-1">
                <FoodName name={f.name} brand={f.brand} />
                <span className="text-xs text-muted">
                  {Math.round(f.nutrients_per_100g.energy_kcal ?? 0)} kcal per 100{" "}
                  {f.is_liquid ? "ml" : "g"}
                </span>
              </Link>
              {confirming === f.id ? (
                <span className="flex shrink-0 gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => remove.mutate(f.id!, { onSettled: () => setConfirming(null) })}
                    className="rounded-lg bg-bad px-2 py-1 text-bg"
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirming(null)} className="px-2 py-1">
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  aria-label={`Delete ${f.name}`}
                  onClick={() => setConfirming(f.id)}
                  className="shrink-0 text-sm text-muted"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirming && (
        <p className="text-sm text-muted">Past days keep this food; it just leaves your list.</p>
      )}
    </section>
  );
}
