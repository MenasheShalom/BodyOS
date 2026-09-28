import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Dashboard, MetricSummary } from "../lib/types";

const useDashboard = vi.fn();
vi.mock("../lib/queries", () => ({ useDashboard: () => useDashboard() }));
vi.mock("../components/AppLayout", () => ({ useLogSheet: () => ({ open: vi.fn() }) }));
vi.mock("../components/charts/Sparkline", () => ({ Sparkline: () => null }));

import { Home, nudgeMessages } from "./Home";

const m = (
  metric: string,
  label: string,
  unit: string,
  latest: number | null,
  change: number | null = null,
): MetricSummary => ({
  metric,
  label,
  unit,
  latest,
  change_30d: change,
  goal_direction: null,
  sparkline: [],
});

const empty: Dashboard = {
  hero: [m("fat_mass_kg", "Fat mass", "kg", null), m("lean_mass_kg", "Lean mass", "kg", null)],
  cards: [m("body_fat_pct", "Body fat", "%", null), m("muscle_mass_kg", "Muscle mass", "kg", null)],
  secondary: [
    m("weight_kg", "Weight", "kg", null),
    m("bmi", "BMI", "", null),
    m("waist_cm", "Waist", "cm", null),
  ],
  goals: [],
  nudges: { days_since_weigh_in: null, days_since_photo: null },
};

const renderHome = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );

describe("Home", () => {
  it("welcomes a new user", () => {
    useDashboard.mockReturnValue({ data: empty, isPending: false });
    renderHome();
    expect(screen.getByText("Welcome to BodyOS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log weigh-in" })).toBeInTheDocument();
  });

  it("shows recomposition stats with tone and a goal prompt", () => {
    useDashboard.mockReturnValue({
      isPending: false,
      data: {
        ...empty,
        hero: [
          m("fat_mass_kg", "Fat mass", "kg", 14.8, -0.6),
          m("lean_mass_kg", "Lean mass", "kg", 65.2, 0.3),
        ],
        secondary: [
          m("weight_kg", "Weight", "kg", 80),
          m("bmi", "BMI", "", 24.7),
          m("waist_cm", "Waist", "cm", null),
        ],
        nudges: { days_since_weigh_in: 3, days_since_photo: 35 },
      },
    });
    renderHome();
    expect(screen.getByText("14.8").parentElement).toHaveTextContent("14.8kg");
    expect(screen.getByText("−0.6 kg")).toHaveAttribute("data-tone", "good");
    expect(screen.getByText("+0.3 kg")).toHaveAttribute("data-tone", "good");
    expect(screen.getByText("Last weigh-in: 3 days ago")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Set a goal/ })).toHaveAttribute("href", "/goals");
  });
});

describe("nudgeMessages", () => {
  it("nudges for stale weigh-ins and photos", () => {
    expect(nudgeMessages({ days_since_weigh_in: 0, days_since_photo: 3 })).toEqual([]);
    expect(
      nudgeMessages({ days_since_weigh_in: 2, days_since_photo: null }).map((n) => n.text),
    ).toEqual(["Last weigh-in: 2 days ago", "No progress photos yet. Add your first?"]);
    expect(nudgeMessages({ days_since_weigh_in: 1, days_since_photo: 30 })[0].text).toBe(
      "No photos in 4 weeks. Time for a check-in?",
    );
  });
});
