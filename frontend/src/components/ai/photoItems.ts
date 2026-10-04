import type { Food, FoodPhotoItem, Nutrients } from "../../lib/types";

/** `text` is what's in the grams box; `grams` the last valid amount it held. */
export type Amount = { grams: number; text: string };
export type Row =
  | ({ key: number; kind: "estimate"; item: FoodPhotoItem } & Amount)
  | ({ key: number; kind: "food"; item: FoodPhotoItem; food: Food & { id: string } } & Amount);

export const MACROS = ["energy_kcal", "protein_g", "carbs_g", "fat_g"] as const;

/** Nutrients for a row at its current amount: estimates scale linearly from the AI's guess. */
export function rowNutrients(row: Row): Nutrients {
  const out: Nutrients = {};
  for (const key of MACROS) {
    const value =
      row.kind === "estimate"
        ? ((row.item.nutrients[key] ?? 0) * row.grams) / row.item.grams
        : ((row.food.nutrients_per_100g[key] ?? 0) * row.grams) / 100;
    out[key] = Math.round(value * 10) / 10;
  }
  return out;
}

/** The name logged for an estimate keeps the estimated amount visible in the day view. */
export const estimateName = (name: string, grams: number) => {
  const suffix = ` (~${Math.round(grams)} g)`;
  return name.slice(0, 200 - suffix.length) + suffix;
};
