import { Search } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import { useFoodSearch, useImportFood } from "../../lib/queries";
import type { Food, Meal } from "../../lib/types";
import { FoodDetail } from "./FoodDetail";
import { FoodName } from "./FoodName";
import { QuickAddForm } from "./QuickAddForm";

// OFF allows about 10 searches a minute, so the database is only asked once the user
// pauses or presses Enter. Own and cached foods are searched as they type.
export const EXTERNAL_DELAY_MS = 800;
const SOURCE_NAMES: Record<string, string> = { off: "Open Food Facts", usda: "USDA" };

type Props = {
  day: string;
  meal: Meal;
  onDone: () => void;
  onCreateFood?: (prefill?: Food) => void;
};

function ResultList({
  title,
  foods,
  onPick,
  footer,
}: {
  title: string;
  foods: Food[];
  onPick: (food: Food) => void;
  footer?: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
        {foods.map((f) => (
          <li key={f.id ?? `${f.source}:${f.source_ref}`}>
            <button
              type="button"
              onClick={() => onPick(f)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
            >
              <FoodName name={f.name} brand={f.brand} />
              <span className="tabular shrink-0 text-xs text-muted">
                {Math.round(f.nutrients_per_100g.energy_kcal ?? 0)} kcal/100{" "}
                {f.is_liquid ? "ml" : "g"}
              </span>
            </button>
          </li>
        ))}
        {footer}
      </ul>
    </section>
  );
}

export function AddFood({ day, meal, onDone, onCreateFood }: Props) {
  const [tab, setTab] = useState<"search" | "quick">("search");
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selected, setSelected] = useState<(Food & { id: string }) | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const importFood = useImportFood();

  const query = q.trim();
  useEffect(() => {
    if (query.length < 3) return;
    const timer = setTimeout(() => setSubmitted(query), EXTERNAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const external = useFoodSearch(submitted, true, submitted === query);
  const local = useFoodSearch(query, false);
  const externalReady = submitted === query && external.data != null;
  const mine = (externalReady ? external.data?.local : local.data?.local) ?? [];
  const found = externalReady ? (external.data?.external ?? []) : [];
  const failed = externalReady ? (external.data?.sources_failed ?? []) : [];
  const searching = query.length >= 3 && !externalReady && !external.isError;

  const pick = async (food: Food) => {
    setPickError(null);
    if (food.id) return setSelected(food as Food & { id: string });
    try {
      setSelected((await importFood.mutateAsync(food)) as Food & { id: string });
    } catch (e) {
      setPickError(e instanceof ApiError ? e.message : "Couldn't open that food. Try again.");
    }
  };

  if (selected) {
    return (
      <FoodDetail
        food={selected}
        day={day}
        meal={meal}
        onBack={() => setSelected(null)}
        onLogged={onDone}
        onCopyToMine={onCreateFood}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {(
          [
            ["search", "Search"],
            ["quick", "Quick add"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm ${
              tab === key ? "bg-surface text-text shadow-sm" : "text-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "quick" ? (
        <QuickAddForm day={day} meal={meal} onDone={onDone} />
      ) : (
        <>
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (query.length >= 3) setSubmitted(query);
            }}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-accent"
          >
            <Search size={18} className="text-muted" />
            <input
              autoFocus
              type="search"
              dir="auto"
              aria-label="Search foods"
              placeholder="Search foods (English or עברית)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-transparent py-2.5 outline-none"
            />
          </form>

          {query.length > 0 && query.length < 3 && (
            <p className="text-sm text-muted">Type at least 3 letters.</p>
          )}
          {pickError && (
            <p role="alert" className="text-sm text-bad">
              {pickError}
            </p>
          )}
          {failed.length > 0 && (
            <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
              {failed.map((s) => SOURCE_NAMES[s] ?? s).join(" and ")} didn't respond, so some
              results may be missing.
            </p>
          )}
          {external.isError && submitted === query && (
            <p role="alert" className="text-sm text-bad">
              Couldn't search the food database. Your own foods are still listed.
            </p>
          )}

          {mine.length > 0 && (
            <ResultList title="My foods" foods={mine} onPick={(f) => void pick(f)} />
          )}
          {query.length >= 3 && (
            <ResultList
              title="Database"
              foods={found}
              onPick={(f) => void pick(f)}
              footer={
                searching ? (
                  <li className="px-4 py-2.5 text-sm text-muted" role="status">
                    Searching Open Food Facts and USDA…
                  </li>
                ) : found.length === 0 ? (
                  <li className="px-4 py-2.5 text-sm text-muted">No matches in the database.</li>
                ) : null
              }
            />
          )}
          {query.length >= 3 && !searching && onCreateFood && (
            <button
              type="button"
              onClick={() => onCreateFood()}
              className="w-full rounded-xl border border-dashed border-border py-2.5 text-sm"
            >
              Can't find it? Create a food
            </button>
          )}
        </>
      )}
    </div>
  );
}
