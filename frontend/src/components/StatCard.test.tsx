import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("./charts/Sparkline", () => ({ Sparkline: () => null }));

import { StatCard } from "./StatCard";

const summary = {
  metric: "fat_mass_kg",
  label: "Fat mass",
  unit: "kg",
  latest: 15.2,
  change_30d: -0.9,
  goal_direction: null,
  sparkline: [],
};

describe("StatCard", () => {
  it("keeps the number and a smaller unit together on one line", () => {
    render(
      <MemoryRouter>
        <StatCard summary={summary} size="hero" />
      </MemoryRouter>,
    );
    const number = screen.getByText("15.2");
    const value = number.parentElement!;
    expect(value).toHaveTextContent("15.2kg");
    expect(value).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("kg")).not.toBe(number);
  });

  it("shows a dash without a unit when there is no value", () => {
    render(
      <MemoryRouter>
        <StatCard summary={{ ...summary, latest: null, change_30d: null }} />
      </MemoryRouter>,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("kg")).not.toBeInTheDocument();
  });
});
