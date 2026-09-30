import type { NutrientKey } from "./types";

export type NutrientSpec = {
  key: NutrientKey;
  label: string;
  unit: string;
  kind: "macro" | "micro";
  /** Upper bound per 100 g, mirrored from backend/app/nutrients.py */
  max: number;
};

// Same order and keys as backend/app/nutrients.py; nutrients.test.ts pins the list.
export const NUTRIENTS: NutrientSpec[] = [
  { key: "energy_kcal", label: "Calories", unit: "kcal", kind: "macro", max: 900 },
  { key: "protein_g", label: "Protein", unit: "g", kind: "macro", max: 100 },
  { key: "carbs_g", label: "Carbs", unit: "g", kind: "macro", max: 100 },
  { key: "fat_g", label: "Fat", unit: "g", kind: "macro", max: 100 },
  { key: "fiber_g", label: "Fibre", unit: "g", kind: "macro", max: 100 },
  { key: "sugar_g", label: "Sugar", unit: "g", kind: "macro", max: 100 },
  { key: "sat_fat_g", label: "Saturated fat", unit: "g", kind: "macro", max: 100 },
  { key: "sodium_mg", label: "Sodium", unit: "mg", kind: "micro", max: 40_000 },
  { key: "potassium_mg", label: "Potassium", unit: "mg", kind: "micro", max: 20_000 },
  { key: "calcium_mg", label: "Calcium", unit: "mg", kind: "micro", max: 10_000 },
  { key: "iron_mg", label: "Iron", unit: "mg", kind: "micro", max: 500 },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", kind: "micro", max: 5_000 },
  { key: "zinc_mg", label: "Zinc", unit: "mg", kind: "micro", max: 500 },
  { key: "vit_d_mcg", label: "Vitamin D", unit: "µg", kind: "micro", max: 1_000 },
  { key: "vit_b12_mcg", label: "Vitamin B12", unit: "µg", kind: "micro", max: 1_000 },
  { key: "vit_c_mg", label: "Vitamin C", unit: "mg", kind: "micro", max: 5_000 },
  { key: "vit_a_mcg", label: "Vitamin A", unit: "µg", kind: "micro", max: 50_000 },
  { key: "folate_mcg", label: "Folate", unit: "µg", kind: "micro", max: 10_000 },
];

export const NUTRIENT: Record<NutrientKey, NutrientSpec> = Object.fromEntries(
  NUTRIENTS.map((n) => [n.key, n]),
) as Record<NutrientKey, NutrientSpec>;

export const MACROS = ["protein_g", "carbs_g", "fat_g"] as const;
