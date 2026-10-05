import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { GroceryRecipesTab } from "../components/ai/GroceryRecipesTab";
import { MealPlanTab } from "../components/ai/MealPlanTab";
import { Spinner } from "../components/EmptyState";
import { useAiStatus } from "../lib/queries";

const TABS = [
  { key: "plan", label: "Plan a day" },
  { key: "groceries", label: "From groceries" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** /nutrition/plan: meal plans and recipes from groceries (spec §5.4). */
export function PlanWithAi() {
  const navigate = useNavigate();
  const status = useAiStatus();
  const [tab, setTab] = useState<Tab>("plan");
  const back = () => void navigate("/nutrition");

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Plan with AI</h1>
      {status.isPending ? (
        <Spinner />
      ) : !status.data?.enabled ? (
        <p className="rounded-2xl bg-surface p-4 text-sm">
          {status.data?.configured
            ? "AI features are switched off. "
            : "AI isn't set up on the server yet. "}
          {status.data?.configured && (
            <Link to="/settings" className="text-accent">
              Turn them on in Settings
            </Link>
          )}
        </p>
      ) : (
        <>
          <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 rounded-lg py-2 text-sm ${tab === t.key ? "bg-surface font-medium" : "text-muted"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* Both stay mounted so switching tabs keeps each one's result. */}
          <div role="tabpanel" hidden={tab !== "plan"}>
            <MealPlanTab onCancel={back} />
          </div>
          <div role="tabpanel" hidden={tab !== "groceries"}>
            <GroceryRecipesTab onCancel={back} />
          </div>
        </>
      )}
    </section>
  );
}
