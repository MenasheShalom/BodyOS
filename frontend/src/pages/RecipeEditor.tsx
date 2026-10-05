import { Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ErrorState, Spinner } from "../components/EmptyState";
import { Field } from "../components/Field";
import { FoodName } from "../components/nutrition/FoodName";
import { IngredientPicker } from "../components/nutrition/IngredientPicker";
import { ApiError } from "../lib/api";
import { NUTRIENT } from "../lib/nutrients";
import { useDeleteRecipe, useRecipes, useSaveRecipe } from "../lib/queries";
import { recipePreview } from "../lib/recipes";
import type { Nutrients, Recipe } from "../lib/types";

type Item = {
  food_id: string;
  name: string;
  brand: string | null;
  per100: Nutrients;
  grams: string;
};

const num = (raw: string): number | null => {
  const n = Number(raw.replace(",", "."));
  return raw.trim() === "" || Number.isNaN(n) ? null : n;
};

function itemsFrom(recipe: Recipe): Item[] {
  return recipe.items.map((i) => ({
    food_id: i.food_id,
    name: i.name,
    brand: i.brand,
    grams: String(i.grams),
    // the API returns each ingredient's nutrients for its amount; scale back to per 100 g
    per100: Object.fromEntries(
      Object.entries(i.nutrients).map(([k, v]) => [k, ((v ?? 0) * 100) / i.grams]),
    ),
  }));
}

function Editor({ recipe }: { recipe?: Recipe }) {
  const navigate = useNavigate();
  const save = useSaveRecipe();
  const remove = useDeleteRecipe();
  const [name, setName] = useState(recipe?.name ?? "");
  const [servings, setServings] = useState(String(recipe?.servings ?? 4));
  const [cooked, setCooked] = useState(
    recipe?.cooked_weight_g ? String(recipe.cooked_weight_g) : "",
  );
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [items, setItems] = useState<Item[]>(recipe ? itemsFrom(recipe) : []);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const servingsN = num(servings) ?? 0;
  const valid = items.map((i) => ({ grams: num(i.grams) ?? 0, per100: i.per100 }));
  const preview = recipePreview(valid, servingsN);
  const cookedN = num(cooked);
  const weight = cookedN ?? preview.totalGrams;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the recipe a name.");
    if (servingsN < 0.25 || servingsN > 100)
      return setError("Servings must be between 0.25 and 100.");
    if (items.length === 0) return setError("Add at least one ingredient.");
    if (valid.some((i) => i.grams < 0.1 || i.grams > 5000)) {
      return setError("Each ingredient needs a weight up to 5000 g.");
    }
    if (instructions.length > 4000) return setError("Keep the steps under 4000 characters.");
    if (cooked.trim() && (cookedN == null || cookedN < 1 || cookedN > 20000)) {
      return setError("Cooked weight must be between 1 and 20000 g.");
    }
    try {
      await save.mutateAsync({
        id: recipe?.id,
        body: {
          name: name.trim(),
          servings: servingsN,
          cooked_weight_g: cookedN,
          note: recipe?.note ?? null,
          instructions: instructions.trim() || null,
          items: items.map((i, n) => ({ food_id: i.food_id, grams: valid[n].grams })),
        },
      });
      void navigate("/nutrition/recipes");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <Field label="Name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Servings"
            inputMode="decimal"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
          <Field
            label="Cooked weight (optional)"
            unit="g"
            inputMode="decimal"
            hint="Weigh the pot's contents after cooking"
            value={cooked}
            onChange={(e) => setCooked(e.target.value)}
          />
        </div>
      </div>

      <section aria-label="Ingredients" className="space-y-2 rounded-2xl bg-surface p-4">
        <h2 className="font-medium">Ingredients</h2>
        {items.length === 0 && <p className="text-sm text-muted">No ingredients yet.</p>}
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li
              key={`${item.food_id}-${i}`}
              className="grid grid-cols-[1fr_6rem_auto] items-center gap-2"
            >
              <FoodName name={item.name} brand={item.brand} />
              <input
                aria-label={`Grams of ${item.name}`}
                inputMode="decimal"
                value={item.grams}
                onChange={(e) =>
                  setItems(items.map((x, j) => (j === i ? { ...x, grams: e.target.value } : x)))
                }
                className="tabular w-full rounded-xl border border-border bg-surface px-3 py-2"
              />
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="rounded-full p-2 text-muted"
              >
                <X size={18} />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex items-center gap-1 text-sm text-accent"
        >
          <Plus size={16} /> Add ingredient
        </button>
      </section>

      <label className="block rounded-2xl bg-surface p-4">
        <span className="mb-2 block font-medium">Steps (optional)</span>
        <textarea
          dir="auto"
          rows={5}
          maxLength={4000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface px-3 py-2"
        />
      </label>

      {items.length > 0 && (
        <section aria-label="Per serving" className="rounded-2xl bg-surface p-4 text-sm">
          <p className="mb-2 font-medium">
            Per serving{servingsN > 0 && weight > 0 ? ` (${Math.round(weight / servingsN)} g)` : ""}
          </p>
          <p className="tabular">
            {Math.round(preview.perServing.energy_kcal ?? 0)} kcal · P{" "}
            {Math.round(preview.perServing.protein_g ?? 0)} · C{" "}
            {Math.round(preview.perServing.carbs_g ?? 0)} · F{" "}
            {Math.round(preview.perServing.fat_g ?? 0)}
          </p>
          {preview.incomplete.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Left out because some ingredients don't report it:{" "}
              {preview.incomplete.map((k) => NUTRIENT[k].label).join(", ")}.
            </p>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={save.isPending}
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        Save recipe
      </button>
      {recipe &&
        (confirmDelete ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                remove.mutate(recipe.id, { onSuccess: () => void navigate("/nutrition/recipes") })
              }
              className="flex-1 rounded-xl bg-bad py-2.5 font-medium text-bg"
            >
              Delete recipe
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="flex-1 rounded-xl bg-surface-2 py-2.5"
            >
              Keep
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="w-full py-2.5 text-bad"
          >
            Delete
          </button>
        ))}
      {picking && (
        <IngredientPicker
          onClose={() => setPicking(false)}
          onPick={(food) => {
            setItems([
              ...items,
              {
                food_id: food.id,
                name: food.name,
                brand: food.brand,
                per100: food.nutrients_per_100g,
                grams: "100",
              },
            ]);
            setPicking(false);
          }}
        />
      )}
    </form>
  );
}

/** /nutrition/recipes/new and /nutrition/recipes/:id */
export function RecipeEditor() {
  const { id } = useParams();
  const recipes = useRecipes();
  if (!id) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">New recipe</h1>
        <Editor />
      </section>
    );
  }
  if (recipes.isPending) return <Spinner />;
  if (recipes.isError) return <ErrorState message={recipes.error.message} />;
  const recipe = recipes.data.find((r) => r.id === id);
  if (!recipe) return <ErrorState message="That recipe doesn't exist anymore." />;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Edit recipe</h1>
      <Editor recipe={recipe} />
    </section>
  );
}
