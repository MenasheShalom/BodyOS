import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Food } from "../../lib/types";

const logFood = vi.fn().mockResolvedValue({});
const setFavourite = vi.fn();
const favourites = vi.fn().mockReturnValue({ data: [] });
vi.mock("../../lib/queries", () => ({
  useLogFood: () => ({ mutateAsync: logFood }),
  useFavourites: () => favourites(),
  useSetFavourite: () => ({ mutate: setFavourite }),
}));

import { FoodDetail } from "./FoodDetail";

const hummus: Food & { id: string } = {
  id: "f1",
  source: "off",
  source_ref: "7290000000017",
  barcode: "7290000000017",
  name: "Demo hummus",
  brand: "צבר",
  nutrients_per_100g: { energy_kcal: 270, protein_g: 7, carbs_g: 12, fat_g: 21 },
  servings: [{ label: "2 tbsp", grams: 30 }],
  is_liquid: false,
  is_own: false,
};

describe("FoodDetail", () => {
  it("previews nutrients for the chosen amount and logs it", async () => {
    const onLogged = vi.fn();
    render(
      <FoodDetail
        food={hummus}
        day="2026-01-15"
        meal="lunch"
        onBack={vi.fn()}
        onLogged={onLogged}
      />,
    );
    expect(screen.getByLabelText("Serving")).toHaveDisplayValue("2 tbsp (30 g)");
    expect(screen.getByText("81")).toBeInTheDocument(); // 30 g x 2.7 kcal
    const amount = screen.getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "2");
    expect(screen.getByText("162")).toBeInTheDocument();
    expect(screen.getByText("60 g")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(logFood).toHaveBeenCalledWith({
      food_id: "f1",
      grams: 60,
      serving_label: "2 tbsp",
      serving_count: 2,
      meal: "lunch",
      eaten_at: new Date(2026, 0, 15, 13, 0).toISOString(),
    });
    expect(onLogged).toHaveBeenCalled();
  });

  it("disables Log while the amount is invalid", async () => {
    render(
      <FoodDetail
        food={hummus}
        day="2026-01-15"
        meal="lunch"
        onBack={vi.fn()}
        onLogged={vi.fn()}
      />,
    );
    await userEvent.clear(screen.getByLabelText("Amount"));
    expect(screen.getByRole("button", { name: "Log" })).toBeDisabled();
  });

  it("credits Open Food Facts with a link to the product", () => {
    render(
      <FoodDetail
        food={hummus}
        day="2026-01-15"
        meal="lunch"
        onBack={vi.fn()}
        onLogged={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "Open Food Facts" })).toHaveAttribute(
      "href",
      "https://world.openfoodfacts.org/product/7290000000017",
    );
  });

  it("offers to copy a database food to my foods", async () => {
    const onCopy = vi.fn();
    render(
      <FoodDetail
        food={hummus}
        day="2026-01-15"
        meal="lunch"
        onBack={vi.fn()}
        onLogged={vi.fn()}
        onCopyToMine={onCopy}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Copy to my foods/ }));
    expect(onCopy).toHaveBeenCalledWith(hummus);
  });

  it("starts from the amount logged last time", () => {
    render(
      <FoodDetail
        food={hummus}
        day="2026-01-15"
        meal="lunch"
        initial={{ grams: 90, serving_label: "2 tbsp", serving_count: 3 }}
        onBack={vi.fn()}
        onLogged={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Amount")).toHaveValue("3");
    expect(screen.getByText("90 g")).toBeInTheDocument();
  });

  it("falls back to grams when last time's serving is gone", () => {
    render(
      <FoodDetail
        food={hummus}
        day="2026-01-15"
        meal="lunch"
        initial={{ grams: 150, serving_label: "1 bowl", serving_count: 1 }}
        onBack={vi.fn()}
        onLogged={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Serving")).toHaveDisplayValue("100 g");
    expect(screen.getByLabelText("Amount")).toHaveValue("1.5");
  });

  it("toggles the favourite star", async () => {
    favourites.mockReturnValue({ data: [hummus] });
    render(
      <FoodDetail
        food={hummus}
        day="2026-01-15"
        meal="lunch"
        onBack={vi.fn()}
        onLogged={vi.fn()}
      />,
    );
    const star = screen.getByRole("button", { name: "Remove from favourites" });
    expect(star).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(star);
    expect(setFavourite).toHaveBeenCalledWith({ foodId: "f1", favourite: false });
  });
});
