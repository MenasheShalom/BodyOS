import { type FormEvent, useState } from "react";
import { ApiError } from "../../lib/api";
import { addDays, isoDay, MEALS } from "../../lib/meals";
import { useCopyEntries, useSaveMealFromLog } from "../../lib/queries";
import type { Meal } from "../../lib/types";
import { Field } from "../Field";
import { Modal } from "../Modal";

const mealLabel = (m: Meal) => MEALS.find((x) => x.key === m)!.label;
const select = "w-full rounded-xl border border-border bg-surface px-3 py-2.5";

/** Copy a past day (or one of its meals) into `day`. With `meal`, copies into that meal. */
export function CopyDialog({
  day,
  meal,
  onClose,
}: {
  day: string;
  meal?: Meal;
  onClose: () => void;
}) {
  const copy = useCopyEntries();
  const [from, setFrom] = useState(addDays(day, -1));
  const [source, setSource] = useState<Meal | undefined>(meal);
  const [message, setMessage] = useState<string | null>(null);
  const today = isoDay(new Date());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (from === day) return setMessage("Pick a different day to copy from.");
    try {
      const copied = await copy.mutateAsync({
        from_day: from,
        to_day: day,
        ...(meal ? { meal: source, to_meal: meal } : {}),
      });
      if (copied.length === 0) return setMessage("Nothing was logged then.");
      onClose();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Couldn't copy. Try again.");
    }
  };

  return (
    <Modal title={meal ? `Copy into ${mealLabel(meal)}` : "Copy a whole day"} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
        <Field
          label="From"
          type="date"
          max={today}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        {meal && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Meal</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as Meal)}
              className={select}
            >
              {MEALS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {message && (
          <p role="alert" className="text-sm text-muted">
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={copy.isPending || !from}
          className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
        >
          Copy
        </button>
      </form>
    </Modal>
  );
}

/** Save what's logged in one meal of `day` as a reusable meal. */
export function SaveMealDialog({
  day,
  meal,
  onClose,
}: {
  day: string;
  meal: Meal;
  onClose: () => void;
}) {
  const save = useSaveMealFromLog();
  const [name, setName] = useState(mealLabel(meal));
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give it a name");
    try {
      await save.mutateAsync({ name: name.trim(), day, meal });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
    }
  };

  return (
    <Modal title="Save as meal" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
        <Field
          label="Name"
          dir="auto"
          value={name}
          error={error ?? undefined}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-sm text-muted">
          It appears under Saved meals when you add food, ready to log in one go.
        </p>
        <button
          type="submit"
          disabled={save.isPending}
          className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
        >
          Save meal
        </button>
      </form>
    </Modal>
  );
}
