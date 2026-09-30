import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Food } from "../lib/types";
import { CustomFoodForm } from "./CustomFoodForm";

describe("CustomFoodForm", () => {
  it("requires a name, a serving size and calories", async () => {
    const onSubmit = vi.fn();
    render(<CustomFoodForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Create food" }));
    expect(screen.getAllByText("Required")).toHaveLength(2); // name and calories
    expect(screen.getByText("Between 0 and 5000")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends per-serving values with the serving as the first named serving", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CustomFoodForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Name"), "Protein shake");
    const servingName = screen.getByLabelText("Serving name");
    await userEvent.clear(servingName);
    await userEvent.type(servingName, "1 scoop");
    await userEvent.type(screen.getByLabelText("Serving size"), "30");
    await userEvent.type(screen.getByLabelText("Calories"), "120");
    await userEvent.type(screen.getByLabelText("Protein"), "24");
    await userEvent.click(screen.getByRole("button", { name: "Create food" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Protein shake",
      brand: null,
      barcode: null,
      is_liquid: false,
      servings: [{ label: "1 scoop", grams: 30 }],
      nutrients_per_serving: { energy_kcal: 120, protein_g: 24 },
      serving_grams: 30,
    });
  });

  it("checks per-100 g limits after converting a serving", async () => {
    const onSubmit = vi.fn();
    render(<CustomFoodForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Name"), "Oil");
    await userEvent.type(screen.getByLabelText("Serving size"), "10");
    await userEvent.type(screen.getByLabelText("Calories"), "120"); // 1200 kcal per 100 g
    await userEvent.click(screen.getByRole("button", { name: "Create food" }));
    expect(screen.getByText("Too high (max 900 per 100 g)")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("prefills from a database food per 100 g, including micronutrients", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const food: Food = {
      id: "f1",
      source: "off",
      source_ref: "7290004131074",
      barcode: "7290004131074",
      name: "Milk 3% fat",
      brand: "תנובה",
      nutrients_per_100g: { energy_kcal: 60, protein_g: 3.3, calcium_mg: 120 },
      servings: [{ label: "1 glass", grams: 250 }],
      is_liquid: true,
      is_own: false,
    };
    render(<CustomFoodForm initial={food} onSubmit={onSubmit} />);
    expect(screen.getByLabelText("Calcium")).toHaveValue("120");
    await userEvent.click(screen.getByRole("button", { name: "Create food" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Milk 3% fat",
      brand: "תנובה",
      barcode: "7290004131074",
      is_liquid: true,
      servings: [{ label: "1 glass", grams: 250 }],
      nutrients_per_100g: { energy_kcal: 60, protein_g: 3.3, calcium_mg: 120 },
    });
  });

  it("warns that edits only affect future logs", () => {
    render(<CustomFoodForm editing onSubmit={vi.fn()} />);
    expect(screen.getByText(/Past days keep what was logged/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save food" })).toBeInTheDocument();
  });
});
