import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../lib/api";
import { localInputToIso, toLocalInputValue } from "../../lib/format";
import { eatenAtFor, MEALS } from "../../lib/meals";
import { useLogFood } from "../../lib/queries";
import { choiceGrams, nutrientsFor, type ServingChoice, servingsFor } from "../../lib/serving";
import type { Food, Meal } from "../../lib/types";
import { Field } from "../Field";
import { FoodName } from "./FoodName";
import { ServingPicker } from "./ServingPicker";

const SOURCE_LABEL: Record<Food["source"], string> = {
  off: "Open Food Facts",
  usda: "USDA",
  custom: "My food",
  recipe: "Recipe",
};

function SourceBadge({ food }: { food: Food }) {
  const cls = "rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted";
  if (food.source === "off" && food.barcode) {
    // Open Food Facts data is ODbL-licensed: attribute and link to the product.
    return (
      <a
        href={`https://world.openfoodfacts.org/product/${food.barcode}`}
        target="_blank"
        rel="noreferrer"
        className={`${cls} underline`}
      >
        {SOURCE_LABEL.off}
      </a>
    );
  }
  return <span className={cls}>{SOURCE_LABEL[food.source]}</span>;
}

const round = (n: number | undefined) => (n == null ? "—" : String(Math.round(n)));

type Props = {
  food: Food & { id: string };
  day: string;
  meal: Meal;
  onBack: () => void;
  onLogged: () => void;
  onCopyToMine?: (food: Food) => void;
};

export function FoodDetail({
  food,
  day,
  meal: initialMeal,
  onBack,
  onLogged,
  onCopyToMine,
}: Props) {
  const logFood = useLogFood();
  const servings = servingsFor(food);
  const unit = food.is_liquid ? "ml" : "g";
  // Start on the food's own serving when it has one: "1 × 2 tbsp" beats "1 × 100 g".
  const [choice, setChoice] = useState<ServingChoice>({
    index: servings.length > 1 ? 1 : 0,
    count: "1",
  });
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [time, setTime] = useState(() =>
    toLocalInputValue(new Date(eatenAtFor(day, initialMeal, new Date()))),
  );
  const [error, setError] = useState<string | null>(null);
  const grams = choiceGrams(servings, choice);
  const preview = grams == null ? {} : nutrientsFor(food, grams);

  const log = async () => {
    if (grams == null) return;
    setError(null);
    const serving = servings[choice.index];
    try {
      await logFood.mutateAsync({
        food_id: food.id,
        grams,
        serving_label: serving.label,
        serving_count: Number(choice.count.replace(",", ".")),
        meal,
        eaten_at: localInputToIso(time),
      });
      onLogged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't log it. Try again.");
    }
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted">
        <ChevronLeft size={16} /> Back to search
      </button>
      <div className="flex items-start justify-between gap-3">
        <FoodName name={food.name} brand={food.brand} />
        <SourceBadge food={food} />
      </div>

      <ServingPicker servings={servings} value={choice} onChange={setChoice} unit={unit} />

      <dl className="grid grid-cols-4 gap-2 rounded-2xl bg-surface p-3 text-center">
        {(
          [
            ["kcal", preview.energy_kcal],
            ["Protein", preview.protein_g],
            ["Carbs", preview.carbs_g],
            ["Fat", preview.fat_g],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="tabular font-medium">{round(value)}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Meal</span>
          <select
            value={meal}
            onChange={(e) => setMeal(e.target.value as Meal)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            {MEALS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Time"
          type="datetime-local"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void log()}
        disabled={grams == null || logFood.isPending}
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        Log
      </button>
      {onCopyToMine && !food.is_own && (
        <button
          type="button"
          onClick={() => onCopyToMine(food)}
          className="w-full text-sm text-muted underline"
        >
          Wrong values? Copy to my foods and fix them
        </button>
      )}
    </div>
  );
}
