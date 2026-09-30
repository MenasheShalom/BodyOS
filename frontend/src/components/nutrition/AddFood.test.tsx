import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../../lib/queries", () => ({
  useFoodSearch: (q: string, external: boolean, enabled = true) => search(q, external, enabled),
  useImportFood: () => ({ mutateAsync: importFood }),
  useLogFood: () => ({ mutateAsync: vi.fn() }),
  useQuickAdd: () => ({ mutateAsync: vi.fn() }),
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
  });
  afterEach(() => vi.useRealTimers());

  const typeQuery = async (text: string) => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddFood day="2026-01-15" meal="lunch" onDone={vi.fn()} />);
    await user.type(screen.getByRole("searchbox", { name: "Search foods" }), text);
    return user;
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
    const user = await typeQuery("hum");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Database" })).toHaveTextContent("Demo hummus");
    expect(screen.getByText(/USDA didn't respond/)).toBeInTheDocument();
  });

  it("imports a database result before showing its detail", async () => {
    const user = await typeQuery("hum");
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
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<AddFood day="2026-01-15" meal="lunch" onDone={vi.fn()} />);
    await user.click(screen.getByRole("tab", { name: "Quick add" }));
    expect(screen.getByLabelText("Calories")).toBeInTheDocument();
  });
});
