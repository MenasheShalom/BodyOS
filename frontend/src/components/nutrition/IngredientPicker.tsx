import { Search } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api";
import { useCombinedFoodSearch } from "../../lib/foodSearch";
import { useImportFood } from "../../lib/queries";
import type { Food } from "../../lib/types";
import { Modal } from "../Modal";
import { FoodName } from "./FoodName";

/** Search own and database foods to use as a recipe ingredient (recipes excluded). */
export function IngredientPicker({
  onPick,
  onClose,
}: {
  onPick: (food: Food & { id: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const search = useCombinedFoodSearch(q);
  const importFood = useImportFood();
  const foods = [...search.mine.filter((f) => f.source !== "recipe"), ...search.found];

  const pick = async (food: Food) => {
    setError(null);
    try {
      onPick((food.id ? food : await importFood.mutateAsync(food)) as Food & { id: string });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't add that food. Try again.");
    }
  };

  return (
    <Modal title="Add ingredient" onClose={onClose}>
      <div className="space-y-3">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            search.submit();
          }}
          className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-accent"
        >
          <Search size={18} className="text-muted" />
          <input
            autoFocus
            type="search"
            dir="auto"
            aria-label="Search ingredients"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-transparent py-2.5 outline-none focus-visible:outline-none"
          />
        </form>
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
        {foods.length > 0 && (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {foods.map((f) => (
              <li key={f.id ?? `${f.source}:${f.source_ref}`}>
                <button
                  type="button"
                  onClick={() => void pick(f)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
                >
                  <FoodName name={f.name} brand={f.brand} />
                  <span className="tabular shrink-0 text-xs text-muted">
                    {Math.round(f.nutrients_per_100g.energy_kcal ?? 0)} kcal/100 g
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {search.searching && (
          <p role="status" className="text-sm text-muted">
            Searching Open Food Facts and USDA…
          </p>
        )}
      </div>
    </Modal>
  );
}
