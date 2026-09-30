import { Plus } from "lucide-react";
import { amountLabel } from "../../lib/serving";
import type { FoodLogEntry } from "../../lib/types";
import { FoodName } from "./FoodName";

type Props = {
  label: string;
  entries: FoodLogEntry[];
  onAdd: () => void;
  onOpen: (entry: FoodLogEntry) => void;
};

export function MealSection({ label, entries, onAdd, onOpen }: Props) {
  const kcal = entries.reduce((sum, e) => sum + (e.nutrients.energy_kcal ?? 0), 0);
  return (
    <section aria-label={label} className="rounded-2xl bg-surface">
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="font-medium">{label}</h2>
        <span className="tabular text-sm text-muted">
          {Math.round(kcal).toLocaleString("en-GB")} kcal
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-2 text-sm text-muted">Nothing logged</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onOpen(e)}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
              >
                <span className="min-w-0">
                  <FoodName name={e.name} />
                  <span className="block text-xs text-muted">{amountLabel(e) || "—"}</span>
                </span>
                <span className="tabular shrink-0 text-sm">
                  {Math.round(e.nutrients.energy_kcal ?? 0).toLocaleString("en-GB")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onAdd}
        aria-label={`Add to ${label}`}
        className="flex w-full items-center gap-1.5 px-4 pb-3 pt-1 text-sm text-accent"
      >
        <Plus size={16} /> Add
      </button>
    </section>
  );
}
