import { useState } from "react";
import { ApiError } from "../../lib/api";
import { localInputToIso, toLocalInputValue } from "../../lib/format";
import { MEALS } from "../../lib/meals";
import { useDeleteLogEntry, useUpdateLogEntry } from "../../lib/queries";
import type { FoodLogEntry, FoodLogPatch, Meal, Nutrients } from "../../lib/types";
import { Field } from "../Field";
import { Modal } from "../Modal";
import { FoodName } from "./FoodName";

const num = (raw: string): number | null => {
  const n = Number(raw.replace(",", "."));
  return raw.trim() === "" || Number.isNaN(n) ? null : n;
};
const str = (n: number | undefined | null) => (n == null ? "" : String(Math.round(n * 10) / 10));

/** Edit a logged entry's amount, meal and time (or a quick add's numbers), or delete it. */
export function EntrySheet({ entry, onClose }: { entry: FoodLogEntry; onClose: () => void }) {
  const update = useUpdateLogEntry();
  const remove = useDeleteLogEntry();
  const fromFood = entry.grams != null;
  const perServing =
    fromFood &&
    entry.serving_count != null &&
    entry.serving_label &&
    !/^100 /.test(entry.serving_label)
      ? entry.grams! / entry.serving_count
      : null;

  const [amount, setAmount] = useState(
    perServing != null ? str(entry.serving_count) : str(entry.grams),
  );
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [time, setTime] = useState(toLocalInputValue(new Date(entry.eaten_at)));
  const [name, setName] = useState(entry.name);
  const [quick, setQuick] = useState({
    energy_kcal: str(entry.nutrients.energy_kcal),
    protein_g: str(entry.nutrients.protein_g),
    carbs_g: str(entry.nutrients.carbs_g),
    fat_g: str(entry.nutrients.fat_g),
  });
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    setError(null);
    const body: FoodLogPatch = { meal, eaten_at: localInputToIso(time) };
    if (fromFood) {
      const n = num(amount);
      if (n == null || n <= 0) return setError("Enter an amount");
      if (perServing != null) {
        body.serving_count = n;
        body.grams = Math.round(perServing * n * 10) / 10;
      } else {
        body.grams = n;
        body.serving_count = n / 100;
      }
    } else {
      const kcal = num(quick.energy_kcal);
      if (kcal == null || kcal <= 0) return setError("Enter calories");
      const nutrients: Nutrients = { energy_kcal: kcal };
      for (const key of ["protein_g", "carbs_g", "fat_g"] as const) {
        const v = num(quick[key]);
        if (v != null) nutrients[key] = v;
      }
      body.nutrients = nutrients;
      if (name.trim()) body.name = name.trim();
    }
    try {
      await update.mutateAsync({ id: entry.id, body });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    }
  };

  return (
    <Modal title="Edit entry" onClose={onClose}>
      <div className="space-y-3">
        {fromFood ? (
          <>
            <FoodName name={entry.name} />
            <Field
              label={perServing != null ? `Servings (${entry.serving_label})` : "Amount"}
              unit={perServing != null ? "×" : "g"}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </>
        ) : (
          <>
            <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["energy_kcal", "Calories", "kcal"],
                  ["protein_g", "Protein", "g"],
                  ["carbs_g", "Carbs", "g"],
                  ["fat_g", "Fat", "g"],
                ] as const
              ).map(([key, label, unit]) => (
                <Field
                  key={key}
                  label={label}
                  unit={unit}
                  inputMode="decimal"
                  value={quick[key]}
                  onChange={(e) => setQuick({ ...quick, [key]: e.target.value })}
                />
              ))}
            </div>
          </>
        )}
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
          onClick={() => void save()}
          disabled={update.isPending}
          className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
        >
          Save
        </button>
        {confirmDelete ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => remove.mutate(entry.id, { onSuccess: onClose })}
              className="flex-1 rounded-xl bg-bad py-2.5 font-medium text-bg"
            >
              Delete entry
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
            className="w-full rounded-xl py-2.5 text-bad"
          >
            Delete
          </button>
        )}
      </div>
    </Modal>
  );
}
