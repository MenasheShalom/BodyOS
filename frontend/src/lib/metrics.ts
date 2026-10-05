import type { GoalMetric, ScaleField, TapeField } from "./types";

export type FieldSpec = {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
};

export const WEIGHT: FieldSpec = {
  key: "weight_kg",
  label: "Weight",
  unit: "kg",
  min: 20,
  max: 400,
  step: 0.1,
};

export const SCALE_FIELDS: (FieldSpec & { key: ScaleField })[] = [
  { key: "body_fat_pct", label: "Body fat", unit: "%", min: 2, max: 70, step: 0.1 },
  { key: "muscle_mass_kg", label: "Muscle mass", unit: "kg", min: 5, max: 200, step: 0.1 },
  { key: "skeletal_muscle_pct", label: "Skeletal muscle", unit: "%", min: 5, max: 80, step: 0.1 },
  { key: "body_water_pct", label: "Body water", unit: "%", min: 20, max: 80, step: 0.1 },
  { key: "bone_mass_kg", label: "Bone mass", unit: "kg", min: 0.5, max: 10, step: 0.1 },
  { key: "visceral_fat", label: "Visceral fat", unit: "", min: 1, max: 60, step: 0.5 },
  { key: "protein_pct", label: "Protein", unit: "%", min: 5, max: 30, step: 0.1 },
  { key: "bmr_kcal", label: "BMR", unit: "kcal", min: 500, max: 5000, step: 1 },
  { key: "metabolic_age", label: "Metabolic age", unit: "yrs", min: 10, max: 100, step: 1 },
];

export const TAPE_FIELDS: (FieldSpec & { key: TapeField })[] = [
  { key: "waist_cm", label: "Waist", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "hips_cm", label: "Hips", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "chest_cm", label: "Chest", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "neck_cm", label: "Neck", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "arm_cm", label: "Arm", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "thigh_cm", label: "Thigh", unit: "cm", min: 10, max: 250, step: 0.1 },
];

type Group = "Composition" | "Scale" | "Tape" | "Nutrition";
export const SERIES_METRICS: { key: string; label: string; unit: string; group: Group }[] = [
  { key: "fat_mass_kg", label: "Fat mass", unit: "kg", group: "Composition" },
  { key: "lean_mass_kg", label: "Lean mass", unit: "kg", group: "Composition" },
  { key: "body_fat_pct", label: "Body fat", unit: "%", group: "Composition" },
  { key: "muscle_mass_kg", label: "Muscle mass", unit: "kg", group: "Composition" },
  { key: "navy_body_fat_pct", label: "Body fat (Navy)", unit: "%", group: "Composition" },
  { key: "ai_body_fat_pct", label: "Body fat (AI photo)", unit: "%", group: "Composition" },
  { key: "weight_kg", label: "Weight", unit: "kg", group: "Scale" },
  { key: "bmi", label: "BMI", unit: "", group: "Scale" },
  ...SCALE_FIELDS.filter((f) => !["body_fat_pct", "muscle_mass_kg"].includes(f.key)).map((f) => ({
    key: f.key,
    label: f.label,
    unit: f.unit,
    group: "Scale" as const,
  })),
  ...TAPE_FIELDS.map((f) => ({ key: f.key, label: f.label, unit: f.unit, group: "Tape" as const })),
  { key: "energy_kcal", label: "Calories", unit: "kcal", group: "Nutrition" },
  { key: "protein_g", label: "Protein", unit: "g", group: "Nutrition" },
  { key: "carbs_g", label: "Carbs", unit: "g", group: "Nutrition" },
  { key: "fat_g", label: "Fat", unit: "g", group: "Nutrition" },
  { key: "fiber_g", label: "Fibre", unit: "g", group: "Nutrition" },
  { key: "tdee_kcal", label: "Burn (TDEE)", unit: "kcal", group: "Nutrition" },
];

/** How a series' trend line is made, for its legend and line shape (backend app/metrics.py). */
export function trendKind(metric: string): "ewma" | "rolling7" | "step" | "none" {
  if (metric === "tdee_kcal") return "step";
  // Each AI photo estimate is a separate rough range, so there's no trend line.
  if (metric === "ai_body_fat_pct") return "none";
  return ["energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"].includes(metric)
    ? "rolling7"
    : "ewma";
}

export const TREND_LABEL = {
  ewma: "Trend",
  rolling7: "7-day average",
  step: "Weekly estimate",
  none: "",
};

export const GOAL_METRICS: { key: GoalMetric; label: string; unit: string }[] = [
  { key: "body_fat_pct", label: "Body fat", unit: "%" },
  { key: "muscle_mass_kg", label: "Muscle mass", unit: "kg" },
  { key: "fat_mass_kg", label: "Fat mass", unit: "kg" },
  { key: "lean_mass_kg", label: "Lean mass", unit: "kg" },
  { key: "weight_kg", label: "Weight", unit: "kg" },
  { key: "waist_cm", label: "Waist", unit: "cm" },
  { key: "navy_body_fat_pct", label: "Body fat (Navy)", unit: "%" },
];

export function metricInfo(key: string): { label: string; unit: string } {
  const found = SERIES_METRICS.find((m) => m.key === key);
  return found ? { label: found.label, unit: found.unit } : { label: key, unit: "" };
}
