/** WHO adult BMI zones. `max` is exclusive. */
export const BMI_ZONES = [
  { label: "Underweight", min: 0, max: 18.5 },
  { label: "Healthy", min: 18.5, max: 25 },
  { label: "Overweight", min: 25, max: 30 },
  { label: "Obese", min: 30, max: Infinity },
] as const;

export type BmiZone = (typeof BMI_ZONES)[number]["label"];

const BOUNDARIES = [18.5, 25, 30];
/** Highest BMI still counted as healthy, as usually quoted (below 25). */
const HEALTHY_TOP = 24.9;

export function bmiZone(bmi: number): BmiZone {
  return BMI_ZONES.find((z) => bmi >= z.min && bmi < z.max)!.label;
}

/** Weight range (kg, 1 dp) that puts someone of this height in the healthy zone. */
export function healthyWeightRange(heightCm: number): [number, number] {
  const m2 = (heightCm / 100) ** 2;
  const round = (n: number) => Math.round(n * 10) / 10;
  return [round(18.5 * m2), round(HEALTHY_TOP * m2)];
}

/** The zone boundary at or just below the lowest reading and just above the highest,
 * so the chart shows which zone you're in and the next one without flattening the line. */
export function bmiBoundariesAround(values: number[]): number[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const below = [...BOUNDARIES].reverse().find((b) => b <= lo);
  const above = BOUNDARIES.find((b) => b > hi);
  const inside = BOUNDARIES.filter((b) => b > lo && b <= hi);
  return [below, ...inside, above].filter((b): b is number => b !== undefined);
}

/** Zone bands clipped to a visible [min, max] range. */
export function bmiBands([min, max]: [number, number]): { label: BmiZone; y1: number; y2: number }[] {
  return BMI_ZONES.filter((z) => z.max > min && z.min < max).map((z) => ({
    label: z.label,
    y1: Math.max(z.min, min),
    y2: Math.min(z.max, max),
  }));
}
