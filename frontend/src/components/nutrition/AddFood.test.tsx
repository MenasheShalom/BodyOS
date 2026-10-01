import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import type { Food, FoodSearch } from "../../lib/types";

const food = (over: Partial<Food>): Food => ({
  id: null,
  source: "off",
  source_ref: "7290000000017",
  barcode: "7290000000017",
  name: "Demo hummus",
  brand: null,
  nutrients_per_100g: { energy_kcal: 270 },
  servings: [],
  is_liquid: false,
  is_own: false,
  ...over,
});
const shake = food({ id: "mine", source: "custom", name: "Hummus shake", is_own: true });
const results: Record<string, FoodSearch> = {
  local: { local: [shake], external: [], sources_failed: [] },
  external: { local: [shake], external: [food({})], sources_failed: ["usda"] },
};

const search = vi.fn();
const importFood = vi.fn();
const lookUp = vi.fn();
const logFood = vi.fn().mockResolvedValue({});
const logMeal = vi.fn().mockResolvedValue([]);
const recent = vi.fn();
const favourites = vi.fn();
const savedMeals = vi.fn();
vi.mock("../../lib/queries", () => ({
  useFoodSearch: (q: string, external: boolean, enabled = true) => search(q, external, enabled),
  useImportFood: () => ({ mutateAsync: importFood }),
  useBarcodeLookup: () => ({ mutateAsync: lookUp, isPending: false }),
  useLogFood: () => ({ mutateAsync: logFood }),
  useQuickAdd: () => ({ mutateAsync: vi.fn() }),
  useLogSavedMeal: () => ({ mutateAsync: logMeal, isPending: false }),
  useRecentFoods: () => recent(),
  useFavourites: () => favourites(),
  useSavedMeals: () => savedMeals(),
  useSetFavourite: () => ({ mutate: vi.fn() }),
}));
vi.mock("./BarcodeScanner", () => ({
  BarcodeScanner: ({ onCode }: { onCode: (code: string) => void }) => (
    <button type="button" onClick={() => onCode("1111111111111")}>
      fake scan
    </button>
  ),
}));

import { AddFood } from "./AddFood";

