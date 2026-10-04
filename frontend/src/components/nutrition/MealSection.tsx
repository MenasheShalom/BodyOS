import { Plus } from "lucide-react";
import { amountLabel } from "../../lib/serving";
import type { FoodLogEntry } from "../../lib/types";
import { FoodName } from "./FoodName";

type Props = {
  label: string;
  entries: FoodLogEntry[];
  onAdd: () => void;
  onOpen: (entry: FoodLogEntry) => void;
  onCopy?: () => void;
  onSave?: () => void;
};

export function MealSection({ label, entries, onAdd, onOpen, onCopy, onSave }: Props) {
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
                  <span className="block text-xs text-muted">
                    {e.origin === "ai_photo" ? "AI estimate" : amountLabel(e) || "—"}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm">
                  {Math.round(e.nutrients.energy_kcal ?? 0).toLocaleString("en-GB")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-4 px-4 pb-3 pt-1 text-sm">
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add to ${label}`}
          className="flex items-center gap-1.5 text-accent"
        >
          <Plus size={16} /> Add
        </button>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy into ${label}`}
            className="text-muted"
          >
            Copy from…
          </button>
        )}
        {onSave && entries.length > 0 && (
          <button
            type="button"
            onClick={onSave}
            aria-label={`Save ${label} as a meal`}
            className="text-muted"
          >
            Save as meal
          </button>
        )}
      </div>
    </section>
  );
}
