import { type FormEvent, useState } from "react";
import { ApiError } from "../../lib/api";
import { eatenAtFor, MEALS } from "../../lib/meals";
import { useQuickAdd } from "../../lib/queries";
import type { Meal, Nutrients } from "../../lib/types";
import { Field } from "../Field";

const FIELDS = [
  ["protein_g", "Protein"],
  ["carbs_g", "Carbs"],
  ["fat_g", "Fat"],
] as const;

const num = (raw: string): number | null => {
  const n = Number(raw.replace(",", "."));
  return raw.trim() === "" || Number.isNaN(n) ? null : n;
};

export function QuickAddForm({
  day,
  meal: initialMeal,
  onDone,
}: {
  day: string;
  meal: Meal;
  onDone: () => void;
}) {
  const quickAdd = useQuickAdd();
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [macros, setMacros] = useState<Record<string, string>>({});
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const energy = num(kcal);
    if (energy == null || energy < 1 || energy > 5000) {
      return setError("Enter calories between 1 and 5000");
    }
    const nutrients: Nutrients = { energy_kcal: energy };
    for (const [key] of FIELDS) {
      const v = num(macros[key] ?? "");
      if (v != null) {
        if (v < 0 || v > 1000) return setError("Macros must be between 0 and 1000 g");
        nutrients[key] = v;
      }
    }
    try {
      await quickAdd.mutateAsync({
        ...(name.trim() ? { name: name.trim() } : {}),
        nutrients,
        meal,
        eaten_at: eatenAtFor(day, meal, new Date()),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add it. Try again.");
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
      <Field
        label="Label (optional)"
        placeholder="Quick add"
        dir="auto"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label="Calories"
        unit="kcal"
        inputMode="decimal"
        value={kcal}
        onChange={(e) => setKcal(e.target.value)}
      />
      <div className="grid grid-cols-3 gap-3">
        {FIELDS.map(([key, label]) => (
          <Field
            key={key}
            label={label}
            unit="g"
            inputMode="decimal"
            value={macros[key] ?? ""}
            onChange={(e) => setMacros({ ...macros, [key]: e.target.value })}
          />
        ))}
      </div>
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
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={quickAdd.isPending}
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        Add
      </button>
    </form>
  );
}