describe("AddFood", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    search.mockImplementation((q: string, external: boolean, enabled: boolean) => {
      if (!enabled || q.trim().length < 3) return { data: undefined, isError: false };
      return { data: external ? results.external : results.local, isError: false };
    });
    importFood.mockResolvedValue(food({ id: "imported", name: "Demo hummus" }));
    recent.mockReturnValue({ data: [] });
    favourites.mockReturnValue({ data: [] });
    savedMeals.mockReturnValue({ data: [] });
  });
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCreateFood = vi.fn();
    const onDone = vi.fn();
    render(<AddFood day="2026-01-15" meal="lunch" onDone={onDone} onCreateFood={onCreateFood} />);
    return { user, onCreateFood, onDone };
  };
  const typeQuery = async (text: string) => {
    const s = setup();
    await s.user.type(screen.getByRole("searchbox", { name: "Search foods" }), text);
    return s;
  };

  it("shows my foods at once and the database only after a pause", async () => {
    await typeQuery("hum");
    expect(screen.getByRole("region", { name: "My foods" })).toHaveTextContent("Hummus shake");
    expect(screen.getByRole("status")).toHaveTextContent("Searching Open Food Facts and USDA");
    expect(search).not.toHaveBeenCalledWith("hum", true, true);
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(screen.getByRole("region", { name: "Database" })).toHaveTextContent("Demo hummus");
  });

  it("searches the database right away on Enter and names failed sources", async () => {
    const { user } = await typeQuery("hum");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Database" })).toHaveTextContent("Demo hummus");
    expect(screen.getByText(/USDA didn't respond/)).toBeInTheDocument();
  });

  it("imports a database result before showing its detail", async () => {
    const { user } = await typeQuery("hum");
    await user.keyboard("{Enter}");
    await user.click(screen.getByText("Demo hummus"));
    expect(importFood).toHaveBeenCalledWith(
      expect.objectContaining({ source_ref: "7290000000017" }),
    );
    expect(await screen.findByRole("button", { name: "Log" })).toBeInTheDocument();
  });

  it("asks for three letters", async () => {
    await typeQuery("hu");
    expect(screen.getByText("Type at least 3 letters.")).toBeInTheDocument();
  });

  it("switches to quick add", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    expect(screen.getByLabelText("Calories")).toBeInTheDocument();
  });

  it("shows recent, favourites and saved meals before typing, and re-logs in one tap", async () => {
    const oats = food({ id: "oats", source: "custom", name: "Oats", is_own: true });
    recent.mockReturnValue({
      data: [
        {
          food: oats,
          grams: 60,
          serving_label: "100 g",
          serving_count: 0.6,
          last_eaten_at: "2026-01-14T07:00:00Z",
        },
      ],
    });
    favourites.mockReturnValue({ data: [shake] });
    savedMeals.mockReturnValue({
      data: [{ id: "m1", name: "Usual breakfast", items: [], totals: { energy_kcal: 420 } }],
    });
    const { user } = setup();
    expect(screen.getByRole("region", { name: "Recent" })).toHaveTextContent("Oats60 g");
    expect(screen.getByRole("region", { name: "Favourites" })).toHaveTextContent("Hummus shake");
    expect(screen.getByRole("region", { name: "Saved meals" })).toHaveTextContent("420 kcal");
    await user.click(screen.getByRole("button", { name: "Log Oats again" }));
    expect(logFood).toHaveBeenCalledWith({
      food_id: "oats",
      grams: 60,
      serving_label: "100 g",
      serving_count: 0.6,
      meal: "lunch",
      eaten_at: new Date(2026, 0, 15, 13, 0).toISOString(),
    });
    expect(screen.getByRole("button", { name: "Log Oats again" })).toBeDisabled();
  });

  it("logs a saved meal after showing what's in it", async () => {
    savedMeals.mockReturnValue({
      data: [
        {
          id: "m1",
          name: "Usual breakfast",
          items: [
            {
              food_id: "oats",
              name: "Oats",
              grams: 60,
              serving_label: null,
              serving_count: null,
              nutrients: { energy_kcal: 228 },
            },
          ],
          totals: { energy_kcal: 228 },
        },
      ],
    });
    const { user, onDone } = setup();
    await user.click(screen.getByText("Usual breakfast"));
    await user.click(screen.getByRole("button", { name: /Log all 1/ }));
    expect(logMeal).toHaveBeenCalledWith({
      id: "m1",
      meal: "lunch",
      eaten_at: new Date(2026, 0, 15, 13, 0).toISOString(),
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("opens a scanned food", async () => {
    lookUp.mockResolvedValueOnce(food({ id: "scanned", name: "Scanned snack" }));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Scan barcode" }));
    await user.click(screen.getByRole("button", { name: "fake scan" }));
    expect(lookUp).toHaveBeenCalledWith("1111111111111");
    expect(await screen.findByText("Scanned snack")).toBeInTheDocument();
  });

  it("offers to create an unknown barcode", async () => {
    lookUp.mockRejectedValueOnce(new ApiError(404, "Not found"));
    const { user, onCreateFood } = setup();
    await user.click(screen.getByRole("button", { name: "Scan barcode" }));
    await user.click(screen.getByRole("button", { name: "fake scan" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No food found for barcode 1111111111111");
    await user.click(within(alert).getByRole("button", { name: "Create it" }));
    expect(onCreateFood).toHaveBeenCalledWith({ barcode: "1111111111111" });
  });

  it("explains when the database is down during a scan", async () => {
    lookUp.mockRejectedValueOnce(new ApiError(503, "Food database unavailable. Please try again."));
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Scan barcode" }));
    await user.click(screen.getByRole("button", { name: "fake scan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Food database unavailable");
  });
});
