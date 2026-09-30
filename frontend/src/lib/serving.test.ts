import { describe, expect, it } from "vitest";
import { amountLabel, choiceGrams, gramsFor, nutrientsFor, servingsFor } from "./serving";

const food = {
  is_liquid: false,
  servings: [{ label: "2 tbsp", grams: 30 }],
  nutrients_per_100g: { energy_kcal: 270, protein_g: 7 },
};

describe("serving", () => {
  it("puts 100 g first, or 100 ml for liquids", () => {
    expect(servingsFor(food).map((s) => s.label)).toEqual(["100 g", "2 tbsp"]);
    expect(servingsFor({ ...food, is_liquid: true })[0]).toEqual({ label: "100 ml", grams: 100 });
  });

  it("multiplies serving grams by count", () => {
    expect(gramsFor({ label: "1 slice", grams: 28 }, 2.5)).toBe(70);
    expect(gramsFor({ label: "x", grams: 33.33 }, 3)).toBe(100);
  });

  it("scales only the nutrients the food reports", () => {
    expect(nutrientsFor(food, 60)).toEqual({ energy_kcal: 162, protein_g: 4.2 });
  });

  it("labels amounts", () => {
    expect(amountLabel({ grams: 60, serving_label: "2 tbsp", serving_count: 2 })).toBe(
      "2 × 2 tbsp",
    );
    expect(amountLabel({ grams: 30, serving_label: "2 tbsp", serving_count: 1 })).toBe("2 tbsp");
    expect(amountLabel({ grams: 150, serving_label: "100 g", serving_count: 1.5 })).toBe("150 g");
    expect(amountLabel({ grams: 250, serving_label: null, serving_count: null }, "ml")).toBe(
      "250 ml",
    );
    expect(amountLabel({ grams: null, serving_label: null, serving_count: null })).toBe("");
  });
});

describe("choiceGrams", () => {
  const servings = [
    { label: "100 g", grams: 100 },
    { label: "1 slice", grams: 28 },
  ];
  it("multiplies the chosen serving by a count typed with a comma", () => {
    expect(choiceGrams(servings, { index: 1, count: "1,5" })).toBe(42);
  });
  it("rejects empty, zero or huge counts", () => {
    expect(choiceGrams(servings, { index: 1, count: "" })).toBeNull();
    expect(choiceGrams(servings, { index: 1, count: "0" })).toBeNull();
    expect(choiceGrams(servings, { index: 1, count: "101" })).toBeNull();
  });
});
