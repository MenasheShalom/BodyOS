import type { Series } from "./types";

export type ChartRow = {
  date: string;
  raw?: number;
  trend?: number;
  raw2?: number;
  trend2?: number;
};

export function mergeSeries(primary: Series, secondary?: Series): ChartRow[] {
  const rows = new Map<string, ChartRow>();
  const put = (date: string, key: keyof Omit<ChartRow, "date">, value: number) => {
    const row = rows.get(date) ?? { date };
    row[key] = value;
    rows.set(date, row);
  };
  primary.points.forEach((p) => put(p.date, "raw", p.value));
  primary.trend.forEach((p) => put(p.date, "trend", p.value));
  secondary?.points.forEach((p) => put(p.date, "raw2", p.value));
  secondary?.trend.forEach((p) => put(p.date, "trend2", p.value));
  return [...rows.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Y-axis bounds covering every value and the goal (so the goal line is always drawn),
 * padded by 8% of the span so marks don't sit on the chart edges. */
export function yDomain(values: number[], goal: number | null | undefined): [number, number] {
  const all = goal == null ? values : [...values, goal];
  if (all.length === 0) return [0, 1];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = hi > lo ? (hi - lo) * 0.08 : Math.max(Math.abs(hi) * 0.02, 0.5);
  const round = (n: number) => Math.round(n * 10) / 10;
  return [round(lo - pad), round(hi + pad)];
}
