import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

const save = vi.fn().mockResolvedValue({});
vi.mock("../lib/queries", () => ({
  useRecipes: () => ({ isPending: false, isError: false, data: [] }),
  useSaveRecipe: () => ({ mutateAsync: save, isPending: false }),
  useDeleteRecipe: () => ({ mutate: vi.fn() }),
}));
vi.mock("../components/nutrition/IngredientPicker", () => ({
  IngredientPicker: ({ onPick }: { onPick: (f: unknown) => void }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onPick({
            id: "lentils",
            name: "Lentils",
            brand: null,
            nutrients_per_100g: { energy_kcal: 116, protein_g: 9, iron_mg: 3.3 },
          })
        }
      >
        pick lentils
      </button>
      <button
        type="button"
        onClick={() =>
          onPick({
            id: "onion",
            name: "Onion",
            brand: null,
            nutrients_per_100g: { energy_kcal: 40, protein_g: 1.1 },
          })
        }
      >
        pick onion
      </button>
    </div>
  ),
}));

import { RecipeEditor } from "./RecipeEditor";

describe("RecipeEditor", () => {
  it("builds a recipe with a live per-serving preview and saves it", async () => {
    render(
      <MemoryRouter initialEntries={["/nutrition/recipes/new"]}>
        <Routes>
          <Route path="/nutrition/recipes/new" element={<RecipeEditor />} />
          <Route path="/nutrition/recipes" element={<p>recipe list</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Name"), "Lentil soup");
    await userEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    await userEvent.click(screen.getByRole("button", { name: "pick lentils" }));
    const lentils = screen.getByLabelText("Grams of Lentils");
    await userEvent.clear(lentils);
    await userEvent.type(lentils, "400");
    await userEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    await userEvent.click(screen.getByRole("button", { name: "pick onion" }));

    const preview = screen.getByRole("region", { name: "Per serving" });
    expect(within(preview).getByText(/^126 kcal/)).toBeInTheDocument(); // (464 + 40) / 4
    expect(preview).toHaveTextContent("Per serving (125 g)");
    expect(preview).toHaveTextContent("don't report it: Iron");

    await userEvent.type(screen.getByLabelText("Steps (optional)"), "1. Simmer.");
    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(save).toHaveBeenCalledWith({
      id: undefined,
      body: {
        name: "Lentil soup",
        servings: 4,
        cooked_weight_g: null,
        note: null,
        instructions: "1. Simmer.",
        items: [
          { food_id: "lentils", grams: 400 },
          { food_id: "onion", grams: 100 },
        ],
      },
    });
    expect(await screen.findByText("recipe list")).toBeInTheDocument();
  });

  it("needs a name and an ingredient", async () => {
    render(
      <MemoryRouter initialEntries={["/nutrition/recipes/new"]}>
        <Routes>
          <Route path="/nutrition/recipes/new" element={<RecipeEditor />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give the recipe a name.");
    await userEvent.type(screen.getByLabelText("Name"), "Soup");
    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add at least one ingredient.");
    expect(save).not.toHaveBeenCalled();
  });
});
