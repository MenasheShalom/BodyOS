import type { ActivityLevel, FoodCountry, NutritionMode, NutritionSettingsInput } from "./types";

export const MODES: { key: NutritionMode; label: string; body: string; deficit: number }[] = [
  {
    key: "recomp",
    label: "Recomp",
    body: "Lose fat, keep or build muscle. Small deficit.",
    deficit: 10,
  },
  { key: "cut", label: "Cut", body: "Lose fat faster. Larger deficit.", deficit: 20 },
  { key: "maintain", label: "Maintain", body: "Hold your weight steady.", deficit: 0 },
  { key: "lean_bulk", label: "Lean bulk", body: "Build muscle with a small surplus.", deficit: -7 },
];

export const ACTIVITY: { key: ActivityLevel; label: string; body: string }[] = [
  { key: "sedentary", label: "Sedentary", body: "Desk job, little exercise" },
  { key: "light", label: "Light", body: "Training 1–3 times a week" },
  { key: "moderate", label: "Moderate", body: "Training 3–5 times a week" },
  { key: "very", label: "Very active", body: "Hard training most days or a physical job" },
];

export const COUNTRIES: { key: FoodCountry; label: string }[] = [
  { key: "en:israel", label: "Israel" },
  { key: "en:united-states", label: "United States" },
  { key: "en:united-kingdom", label: "United Kingdom" },
  { key: "en:world", label: "No preference" },
];

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function settingsInput(s: NutritionSettingsInput): NutritionSettingsInput {
  return {
    mode: s.mode,
    deficit_pct: s.deficit_pct,
    protein_g_per_kg: s.protein_g_per_kg,
    activity_level: s.activity_level,
    check_in_weekday: s.check_in_weekday,
    food_country: s.food_country,
  };
}
