import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FoodLogEntry } from "../../lib/types";
import { FoodName } from "./FoodName";
import { MealSection } from "./MealSection";

const entry = (over: Partial<FoodLogEntry>): FoodLogEntry => ({
  id: "e1",
  eaten_at: "2026-09-30T10:00:00Z",
  meal: "lunch",
  food_id: "f1",
  name: "Hummus",
  grams: 60,
  serving_label: "2 tbsp",
  serving_count: 2,
  nutrients: { energy_kcal: 162 },
  meal_ref: null,
  origin: "manual",
  ...over,
});

describe("MealSection", () => {
  it("lists entries with amounts and a kcal subtotal", async () => {
    const onOpen = vi.fn();
    const quick = entry({
      id: "e2",
      food_id: null,
      name: "Quick add",
      grams: null,
      serving_label: null,
      serving_count: null,
      nutrients: { energy_kcal: 450.4 },
    });
    render(
      <MealSection label="Lunch" entries={[entry({}), quick]} onAdd={vi.fn()} onOpen={onOpen} />,
    );
    const section = screen.getByRole("region", { name: "Lunch" });
    expect(within(section).getByText("612 kcal")).toBeInTheDocument();
    expect(within(section).getByText("2 × 2 tbsp")).toBeInTheDocument();
    expect(within(section).getByText("—")).toBeInTheDocument();
    await userEvent.click(within(section).getByText("Hummus"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "e1" }));
  });

  it("marks entries logged from a food photo as AI estimates", () => {
    const estimate = entry({
      food_id: null,
      name: "White rice (~180 g)",
      grams: null,
      serving_label: null,
      serving_count: null,
      origin: "ai_photo",
    });
    render(<MealSection label="Lunch" entries={[estimate]} onAdd={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText("AI estimate")).toBeInTheDocument();
  });

  it("shows an empty meal and an add button", async () => {
    const onAdd = vi.fn();
    render(<MealSection label="Dinner" entries={[]} onAdd={onAdd} onOpen={vi.fn()} />);
    expect(screen.getByText("Nothing logged")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add to Dinner" }));
    expect(onAdd).toHaveBeenCalled();
  });
});

describe("FoodName", () => {
  it("lets Hebrew names set their own direction", () => {
    render(<FoodName name="במבה" brand="אסם" />);
    expect(screen.getByText("במבה")).toHaveAttribute("dir", "auto");
    expect(screen.getByText("אסם")).toHaveAttribute("dir", "auto");
  });
});
