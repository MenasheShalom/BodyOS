import { Check, ChevronLeft, Plus, ScanBarcode, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ApiError } from "../../lib/api";
import { useCombinedFoodSearch } from "../../lib/foodSearch";
import { eatenAtFor } from "../../lib/meals";
import {
  useBarcodeLookup,
  useFavourites,
  useImportFood,
  useLogFood,
  useLogSavedMeal,
  useRecentFoods,
  useSavedMeals,
} from "../../lib/queries";
import { amountLabel } from "../../lib/serving";
import type { Food, Meal, RecentFood, SavedMeal } from "../../lib/types";
import { BarcodeScanner } from "./BarcodeScanner";
import { FoodDetail, type InitialAmount } from "./FoodDetail";
import { FoodName } from "./FoodName";
import { QuickAddForm } from "./QuickAddForm";

const SOURCE_NAMES: Record<string, string> = { off: "Open Food Facts", usda: "USDA" };

type Props = {
  day: string;
  meal: Meal;
  onDone: () => void;
  onCreateFood?: (prefill?: Partial<Food>) => void;
};

type View =
  | { kind: "browse" }
  | { kind: "detail"; food: Food & { id: string }; initial?: InitialAmount }
  | { kind: "scan" }
  | { kind: "meal"; meal: SavedMeal };

