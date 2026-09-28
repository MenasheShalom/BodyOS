export type Direction = "up" | "down";
export type Tone = "good" | "bad" | "neutral";

export function formatValue(value: number | null | undefined, unit = "", digits = 1): string {
  if (value == null) return "—";
  const n = value.toFixed(digits);
  if (!unit) return n;
  return unit === "%" ? `${n}%` : `${n} ${unit}`;
}

export function formatChange(value: number | null | undefined, unit = "", digits = 1): string {
  if (value == null) return "—";
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  // A change in a percentage (e.g. body fat 20% → 17.5%) is in percentage points.
  const changeUnit = unit === "%" ? "pts" : unit;
  return `${sign}${formatValue(Math.abs(value), changeUnit, digits)}`;
}

export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

export function changeTone(change: number | null | undefined, direction: Direction | null): Tone {
  if (change == null || direction == null || Math.abs(change) < 1e-9) return "neutral";
  return change > 0 === (direction === "up") ? "good" : "bad";
}
