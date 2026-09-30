import { useId } from "react";
import { choiceGrams, type ServingChoice } from "../../lib/serving";
import type { Serving } from "../../lib/types";

type Props = {
  servings: Serving[];
  value: ServingChoice;
  onChange: (value: ServingChoice) => void;
  unit: "g" | "ml";
};

export function ServingPicker({ servings, value, onChange, unit }: Props) {
  const id = useId();
  const grams = choiceGrams(servings, value);
  return (
    <div>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <div>
          <label htmlFor={`${id}-count`} className="mb-1 block text-sm text-muted">
            Amount
          </label>
          <input
            id={`${id}-count`}
            inputMode="decimal"
            value={value.count}
            onChange={(e) => onChange({ ...value, count: e.target.value })}
            aria-invalid={grams == null ? true : undefined}
            className={`tabular w-full rounded-xl border bg-surface px-3 py-2.5 outline-none ${
              grams == null ? "border-bad" : "border-border focus:border-accent"
            }`}
          />
        </div>
        <div>
          <label htmlFor={`${id}-serving`} className="mb-1 block text-sm text-muted">
            Serving
          </label>
          <select
            id={`${id}-serving`}
            value={value.index}
            onChange={(e) => onChange({ ...value, index: Number(e.target.value) })}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            {servings.map((s, i) => (
              <option key={s.label} value={i}>
                {i === 0 ? s.label : `${s.label} (${s.grams} ${unit})`}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {grams == null ? "Enter an amount between 0 and 100" : `${grams} ${unit}`}
      </p>
    </div>
  );
}
