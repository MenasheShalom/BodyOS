import type { Food, Nutrients, NutrientKey, Serving } from "./types";

export function baseServing(food: Pick<Food, "is_liquid">): Serving {
  return { label: food.is_liquid ? "100 ml" : "100 g", grams: 100 };
}

/** The food's named servings, with 100 g (or ml) always first. */
export function servingsFor(food: Pick<Food, "is_liquid" | "servings">): Serving[] {
  const base = baseServing(food);
  return [base, ...food.servings.filter((s) => s.label !== base.label)];
}

export function gramsFor(serving: Serving, count: number): number {
  return Math.round(serving.grams * count * 10) / 10;
}

/** A preview of an entry's nutrients; the server computes the stored snapshot. */
export function nutrientsFor(food: Pick<Food, "nutrients_per_100g">, grams: number): Nutrients {
  const out: Nutrients = {};
  for (const [key, per100] of Object.entries(food.nutrients_per_100g)) {
    if (per100 != null) out[key as NutrientKey] = (per100 * grams) / 100;
  }
  return out;
}

/** "2 × 2 tbsp", "150 g", or "" for quick-add entries. */
export function amountLabel(
  entry: { grams: number | null; serving_label: string | null; serving_count: number | null },
  unit: "g" | "ml" = "g",
): string {
  if (entry.grams == null) return "";
  const isBase = entry.serving_label == null || /^100 (g|ml)$/.test(entry.serving_label);
  if (isBase || entry.serving_count == null) return `${Number(entry.grams.toFixed(1))} ${unit}`;
  const count = Number(entry.serving_count.toFixed(2));
  return count === 1 ? entry.serving_label! : `${count} × ${entry.serving_label}`;
}

/** The serving picker's state: which serving, and a count as typed (comma decimals allowed). */
export type ServingChoice = { index: number; count: string };

export function parseCount(raw: string): number | null {
  const n = Number(raw.replace(",", "."));
  return raw.trim() === "" || Number.isNaN(n) || n <= 0 || n > 100 ? null : n;
}

/** Grams for a serving choice, or null while the count is invalid. */
export function choiceGrams(servings: Serving[], choice: ServingChoice): number | null {
  const count = parseCount(choice.count);
  const serving = servings[choice.index];
  return count == null || !serving ? null : gramsFor(serving, count);
}
