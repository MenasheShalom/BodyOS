import type { Food, Nutrients, ResolvedIngredient } from "../../lib/types";
import { MACROS } from "./photoItems";

/** One ingredient of an AI plan or recipe as the user edits it. `text` is what's in the grams
 * box; `grams` the last valid amount it held. */
export type PlanRow = {
  key: string;
  name: string;
  search_query: string;
  food: (Food & { id: string }) | null;
  grams: number;
  text: string;
};

export const MAX_GRAMS = 5000;

export const rowsFrom = (items: ResolvedIngredient[], prefix: string): PlanRow[] =>
  items.map((i, n) => ({
    key: `${prefix}-${n}`,
    name: i.name,
    search_query: i.search_query,
    food: i.food,
    grams: i.grams,
    text: String(i.grams),
  }));

/** Calories and macros for a row's current amount; empty until it has a food. */
export function planRowNutrients(row: PlanRow): Nutrients {
  if (!row.food) return {};
  const out: Nutrients = {};
  for (const key of MACROS) {
    const per100 = row.food.nutrients_per_100g[key];
    if (per100 != null) out[key] = Math.round(((per100 * row.grams) / 100) * 10) / 10;
  }
  return out;
}

export function sumMacros(list: Nutrients[]): Nutrients {
  const out: Nutrients = {};
  for (const n of list) {
    for (const key of MACROS) out[key] = (out[key] ?? 0) + (n[key] ?? 0);
  }
  return out;
}

export const resolvedRows = (rows: PlanRow[]) =>
  rows.filter((r): r is PlanRow & { food: Food & { id: string } } => r.food !== null);

/** The steps as stored on a saved recipe: numbered, one per line. */
export const instructionsFrom = (steps: string[]) =>
  steps.map((s, n) => `${n + 1}. ${s}`).join("\n");
