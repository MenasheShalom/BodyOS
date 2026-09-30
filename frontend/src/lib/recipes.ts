import { NUTRIENTS } from "./nutrients";
import type { NutrientKey, Nutrients } from "./types";

export type DraftItem = { grams: number; per100: Nutrients };

/** Per-serving nutrients of a draft recipe: only what every ingredient reports (spec §6.5). */
export function recipePreview(items: DraftItem[], servings: number) {
  const perServing: Nutrients = {};
  const incomplete: NutrientKey[] = [];
  for (const { key } of NUTRIENTS) {
    const reporting = items.filter((i) => i.per100[key] != null);
    if (reporting.length === 0) continue;
    if (reporting.length < items.length) {
      incomplete.push(key);
      continue;
    }
    const total = items.reduce((sum, i) => sum + (i.per100[key]! * i.grams) / 100, 0);
    perServing[key] = servings > 0 ? total / servings : 0;
  }
  const totalGrams = items.reduce((sum, i) => sum + i.grams, 0);
  return { perServing, incomplete, totalGrams };
}
