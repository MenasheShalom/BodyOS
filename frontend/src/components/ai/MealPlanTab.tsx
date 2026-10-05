import { Check, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { eatenAtFor, isoDay, MEALS } from "../../lib/meals";
import { useAiSettings, useCreateSavedMeal, useLogBatch, useMealPlan } from "../../lib/queries";
import type { BatchEntry, Meal, MealPlan, MealPlanInput, Nutrients } from "../../lib/types";
import { aiErrorMessage } from "./aiErrors";
import { PlanIngredients } from "./PlanIngredients";
import { type PlanRow, planRowNutrients, resolvedRows, rowsFrom, sumMacros } from "./planItems";
import { PrivacyNotice } from "./PrivacyNotice";
import { usePrivacyGate } from "./privacy";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const MEAL_LABEL = Object.fromEntries(MEALS.map((m) => [m.key, m.label])) as Record<Meal, string>;

type PlannedMeal = { key: string; meal: Meal; title: string; rows: PlanRow[] };
type Done = "logged" | "saved";

const macroLine = (n: Nutrients) =>
  `${fmt(n.energy_kcal ?? 0)} kcal · P ${fmt(n.protein_g ?? 0)} · C ${fmt(n.carbs_g ?? 0)} · F ${fmt(n.fat_g ?? 0)}`;

function MealCard({
  meal,
  onChange,
}: {
  meal: PlannedMeal;
  onChange: (rows: PlanRow[]) => void;
}) {
  const logBatch = useLogBatch();
  const saveMeal = useCreateSavedMeal();
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);
  const foods = resolvedRows(meal.rows);
  const skipped = meal.rows.length - foods.length;
  const totals = sumMacros(meal.rows.map(planRowNutrients));
  const busy = logBatch.isPending || saveMeal.isPending;

  const act = async (what: Done) => {
    setError(null);
    try {
      if (what === "logged") {
        const now = new Date();
        const eaten_at = eatenAtFor(isoDay(now), meal.meal, now);
        const entries: BatchEntry[] = foods.map((r) => ({
          kind: "food",
          food_id: r.food.id,
          grams: r.grams,
          serving_label: null,
          serving_count: null,
          meal: meal.meal,
          eaten_at,
          origin: "ai_plan",
        }));
        await logBatch.mutateAsync(entries);
      } else {
        await saveMeal.mutateAsync({
          name: meal.title,
          items: foods.map((r) => ({ food_id: r.food.id, grams: r.grams })),
        });
      }
      setDone((d) => [...d, what]);
    } catch (e) {
      setError(aiErrorMessage(e));
    }
  };

  return (
    <section aria-label={meal.title} className="space-y-3 rounded-2xl bg-surface p-4">
      <div>
        <p className="text-xs text-muted">{MEAL_LABEL[meal.meal]}</p>
        <h2 dir="auto" className="font-medium">
          {meal.title}
        </h2>
        <p className="tabular text-sm">{macroLine(totals)}</p>
      </div>
      <PlanIngredients
        rows={meal.rows}
        onChange={(rows) => {
          setDone([]);
          onChange(rows);
        }}
        label={`Ingredients of ${meal.title}`}
      />
      {skipped > 0 && foods.length > 0 && (
        <p className="text-xs text-muted">
          {skipped === 1 ? "1 ingredient has" : `${skipped} ingredients have`} no food and won't be
          included.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || foods.length === 0 || done.includes("logged")}
          onClick={() => void act("logged")}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-accent py-2 text-sm font-medium text-bg disabled:opacity-60"
        >
          {done.includes("logged") ? (
            <>
              <Check size={16} /> Logged to {MEAL_LABEL[meal.meal]}
            </>
          ) : (
            "Log this meal"
          )}
        </button>
        <button
          type="button"
          disabled={busy || foods.length === 0 || done.includes("saved")}
          onClick={() => void act("saved")}
          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-surface-2 py-2 text-sm disabled:opacity-60"
        >
          {done.includes("saved") ? (
            <>
              <Check size={16} /> Saved
            </>
          ) : (
            "Save meal"
          )}
        </button>
      </div>
    </section>
  );
}

function Comparison({ targets, totals }: { targets: MealPlan["targets"]; totals: Nutrients }) {
  const rows = [
    { key: "energy_kcal", label: "Calories", unit: "kcal" },
    { key: "protein_g", label: "Protein", unit: "g" },
    { key: "carbs_g", label: "Carbs", unit: "g" },
    { key: "fat_g", label: "Fat", unit: "g" },
  ] as const;
  return (
    <dl aria-label="Plan against targets" className="grid grid-cols-4 gap-2 text-center">
      {rows.map((r) => (
        <div key={r.key} className="rounded-xl bg-surface p-2">
          <dt className="text-xs text-muted">{r.label}</dt>
          <dd className="tabular text-sm">
            {fmt(totals[r.key] ?? 0)}
            <span className="text-muted">
              {" "}
              / {fmt(targets[r.key])}
              {r.unit === "g" ? " g" : ""}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Plan a day (or the rest of it) against the targets, then log or save each meal. */
export function MealPlanTab({ onCancel }: { onCancel: () => void }) {
  const gate = usePrivacyGate("meal_plan");
  const settings = useAiSettings();
  const generate = useMealPlan();
  const [form, setForm] = useState<MealPlanInput | null>(null);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [meals, setMeals] = useState<PlannedMeal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  if (!gate.ready) return null;
  if (gate.needed) {
    return (
      <PrivacyNotice
        what="your calorie and macro targets and the preferences you type"
        detail="AI plans can be off, so check the amounts before you log them."
        onContinue={gate.accept}
        onCancel={onCancel}
      />
    );
  }

  const values: MealPlanInput = form ?? {
    meals: 3,
    rest_of_today: false,
    preferences: settings.data?.plan_preferences ?? "",
  };

  const run = async (body: MealPlanInput) => {
    setError(null);
    try {
      const res = await generate.mutateAsync(body);
      const next = round + 1;
      setRound(next);
      setPlan(res);
      setMeals(
        res.meals.map((m, i) => ({
          key: `${next}-${i}`,
          meal: m.meal,
          title: m.title,
          rows: rowsFrom(m.ingredients, `${next}-${i}`),
        })),
      );
    } catch (e) {
      setError(aiErrorMessage(e, "text"));
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(values);
  };

  const totals = sumMacros(meals.flatMap((m) => m.rows.map(planRowNutrients)));

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3 rounded-2xl bg-surface p-4">
        <fieldset className="space-y-1">
          <legend className="text-sm text-muted">Plan for</legend>
          <div className="flex gap-2">
            {[
              { value: false, label: "The whole day" },
              { value: true, label: "The rest of today" },
            ].map((o) => (
              <label
                key={o.label}
                className="flex flex-1 items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm has-[:checked]:border-accent"
              >
                <input
                  type="radio"
                  name="scope"
                  checked={values.rest_of_today === o.value}
                  onChange={() => setForm({ ...values, rest_of_today: o.value })}
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm">
          <span className="text-muted">Meals</span>
          <select
            value={values.meals}
            onChange={(e) => setForm({ ...values, meals: Number(e.target.value) })}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Preferences (optional, remembered)</span>
          <textarea
            dir="auto"
            rows={2}
            maxLength={500}
            value={values.preferences}
            onChange={(e) => setForm({ ...values, preferences: e.target.value })}
            placeholder="e.g. kosher, no fish, quick lunches, cheap"
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          />
        </label>
        <button
          type="submit"
          disabled={generate.isPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
        >
          {plan && <RefreshCw size={16} />}
          {generate.isPending ? "Planning…" : plan ? "Plan again" : "Plan my meals"}
        </button>
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
      </form>

      {generate.isPending && (
        <p role="status" className="text-center text-sm text-muted">
          Planning meals and looking up the foods…
        </p>
      )}

      {plan && !generate.isPending && (
        <>
          <Comparison targets={plan.targets} totals={totals} />
          {plan.notes && <p className="text-sm text-muted">{plan.notes}</p>}
          {meals.map((m) => (
            <MealCard
              key={m.key}
              meal={m}
              onChange={(rows) =>
                setMeals((prev) => prev.map((x) => (x.key === m.key ? { ...x, rows } : x)))
              }
            />
          ))}
          <p className="text-xs text-muted">
            Numbers come from the food database, not the AI. Saved meals are in{" "}
            <Link to="/nutrition/meals" className="text-accent">
              Saved meals
            </Link>
            .
          </p>
        </>
      )}
    </div>
  );
}