const kcalPer100 = (f: Food) =>
  `${Math.round(f.nutrients_per_100g.energy_kcal ?? 0)} kcal/100 ${f.is_liquid ? "ml" : "g"}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">{children}</ul>
    </section>
  );
}

function FoodRow({ food, detail, onPick }: { food: Food; detail?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full min-w-0 flex-1 items-center justify-between gap-3 px-4 py-2.5 text-left"
    >
      <FoodName name={food.name} brand={food.brand} />
      <span className="tabular shrink-0 text-xs text-muted">{detail ?? kcalPer100(food)}</span>
    </button>
  );
}

export function AddFood({ day, meal, onDone, onCreateFood }: Props) {
  const [tab, setTab] = useState<"search" | "quick">("search");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>({ kind: "browse" });
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const search = useCombinedFoodSearch(q);
  const importFood = useImportFood();
  const barcode = useBarcodeLookup();
  const logFood = useLogFood();
  const recent = useRecentFoods();
  const favourites = useFavourites();
  const savedMeals = useSavedMeals();

  const open = async (food: Food, initial?: InitialAmount) => {
    setError(null);
    if (food.id) return setView({ kind: "detail", food: food as Food & { id: string }, initial });
    try {
      const imported = (await importFood.mutateAsync(food)) as Food & { id: string };
      setView({ kind: "detail", food: imported, initial });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't open that food. Try again.");
    }
  };

  const relog = async (r: RecentFood) => {
    setError(null);
    try {
      await logFood.mutateAsync({
        food_id: r.food.id!,
        grams: r.grams,
        serving_label: r.serving_label,
        serving_count: r.serving_count,
        meal,
        eaten_at: eatenAtFor(day, meal, new Date()),
      });
      setLogged((prev) => new Set(prev).add(r.food.id!));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't log it. Try again.");
    }
  };

  const lookUp = async (code: string) => {
    setError(null);
    setNotFound(null);
    try {
      const food = (await barcode.mutateAsync(code)) as Food & { id: string };
      setView({ kind: "detail", food });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(code);
      else setError(e instanceof ApiError ? e.message : "Couldn't look that up. Try again.");
    }
  };

  if (view.kind === "detail") {
    return (
      <FoodDetail
        food={view.food}
        day={day}
        meal={meal}
        initial={view.initial}
        onBack={() => setView({ kind: "browse" })}
        onLogged={onDone}
        onCopyToMine={onCreateFood}
      />
    );
  }
  if (view.kind === "meal") {
    return (
      <SavedMealConfirm
        meal={view.meal}
        day={day}
        target={meal}
        onBack={() => setView({ kind: "browse" })}
        onLogged={onDone}
      />
    );
  }

  const back = (
    <button
      type="button"
      onClick={() => {
        setView({ kind: "browse" });
        setNotFound(null);
        setError(null);
      }}
      className="flex items-center gap-1 text-sm text-muted"
    >
      <ChevronLeft size={16} /> Back to search
    </button>
  );

  if (view.kind === "scan") {
    return (
      <div className="space-y-4">
        {back}
        {notFound ? (
          <div role="alert" className="space-y-3 rounded-2xl bg-surface p-4 text-sm">
            <p>
              No food found for barcode <span className="tabular">{notFound}</span>.
            </p>
            <div className="flex gap-2">
              {onCreateFood && (
                <button
                  type="button"
                  onClick={() => onCreateFood({ barcode: notFound })}
                  className="flex-1 rounded-xl bg-accent py-2 font-medium text-bg"
                >
                  Create it
                </button>
              )}
              <button
                type="button"
                onClick={() => setNotFound(null)}
                className="flex-1 rounded-xl bg-surface-2 py-2"
              >
                Scan again
              </button>
            </div>
          </div>
        ) : (
          <BarcodeScanner onCode={(code) => void lookUp(code)} busy={barcode.isPending} />
        )}
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
      </div>
    );
  }

  const browsing = search.query.length === 0;
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
          <div className="flex gap-2">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                search.submit();
              }}
              className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 focus-within:border-accent"
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
                className="w-full bg-transparent py-2.5 outline-none focus-visible:outline-none"
              />
            </form>
            <button
              type="button"
              aria-label="Scan barcode"
              onClick={() => setView({ kind: "scan" })}
              className="rounded-xl border border-border bg-surface px-3 text-muted"
            >
              <ScanBarcode size={20} />
            </button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}

          {browsing ? (
            <>
              {(recent.data?.length ?? 0) > 0 && (
                <Section title="Recent">
                  {recent.data!.slice(0, 12).map((r) => (
                    <li key={r.food.id} className="flex items-center">
                      <FoodRow
                        food={r.food}
                        detail={amountLabel(r, r.food.is_liquid ? "ml" : "g")}
                        onPick={() =>
                          void open(r.food, {
                            grams: r.grams,
                            serving_label: r.serving_label,
                            serving_count: r.serving_count,
                          })
                        }
                      />
                      <button
                        type="button"
                        aria-label={`Log ${r.food.name} again`}
                        disabled={logged.has(r.food.id!)}
                        onClick={() => void relog(r)}
                        className="mr-2 shrink-0 rounded-full p-2 text-accent disabled:text-good"
                      >
                        {logged.has(r.food.id!) ? <Check size={20} /> : <Plus size={20} />}
                      </button>
                    </li>
                  ))}
                </Section>
              )}
              {(favourites.data?.length ?? 0) > 0 && (
                <Section title="Favourites">
                  {favourites.data!.map((f) => (
                    <li key={f.id}>
                      <FoodRow food={f} onPick={() => void open(f)} />
                    </li>
                  ))}
                </Section>
              )}
              {(savedMeals.data?.length ?? 0) > 0 && (
                <Section title="Saved meals">
                  {savedMeals.data!.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setView({ kind: "meal", meal: m })}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
                      >
                        <span dir="auto" className="truncate text-left">
                          {m.name}
                        </span>
                        <span className="tabular shrink-0 text-xs text-muted">
                          {m.items.length} items · {Math.round(m.totals.energy_kcal ?? 0)} kcal
                        </span>
                      </button>
                    </li>
                  ))}
                </Section>
              )}
              {recent.data?.length === 0 &&
                favourites.data?.length === 0 &&
                savedMeals.data?.length === 0 && (
                  <p className="text-sm text-muted">
                    Search by name, or scan a barcode. Foods you log show up here for next time.
                  </p>
                )}
            </>
          ) : (
            <>
              {search.query.length < 3 && (
                <p className="text-sm text-muted">Type at least 3 letters.</p>
              )}
              {search.failed.length > 0 && (
                <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  {search.failed.map((s) => SOURCE_NAMES[s] ?? s).join(" and ")} didn't respond, so
                  some results may be missing.
                </p>
              )}
              {search.error && (
                <p role="alert" className="text-sm text-bad">
                  Couldn't search the food database. Your own foods are still listed.
                </p>
              )}
              {search.mine.length > 0 && (
                <Section title="My foods">
                  {search.mine.map((f) => (
                    <li key={f.id}>
                      <FoodRow food={f} onPick={() => void open(f)} />
                    </li>
                  ))}
                </Section>
              )}
              {search.query.length >= 3 && (
                <Section title="Database">
                  {search.found.map((f) => (
                    <li key={`${f.source}:${f.source_ref}`}>
                      <FoodRow food={f} onPick={() => void open(f)} />
                    </li>
                  ))}
                  {search.searching ? (
                    <li className="px-4 py-2.5 text-sm text-muted" role="status">
                      Searching Open Food Facts and USDA…
                    </li>
                  ) : search.found.length === 0 ? (
                    <li className="px-4 py-2.5 text-sm text-muted">No matches in the database.</li>
                  ) : null}
                </Section>
              )}
              {search.query.length >= 3 && !search.searching && onCreateFood && (
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
        </>
      )}
    </div>
  );
}

function SavedMealConfirm({
  meal,
  day,
  target,
  onBack,
  onLogged,
}: {
  meal: SavedMeal;
  day: string;
  target: Meal;
  onBack: () => void;
  onLogged: () => void;
}) {
  const logMeal = useLogSavedMeal();
  const [error, setError] = useState<string | null>(null);
  const log = async () => {
    setError(null);
    try {
      await logMeal.mutateAsync({
        id: meal.id,
        meal: target,
        eaten_at: eatenAtFor(day, target, new Date()),
      });
      onLogged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't log it. Try again.");
    }
  };
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-sm text-muted">
        <ChevronLeft size={16} /> Back to search
      </button>
      <h3 dir="auto" className="text-left font-medium">
        {meal.name}
      </h3>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
        {meal.items.map((item, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="min-w-0">
              <FoodName name={item.name} />
              <span className="block text-xs text-muted">{amountLabel(item) || "—"}</span>
            </span>
            <span className="tabular shrink-0 text-sm">
              {Math.round(item.nutrients.energy_kcal ?? 0)}
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void log()}
        disabled={logMeal.isPending}
        className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60"
      >
        Log all {meal.items.length} ({Math.round(meal.totals.energy_kcal ?? 0)} kcal)
      </button>
    </div>
  );
}
