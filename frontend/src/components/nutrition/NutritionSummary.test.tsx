import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { NutritionSummary } from "./NutritionSummary";

const target = { energy_kcal: 2340, protein_g: 170, carbs_g: 270, fat_g: 65, fiber_g: 35 };
const renderIt = (props: Parameters<typeof NutritionSummary>[0]) =>
  render(
    <MemoryRouter>
      <NutritionSummary {...props} />
    </MemoryRouter>,
  );

describe("NutritionSummary", () => {
  it("shows calories left and macro meters, protein first", () => {
    renderIt({ totals: { energy_kcal: 1220.4, protein_g: 96, fat_g: 40 }, target });
    expect(screen.getByText("1,220")).toBeInTheDocument();
    expect(screen.getByText("of 2,340 kcal")).toBeInTheDocument();
    expect(screen.getByText("1,120 left")).toBeInTheDocument();
    const meters = screen.getAllByRole("meter");
    expect(meters.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Calories",
      "Protein",
      "Carbs",
      "Fat",
    ]);
    expect(screen.getByText("96 / 170 g")).toBeInTheDocument();
    expect(screen.getByText("0 / 270 g")).toBeInTheDocument(); // no carbs logged yet
  });

  it("says how far over target in words, not only colour", () => {
    renderIt({ totals: { energy_kcal: 2500 }, target });
    expect(screen.getByText("160 over")).toHaveClass("text-bad");
  });

  it("shows plain totals and a setup link without a target", () => {
    renderIt({ totals: { energy_kcal: 800, protein_g: 50 }, target: null });
    expect(screen.queryAllByRole("meter")).toHaveLength(0);
    expect(screen.getByText("50 g")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set targets" })).toHaveAttribute(
      "href",
      "/nutrition/setup",
    );
  });
});
