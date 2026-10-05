import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

const LINKS = [
  { to: "/nutrition/targets", label: "Targets", body: "Calories, macros and how they're set" },
  { to: "/nutrition/foods", label: "My foods", body: "Foods you created, edit or delete" },
  { to: "/nutrition/recipes", label: "Recipes", body: "Home cooking, logged by the serving" },
  { to: "/nutrition/meals", label: "Saved meals", body: "Meals you log often, in one go" },
  { to: "/nutrition/plan", label: "Plan with AI", body: "A day of meals, or recipes from groceries" },
];

export function Nutrition() {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Nutrition</h1>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
        {LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex items-center justify-between px-4 py-3">
              <span>
                <span className="block">{l.label}</span>
                <span className="block text-sm text-muted">{l.body}</span>
              </span>
              <ChevronRight size={18} className="text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
