import type { Meal } from "./types";

export const MEALS: { key: Meal; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snacks" },
];

// Typical times used when logging into a past day's meal.
const MEAL_HOUR: Record<Meal, number> = { breakfast: 8, lunch: 13, dinner: 19, snack: 16 };

export function defaultMeal(at: Date): Meal {
  const h = at.getHours();
  if (h >= 4 && h < 11) return "breakfast";
  if (h >= 11 && h < 16) return "lunch";
  if (h >= 16 && h < 22) return "dinner";
  return "snack";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + delta));
}

/** Now when logging today; otherwise the meal's usual time on that day (local time). */
export function eatenAtFor(day: string, meal: Meal, now: Date): string {
  if (day === isoDay(now)) return now.toISOString();
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, MEAL_HOUR[meal], 0).toISOString();
}

export function dayLabel(day: string, now: Date): string {
  const today = isoDay(now);
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
