import { describe, expect, it } from "vitest";
import { NUTRIENTS } from "./nutrients";

describe("nutrient registry", () => {
  it("matches backend/app/nutrients.py (update both together)", () => {
    expect(NUTRIENTS.map((n) => n.key)).toEqual([
      "energy_kcal",
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
      "sugar_g",
      "sat_fat_g",
      "sodium_mg",
      "potassium_mg",
      "calcium_mg",
      "iron_mg",
      "magnesium_mg",
      "zinc_mg",
      "vit_d_mcg",
      "vit_b12_mcg",
      "vit_c_mg",
      "vit_a_mcg",
      "folate_mcg",
    ]);
  });
});
