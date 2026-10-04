import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Series } from "../../lib/types";

vi.mock("recharts", async (orig) => ({
  ...(await orig<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div style={{ width: 400, height: 200 }}>{children}</div>
  ),
}));

import { TrendChart } from "./TrendChart";

const series = (metric: string, label: string): Series => ({
  metric,
  label,
  unit: "kcal",
  points: [
    { date: "2026-02-28", value: 2000 },
    { date: "2026-03-01", value: 2200 },
  ],
  trend: [
    { date: "2026-02-28", value: 2000 },
    { date: "2026-03-01", value: 2100 },
  ],
  change: 100,
  weekly_rate: null,
  min: 2000,
  max: 2200,
  latest: 2100,
});

describe("TrendChart legend", () => {
  it("calls the intake trend a 7-day average", () => {
    render(<TrendChart primary={series("energy_kcal", "Calories")} />);
    expect(screen.getByText("7-day average")).toBeInTheDocument();
    expect(screen.getByText("Days")).toBeInTheDocument();
  });

  it("shows the burn as a weekly estimate without separate readings", () => {
    render(<TrendChart primary={series("tdee_kcal", "Burn (TDEE)")} />);
    expect(screen.getByText("Weekly estimate")).toBeInTheDocument();
    expect(screen.queryByText("Readings")).not.toBeInTheDocument();
  });

  it("keeps Readings and Trend for body metrics", () => {
    render(<TrendChart primary={{ ...series("weight_kg", "Weight"), unit: "kg" }} />);
    expect(screen.getByText("Readings")).toBeInTheDocument();
    expect(screen.getByText("Trend")).toBeInTheDocument();
  });
});
