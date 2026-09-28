import { describe, expect, it } from "vitest";
import { mergeSeries, yDomain } from "./chart";
import type { Series } from "./types";

const series = (points: [string, number][], trend: [string, number][]): Series => ({
  metric: "m",
  label: "M",
  unit: "kg",
  points: points.map(([date, value]) => ({ date, value })),
  trend: trend.map(([date, value]) => ({ date, value })),
  change: null,
  weekly_rate: null,
  min: null,
  max: null,
  latest: null,
});

describe("mergeSeries", () => {
  it("joins raw and trend by date", () => {
    const rows = mergeSeries(
      series(
        [
          ["2026-02-01", 80],
          ["2026-02-03", 79],
        ],
        [
          ["2026-02-01", 80],
          ["2026-02-03", 79.9],
        ],
      ),
    );
    expect(rows).toEqual([
      { date: "2026-02-01", raw: 80, trend: 80 },
      { date: "2026-02-03", raw: 79, trend: 79.9 },
    ]);
  });

  it("adds a secondary series on shared or new dates", () => {
    const rows = mergeSeries(
      series([["2026-02-01", 16]], [["2026-02-01", 16]]),
      series(
        [
          ["2026-02-01", 64],
          ["2026-02-02", 64.2],
        ],
        [
          ["2026-02-01", 64],
          ["2026-02-02", 64.02],
        ],
      ),
    );
    expect(rows).toEqual([
      { date: "2026-02-01", raw: 16, trend: 16, raw2: 64, trend2: 64 },
      { date: "2026-02-02", raw2: 64.2, trend2: 64.02 },
    ]);
  });
});

describe("yDomain", () => {
  it("stretches the axis to include a goal outside the data", () => {
    const [lo, hi] = yDomain([19, 21.5], 16);
    expect(lo).toBeLessThan(16);
    expect(hi).toBeGreaterThan(21.5);
  });
  it("pads the data range when there is no goal", () => {
    const [lo, hi] = yDomain([60, 62], null);
    expect(lo).toBeLessThan(60);
    expect(hi).toBeGreaterThan(62);
    expect(lo).toBeGreaterThan(59);
  });
  it("still gives a visible range for a flat line", () => {
    const [lo, hi] = yDomain([80, 80], null);
    expect(hi - lo).toBeGreaterThan(0);
  });
});
