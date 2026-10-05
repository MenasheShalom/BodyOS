import { Check, Clock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../lib/api";
import { useRecipeIdeas, useSaveRecipe } from "../../lib/queries";
import type { Nutrients, RecipeIdeas } from "../../lib/types";
import { aiErrorMessage } from "./aiErrors";
import { PlanIngredients } from "./PlanIngredients";
import {
  instructionsFrom,
  type PlanRow,
  planRowNutrients,
  resolvedRows,
  rowsFrom,
  sumMacros,
} from "./planItems";
import { PrivacyNotice } from "./PrivacyNotice";
import { usePrivacyGate } from "./privacy";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

type Idea = {
  key: string;
  name: string;
  servings: number;
  minutes: number;
  steps: string[];
  rows: PlanRow[];
};

function IdeaCard({ idea, onChange }: { idea: Idea; onChange: (rows: PlanRow[]) => void }) {
  const save = useSaveRecipe();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const foods = resolvedRows(idea.rows);
  const total = sumMacros(idea.rows.map(planRowNutrients));
  const perServing: Nutrients = Object.fromEntries(
    Object.entries(total).map(([k, v]) => [k, (v ?? 0) / idea.servings]),
  );

  const saveRecipe = async () => {
    setError(null);
    try {
      const recipe = await save.mutateAsync({
        body: {
          name: idea.name,
          servings: idea.servings,
          cooked_weight_g: null,
          note: null,
          instructions: instructionsFrom(idea.steps),
          items: foods.map((r) => ({ food_id: r.food.id, grams: r.grams })),
        },
      });
      setSavedId(recipe.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    }
  };

  return (
    <section aria-label={idea.name} className="space-y-3 rounded-2xl bg-surface p-4">
      <div>
        <h2 dir="auto" className="font-medium">
          {idea.name}
        </h2>
        <p className="flex items-center gap-1 text-xs text-muted">
          <Clock size={12} /> {idea.minutes} min · {idea.servings}{" "}
          {idea.servings === 1 ? "serving" : "servings"}
        </p>
        <p className="tabular text-sm">
          Per serving: {fmt(perServing.energy_kcal ?? 0)} kcal · P {fmt(perServing.protein_g ?? 0)}{" "}
          · C {fmt(perServing.carbs_g ?? 0)} · F {fmt(perServing.fat_g ?? 0)}
        </p>
      </div>
      <PlanIngredients
        rows={idea.rows}
        onChange={(rows) => {
          setSavedId(null);
          onChange(rows);
        }}
        label={`Ingredients of ${idea.name}`}
      />
      <div>
        <h3 className="mb-1 text-sm font-medium">Steps</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm" dir="auto">
          {idea.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      {savedId ? (
        <p role="status" className="flex items-center gap-1 text-sm">
          <Check size={16} className="text-good" /> Saved.{" "}
          <Link to={`/nutrition/recipes/${savedId}`} className="text-accent">
            Open recipe
          </Link>
        </p>
      ) : (
        <button
          type="button"
          disabled={save.isPending || foods.length === 0}
          onClick={() => void saveRecipe()}
          className="w-full rounded-xl bg-accent py-2 text-sm font-medium text-bg disabled:opacity-60"
        >
          Save recipe
          {foods.length < idea.rows.length ? ` (without ${idea.rows.length - foods.length} unmatched)` : ""}
        </button>
      )}
    </section>
  );
}

/** Groceries at home → one to three recipe ideas, each saved as an ordinary recipe. */
export function GroceryRecipesTab({ onCancel }: { onCancel: () => void }) {
  const gate = usePrivacyGate("recipe_from_groceries");
  const generate = useRecipeIdeas();
  const [groceries, setGroceries] = useState("");
  const [servings, setServings] = useState("");
  const [staples, setStaples] = useState(true);
  const [result, setResult] = useState<RecipeIdeas | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  if (!gate.ready) return null;
  if (gate.needed) {
    return (
      <PrivacyNotice
        what="the groceries you list"
        detail="AI recipes can be off, so check the amounts before you save them."
        onContinue={gate.accept}
        onCancel={onCancel}
      />
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!groceries.trim()) return setError("List a few groceries first.");
    const n = servings.trim() ? Number(servings) : null;
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 12)) {
      return setError("Servings must be a whole number from 1 to 12.");
    }
    try {
      const res = await generate.mutateAsync({ groceries, servings: n, staples });
      const next = round + 1;
      setRound(next);
      setResult(res);
      setIdeas(
        res.recipes.map((r, i) => ({
          key: `${next}-${i}`,
          name: r.name,
          servings: r.servings,
          minutes: r.minutes,
          steps: r.steps,
          rows: rowsFrom(r.ingredients, `${next}-${i}`),
        })),
      );
    } catch (err) {
      setError(aiErrorMessage(err, "text"));
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3 rounded-2xl bg-surface p-4">
        <label className="block text-sm">
          <span className="text-muted">What do you have?</span>
          <textarea
            dir="auto"
            rows={4}
            maxLength={1000}
            value={groceries}
            onChange={(e) => setGroceries(e.target.value)}
            placeholder={"One per line or separated by commas, e.g.\nchicken thighs, rice, peppers"}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          />
        </label>
        <div className="flex items-end gap-3">
          <label className="block w-28 text-sm">
            <span className="text-muted">Servings</span>
            <input
              inputMode="numeric"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
              placeholder="Any"
              className="tabular mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
            />
          </label>
          <label className="flex flex-1 items-center gap-2 pb-2.5 text-sm">
            <input
              type="checkbox"
              checked={staples}
              onChange={(e) => setStaples(e.target.checked)}
            />
            Oil, salt and spices allowed
          </label>
        </div>
        <button
          type="submit"
          disabled={generate.isPending}
          className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
        >
          {generate.isPending ? "Thinking…" : result ? "Suggest again" : "Suggest recipes"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
      </form>

      {generate.isPending && (
        <p role="status" className="text-center text-sm text-muted">
          Writing recipes and looking up the foods…
        </p>
      )}

      {result && !generate.isPending && (
        <>
          {result.notes && <p className="text-sm text-muted">{result.notes}</p>}
          {ideas.map((idea) => (
            <IdeaCard
              key={idea.key}
              idea={idea}
              onChange={(rows) =>
                setIdeas((prev) => prev.map((x) => (x.key === idea.key ? { ...x, rows } : x)))
              }
            />
          ))}
        </>
      )}
    </div>
  );
}
