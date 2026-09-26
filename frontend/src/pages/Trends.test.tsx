import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

const useSeries = vi.fn();
vi.mock("../lib/queries", () => ({
  useSeries: (...a: unknown[]) => useSeries(...a),
  goals: { useList: () => ({ data: [] }) },
}));
vi.mock("../components/charts/TrendChart", () => ({
  TrendChart: () => <div data-testid="chart" />,
}));

import { Trends } from "./Trends";

const full = {
  metric: "fat_mass_kg",
  label: "Fat mass",
  unit: "kg",
  points: [
    { date: "2026-02-01", value: 16 },
    { date: "2026-02-20", value: 15.2 },
  ],
  trend: [
    { date: "2026-02-01", value: 16 },
    { date: "2026-02-20", value: 15.5 },
  ],
  change: -0.5,
  weekly_rate: -0.21,
  min: 15.2,
  max: 16,
  latest: 15.5,
};

describe("Trends", () => {
  it("shows stats for the selected metric and range", async () => {
    useSeries.mockReturnValue({ data: full, isPending: false });
    render(
      <MemoryRouter>
        <Trends />
      </MemoryRouter>,
    );
    expect(useSeries).toHaveBeenCalledWith("fat_mass_kg", "3M", true);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText("−0.5 kg")).toBeInTheDocument();
    expect(screen.getByText("−0.2 kg/wk")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1Y" }));
    expect(useSeries).toHaveBeenLastCalledWith(expect.any(String), "1Y", expect.any(Boolean));
  });

  it("shows an empty state with fewer than two readings", () => {
    useSeries.mockReturnValue({ data: { ...full, points: [full.points[0]] }, isPending: false });
    render(
      <MemoryRouter>
        <Trends />
      </MemoryRouter>,
    );
    expect(screen.getByText("Not enough data yet")).toBeInTheDocument();
  });
});
