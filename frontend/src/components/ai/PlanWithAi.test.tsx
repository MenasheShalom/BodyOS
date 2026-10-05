import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import type { Food, MealPlan, RecipeIdeas } from "../../lib/types";

const food = (id: string, name: string, per100: Food["nutrients_per_100g"]) => ({
  id,
  source: "usda" as const,
  source_ref: id,
  barcode: null,
  name,
  brand: null,
  nutrients_per_100g: per100,
  servings: [],
  is_liquid: false,
  is_own: false,
});
const CHICKEN = food("chicken", "Chicken breast, roasted", {
  energy_kcal: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
});
const RICE = food("rice", "Rice, white, cooked", {
  energy_kcal: 130,
  protein_g: 2.7,
  carbs_g: 28,
  fat_g: 0.3,
});

const PLAN: MealPlan = {
  targets: { energy_kcal: 2000, protein_g: 160, carbs_g: 180, fat_g: 70 },
  rest_of_today: false,
  meals: [
    {
      meal: "lunch",
      title: "Chicken and rice",
      ingredients: [
        { name: "Chicken", search_query: "chicken", grams: 200, food: CHICKEN, nutrients: {} },
        { name: "Rice", search_query: "rice cooked", grams: 150, food: RICE, nutrients: {} },
        { name: "Zaatar", search_query: "zaatar", grams: 5, food: null, nutrients: {} },
      ],
      totals: {},
    },
  ],
  totals: {},
  unresolved: 1,
  notes: "Add a vegetable side.",
};

const IDEAS: RecipeIdeas = {
  recipes: [
    {
      name: "Chicken rice bowl",
      servings: 2,
      minutes: 20,
      ingredients: [
        { name: "Chicken", search_query: "chicken", grams: 300, food: CHICKEN, nutrients: {} },
        { name: "Sumac", search_query: "sumac", grams: 3, food: null, nutrients: {} },
      ],
      steps: ["Cook the chicken.", "Serve on rice."],
      totals: {},
      per_serving: {},
    },
  ],
  unresolved: 1,
  notes: "",
};

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  ideas: vi.fn(),
  logBatch: vi.fn(),
  saveMeal: vi.fn(),
  saveRecipe: vi.fn(),
  settings: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../../lib/queries", () => ({
  useMealPlan: () => ({ mutateAsync: mocks.plan, isPending: false }),
  useRecipeIdeas: () => ({ mutateAsync: mocks.ideas, isPending: false }),
  useLogBatch: () => ({ mutateAsync: mocks.logBatch, isPending: false }),
  useCreateSavedMeal: () => ({ mutateAsync: mocks.saveMeal, isPending: false }),
  useSaveRecipe: () => ({ mutateAsync: mocks.saveRecipe, isPending: false }),
  useAiSettings: () => mocks.settings(),
  useSaveAiSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAiStatus: () => mocks.status(),
}));
vi.mock("../nutrition/IngredientPicker", () => ({
  IngredientPicker: ({
    initialQuery,
    onPick,
  }: {
    initialQuery: string;
    onPick: (f: unknown) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onPick(food("zaatar", "Za'atar", { energy_kcal: 300, protein_g: 10, carbs_g: 40, fat_g: 10 }))
      }
    >
      pick for {initialQuery}
    </button>
  ),
}));

import { PlanWithAi } from "../../pages/PlanWithAi";
import { instructionsFrom, planRowNutrients, rowsFrom, sumMacros } from "./planItems";

const ACKED = { enabled: true, acknowledged: ["meal_plan", "recipe_from_groceries"] };

function renderPage() {
  return render(
    <MemoryRouter>
      <PlanWithAi />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockReturnValue({ isPending: false, data: { enabled: true, configured: true } });
  mocks.settings.mockReturnValue({ data: { ...ACKED, plan_preferences: "kosher" } });
  mocks.plan.mockResolvedValue(PLAN);
  mocks.ideas.mockResolvedValue(IDEAS);
  mocks.logBatch.mockResolvedValue([]);
  mocks.saveMeal.mockResolvedValue({ id: "m1" });
  mocks.saveRecipe.mockResolvedValue({ id: "r1" });
});

describe("planItems", () => {
  it("counts only ingredients with a food", () => {
    const rows = rowsFrom(PLAN.meals[0].ingredients, "x");
    expect(planRowNutrients(rows[0])).toEqual({
      energy_kcal: 330,
      protein_g: 62,
      carbs_g: 0,
      fat_g: 7.2,
    });
    expect(planRowNutrients(rows[2])).toEqual({});
    expect(sumMacros(rows.map(planRowNutrients)).energy_kcal).toBe(330 + 195);
    expect(instructionsFrom(["Cook.", "Eat."])).toBe("1. Cook.\n2. Eat.");
  });
});

