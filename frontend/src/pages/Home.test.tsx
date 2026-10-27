import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Dashboard, MetricSummary } from "../lib/types";

const useDashboard = vi.fn();
vi.mock("../lib/queries", () => ({ useDashboard: () => useDashboard() }));
vi.mock("../components/AppLayout", () => ({ useLogSheet: () => ({ open: vi.fn() }) }));
vi.mock("../components/charts/Sparkline", () => ({ Sparkline: () => null }));
vi.mock("../components/RecentWeighIns", () => ({ RecentWeighIns: () => <p>recent weigh-ins</p> }));
vi.mock("../components/ai/ReportCard", () => ({ ReportCard: () => null }));
vi.mock("../components/training/TrainingCard", () => ({ TrainingCard: () => null }));
vi.mock("../components/nutrition/CheckInCard", () => ({
  CheckInCard: () => <p>check-in card</p>,
}));

import { greeting, Home, nudgeMessages } from "./Home";

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
  hero: [m("weight_kg", "Weight", "kg", null), m("body_fat_pct", "Body fat", "%", null)],
  cards: [m("muscle_mass_kg", "Muscle mass", "kg", null), m("waist_cm", "Waist", "cm", null)],
  secondary: [m("bmi", "BMI", "", null)],
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
          m("weight_kg", "Weight", "kg", 80.4, -0.6),
          m("body_fat_pct", "Body fat", "%", 18.2, 0.3),
        ],
        secondary: [m("bmi", "BMI", "", 24.7)],
        nudges: { days_since_weigh_in: 3, days_since_photo: 35 },
      },
    });
    renderHome();
    expect(screen.getByText("80.4").parentElement).toHaveTextContent("80.4kg");
    expect(screen.getByText("18.2").parentElement).toHaveTextContent("18.2%");
    expect(screen.getByText("−0.6 kg")).toHaveAttribute("data-tone", "good");
    expect(screen.getByText(/^\+0\.3/)).toHaveAttribute("data-tone", "bad");
    expect(screen.getByText("Last weigh-in: 3 days ago")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Set a goal/ })).toHaveAttribute("href", "/goals");
    expect(screen.getByText("recent weigh-ins")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Track more/ })).toHaveTextContent(
      "Add muscle mass and waist to see them here",
    );
    expect(screen.getByRole("link", { name: /Progress photos/ })).toHaveAttribute(
      "href",
      "/photos",
    );
  });
});

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 0, 1, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 0, 1, 21))).toBe("Good evening");
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

  it("nudges when nothing is logged for food in the afternoon", () => {
    expect(
      nudgeMessages({ days_since_weigh_in: 0, days_since_photo: 3, no_food_today: true }),
    ).toEqual([{ text: "Nothing logged for food today yet", tab: "food" }]);
  });
});

describe("Home nutrition", () => {
  it("shows the check-in and today's food against targets", () => {
    useDashboard.mockReturnValue({
      isPending: false,
      data: {
        ...empty,
        hero: [m("weight_kg", "Weight", "kg", 80), m("body_fat_pct", "Body fat", "%", 18)],
        check_in: { week_start: "2026-03-01" },
        food_today: {
          energy_kcal: 1220,
          protein_g: 96,
          target_kcal: 2280,
          target_protein_g: 170,
          entries: 3,
        },
      },
    });
    renderHome();
    expect(screen.getByText("check-in card")).toBeInTheDocument();
    const card = screen.getByRole("link", { name: "Today's food" });
    expect(card).toHaveAttribute("href", "/food");
    expect(card).toHaveTextContent("1,220 / 2,280 kcal");
    expect(card).toHaveTextContent("96 / 170 g");
  });

  it("shows plain totals before targets are set", () => {
    useDashboard.mockReturnValue({
      isPending: false,
      data: {
        ...empty,
        hero: [m("weight_kg", "Weight", "kg", 80), m("body_fat_pct", "Body fat", "%", 18)],
        food_today: {
          energy_kcal: 800,
          protein_g: 40,
          target_kcal: null,
          target_protein_g: null,
          entries: 1,
        },
      },
    });
    renderHome();
    expect(screen.getByRole("link", { name: "Today's food" })).toHaveTextContent(
      "800 kcal · 40 g protein",
    );
  });
});
