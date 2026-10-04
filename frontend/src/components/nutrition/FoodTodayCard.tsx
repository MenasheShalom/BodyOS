import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import type { FoodToday } from "../../lib/types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

function Bar({
  label,
  value,
  target,
  unit,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
}) {
  const over = value > target;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular">
          {fmt(value)} / {fmt(target)} {unit}
        </span>
      </div>
      <div
        className={`h-1.5 overflow-hidden rounded-full ${over ? "bg-bad/15" : "bg-accent/15"}`}
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={target}
      >
        <div
          className={`h-full rounded-full ${over ? "bg-bad" : "bg-accent"}`}
          style={{ width: `${Math.min(100, (value / target) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Today's calories and protein on Home, linking to the Food tab. */
export function FoodTodayCard({ food }: { food: FoodToday }) {
  return (
    <Link
      to="/food"
      aria-label="Today's food"
      className="block space-y-3 rounded-2xl bg-surface p-4"
    >
      <span className="flex items-center justify-between">
        <span className="font-medium">Today's food</span>
        <ChevronRight size={18} className="text-muted" />
      </span>
      {food.target_kcal != null && food.target_protein_g != null ? (
        <span className="block space-y-2">
          <Bar label="Calories" value={food.energy_kcal} target={food.target_kcal} unit="kcal" />
          <Bar label="Protein" value={food.protein_g} target={food.target_protein_g} unit="g" />
        </span>
      ) : (
        <span className="tabular block text-sm">
          {fmt(food.energy_kcal)} kcal · {fmt(food.protein_g)} g protein
        </span>
      )}
    </Link>
  );
}