describe("PlanWithAi", () => {
  it("explains when AI is switched off", () => {
    mocks.status.mockReturnValue({ isPending: false, data: { enabled: false, configured: true } });
    renderPage();
    expect(screen.getByText(/AI features are switched off/)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("asks before sending anything the first time", () => {
    mocks.settings.mockReturnValue({ data: { enabled: true, acknowledged: [] } });
    renderPage();
    expect(
      screen.getByText(/your calorie and macro targets and the preferences you type/),
    ).toBeInTheDocument();
  });

  it("plans meals with remembered preferences, then logs and saves a meal", async () => {
    renderPage();
    expect(screen.getByRole("textbox")).toHaveValue("kosher");
    await userEvent.click(screen.getByRole("radio", { name: "The rest of today" }));
    await userEvent.selectOptions(screen.getByRole("combobox"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Plan my meals" }));
    expect(mocks.plan).toHaveBeenCalledWith({
      meals: 2,
      rest_of_today: true,
      preferences: "kosher",
    });

    const card = screen.getByRole("region", { name: "Chicken and rice" });
    expect(within(card).getByText("525 kcal · P 66 · C 42 · F 8")).toBeInTheDocument();
    expect(within(card).getByText(/No food found; not counted/)).toBeInTheDocument();
    expect(within(card).getByText(/1 ingredient has no food/)).toBeInTheDocument();
    const vsTargets = screen.getByLabelText("Plan against targets");
    expect(vsTargets).toHaveTextContent("Calories525 / 2,000");
    expect(vsTargets).toHaveTextContent("Protein66 / 160 g");
    expect(screen.getByText("Add a vegetable side.")).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "Log this meal" }));
    const entries = mocks.logBatch.mock.calls[0][0];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: "food",
      food_id: "chicken",
      grams: 200,
      meal: "lunch",
      origin: "ai_plan",
    });
    expect(within(card).getByRole("button", { name: /Logged to Lunch/ })).toBeDisabled();

    await userEvent.click(within(card).getByRole("button", { name: "Save meal" }));
    expect(mocks.saveMeal).toHaveBeenCalledWith({
      name: "Chicken and rice",
      items: [
        { food_id: "chicken", grams: 200 },
        { food_id: "rice", grams: 150 },
      ],
    });
  });

  it("lets the user find a food for an unmatched ingredient and change amounts", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Plan my meals" }));
    const card = screen.getByRole("region", { name: "Chicken and rice" });
    await userEvent.click(within(card).getByRole("button", { name: "Find a food" }));
    await userEvent.click(screen.getByRole("button", { name: "pick for zaatar" }));
    expect(within(card).queryByText(/No food found/)).not.toBeInTheDocument();
    const grams = within(card).getByRole("spinbutton", { name: "Grams of Chicken" });
    await userEvent.clear(grams);
    await userEvent.type(grams, "100");
    // 165 + 195 + 15
    expect(within(card).getByText(/^375 kcal/)).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Remove Rice" }));
    expect(within(card).getByText(/^180 kcal/)).toBeInTheDocument();
  });

  it("shows AI errors in words", async () => {
    mocks.plan.mockRejectedValue(new ApiError(409, "Set your nutrition targets first"));
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Plan my meals" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Set your nutrition targets first");
  });

  it("suggests recipes from groceries and saves one with its steps", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "From groceries" }));
    const panel = screen.getAllByRole("tabpanel", { hidden: true })[1];
    await userEvent.type(within(panel).getByRole("textbox", { name: /What do you have/ }), "chicken, sumac");
    await userEvent.type(within(panel).getByRole("textbox", { name: "Servings" }), "2");
    await userEvent.click(within(panel).getByRole("checkbox"));
    await userEvent.click(within(panel).getByRole("button", { name: "Suggest recipes" }));
    expect(mocks.ideas).toHaveBeenCalledWith({
      groceries: "chicken, sumac",
      servings: 2,
      staples: false,
    });
    const card = within(panel).getByRole("region", { name: "Chicken rice bowl" });
    expect(within(card).getByText("Per serving: 248 kcal · P 47 · C 0 · F 5")).toBeInTheDocument();
    expect(within(card).getByText("Serve on rice.")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Save recipe (without 1 unmatched)" }));
    expect(mocks.saveRecipe).toHaveBeenCalledWith({
      body: {
        name: "Chicken rice bowl",
        servings: 2,
        cooked_weight_g: null,
        note: null,
        instructions: "1. Cook the chicken.\n2. Serve on rice.",
        items: [{ food_id: "chicken", grams: 300 }],
      },
    });
    expect(within(card).getByRole("link", { name: "Open recipe" })).toHaveAttribute(
      "href",
      "/nutrition/recipes/r1",
    );
  });

  it("checks servings before asking", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "From groceries" }));
    const panel = screen.getAllByRole("tabpanel", { hidden: true })[1];
    await userEvent.type(within(panel).getByRole("textbox", { name: /What do you have/ }), "eggs");
    await userEvent.type(within(panel).getByRole("textbox", { name: "Servings" }), "20");
    await userEvent.click(within(panel).getByRole("button", { name: "Suggest recipes" }));
    expect(within(panel).getByRole("alert")).toHaveTextContent("whole number from 1 to 12");
    expect(mocks.ideas).not.toHaveBeenCalled();
  });
});
