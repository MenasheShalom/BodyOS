import { Plus } from "lucide-react";
import { Link } from "react-router";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { useRecipes } from "../lib/queries";

export function Recipes() {
  const recipes = useRecipes();
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recipes</h1>
        <Link
          to="/nutrition/recipes/new"
          className="flex items-center gap-1 rounded-xl bg-accent px-3 py-1.5 text-sm font-medium text-bg"
        >
          <Plus size={16} /> New recipe
        </Link>
      </div>
      {recipes.isPending ? (
        <Spinner />
      ) : recipes.isError ? (
        <ErrorState message={recipes.error.message} onRetry={() => void recipes.refetch()} />
      ) : recipes.data.length === 0 ? (
        <EmptyState
          title="No recipes yet"
          body="Add the ingredients once, then log a serving whenever you eat it."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
          {recipes.data.map((r) => (
            <li key={r.id}>
              <Link
                to={`/nutrition/recipes/${r.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span dir="auto" className="truncate text-left">
                  {r.name}
                </span>
                <span className="tabular shrink-0 text-sm text-muted">
                  {Math.round(r.per_serving.energy_kcal ?? 0)} kcal · {r.serving_grams} g a serving
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
