import { AlertTriangle, Database, X } from "lucide-react";
import { useState } from "react";
import { FoodName } from "../nutrition/FoodName";
import { IngredientPicker } from "../nutrition/IngredientPicker";
import { MAX_GRAMS, type PlanRow, planRowNutrients } from "./planItems";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/** Editable ingredients of an AI meal or recipe: amounts, swaps and removals. */
export function PlanIngredients({
  rows,
  onChange,
  label,
}: {
  rows: PlanRow[];
  onChange: (rows: PlanRow[]) => void;
  label: string;
}) {
  const [swapping, setSwapping] = useState<PlanRow | null>(null);
  const update = (key: string, change: (r: PlanRow) => PlanRow) =>
    onChange(rows.map((r) => (r.key === key ? change(r) : r)));

  return (
    <>
      <ul aria-label={label} className="space-y-2">
        {rows.map((r) => {
          const n = planRowNutrients(r);
          return (
            <li key={r.key} className="space-y-1.5 border-t border-border pt-2 first:border-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {r.food ? (
                    <FoodName name={r.food.name} brand={r.food.brand} />
                  ) : (
                    <span dir="auto" className="block">
                      {r.name}
                    </span>
                  )}
                  {r.food ? (
                    <span className="block text-xs text-muted">For: {r.name}</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-bad">
                      <AlertTriangle size={12} /> No food found; not counted
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${r.name}`}
                  onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                  className="shrink-0 rounded-full p-1 text-muted"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={MAX_GRAMS}
                    aria-label={`Grams of ${r.name}`}
                    value={r.text}
                    onChange={(e) => {
                      const text = e.target.value;
                      const grams = Number(text.replace(",", "."));
                      update(r.key, (row) =>
                        grams > 0 && grams <= MAX_GRAMS ? { ...row, text, grams } : { ...row, text },
                      );
                    }}
                    className="tabular w-20 rounded-lg border border-border bg-bg px-2 py-1"
                  />
                  g
                </label>
                {r.food && (
                  <span className="tabular flex-1 text-right text-xs text-muted">
                    {fmt(n.energy_kcal ?? 0)} kcal · P {fmt(n.protein_g ?? 0)} · C{" "}
                    {fmt(n.carbs_g ?? 0)} · F {fmt(n.fat_g ?? 0)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSwapping(r)}
                className="flex items-center gap-1 text-xs text-accent"
              >
                <Database size={14} /> {r.food ? "Swap food" : "Find a food"}
              </button>
            </li>
          );
        })}
      </ul>
      {swapping && (
        <IngredientPicker
          title={swapping.food ? "Swap food" : "Find a food"}
          initialQuery={swapping.search_query}
          onClose={() => setSwapping(null)}
          onPick={(food) => {
            update(swapping.key, (row) => ({ ...row, food }));
            setSwapping(null);
          }}
        />
      )}
    </>
  );
}
