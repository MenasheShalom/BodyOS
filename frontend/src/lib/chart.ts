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
