import { describe, expect, it } from "vitest";
import { recipePreview } from "./recipes";

describe("recipePreview", () => {
  it("divides totals by servings and flags nutrients some ingredients lack", () => {
    const p = recipePreview(
      [
        { grams: 400, per100: { energy_kcal: 116, protein_g: 9, iron_mg: 3.3 } },
        { grams: 100, per100: { energy_kcal: 40, protein_g: 1.1 } },
      ],
      4,
    );
    expect(p.perServing.energy_kcal).toBe(126);
    expect(p.perServing.protein_g).toBeCloseTo(9.275);
    expect(p.perServing.iron_mg).toBeUndefined();
    expect(p.incomplete).toEqual(["iron_mg"]);
    expect(p.totalGrams).toBe(500);
  });
});
