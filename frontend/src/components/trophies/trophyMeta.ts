import { Flame, type LucideIcon, Sparkles, Target, TrendingDown } from "lucide-react";
import type { Achievement, TrophyCategory, TrophyTier } from "../../lib/types";

export const CATEGORIES: { key: TrophyCategory; label: string; icon: LucideIcon }[] = [
  { key: "consistency", label: "Consistency", icon: Flame },
  { key: "body", label: "Body", icon: TrendingDown },
  { key: "goals", label: "Goals", icon: Target },
  { key: "habits", label: "Habits", icon: Sparkles },
];
export const CATEGORY_ICON = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.icon])) as Record<
  TrophyCategory,
  LucideIcon
>;

export const TIER_LABEL: Record<TrophyTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};
export const TIER_COLOR: Record<TrophyTier, string> = {
  bronze: "var(--color-bronze)",
  silver: "var(--color-silver)",
  gold: "var(--color-gold)",
};

const fmt = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10).toLocaleString("en-GB");

/** "12 / 30 days" for a locked trophy with a count to show. */
export const progressText = (a: Achievement) => `${fmt(a.progress)} / ${fmt(a.target)} ${a.unit}`;

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const earnedText = (day: string) => `Earned ${dateFmt.format(new Date(`${day}T00:00:00`))}`;

/** This many new trophies at once (usually the first backfill) get one summary card. */
export const SUMMARY_FROM = 4;

// Celebrations can be switched off per device in Settings.
const PREF = "bodyos.celebrations";
export function celebrationsOn(): boolean {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
}
export const CELEBRATIONS_EVENT = "bodyos:celebrations";
export function setCelebrations(on: boolean): void {
  try {
    localStorage.setItem(PREF, on ? "on" : "off");
  } catch {
    // private mode: the default (on) applies
  }
  window.dispatchEvent(new Event(CELEBRATIONS_EVENT));
}
