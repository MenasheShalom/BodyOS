import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FoodLogEntry } from "../../lib/types";

const update = vi.fn().mockResolvedValue({});
const remove = vi.fn();
vi.mock("../../lib/queries", () => ({
  useUpdateLogEntry: () => ({ mutateAsync: update, isPending: false }),
  useDeleteLogEntry: () => ({ mutate: remove }),
}));

import { EntrySheet } from "./EntrySheet";

const base: FoodLogEntry = {
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
};

describe("EntrySheet", () => {
  it("changing the serving count sends grams = count × serving grams", async () => {
    const onClose = vi.fn();
    render(<EntrySheet entry={base} onClose={onClose} />);
    const count = screen.getByLabelText("Servings (2 tbsp)");
    await userEvent.clear(count);
    await userEvent.type(count, "3");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(update).toHaveBeenCalledWith({
      id: "e1",
      body: expect.objectContaining({ serving_count: 3, grams: 90, meal: "lunch" }),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("edits a quick add's numbers", async () => {
    update.mockClear();
    const quick = { ...base, food_id: null, grams: null, serving_label: null, serving_count: null };
    render(<EntrySheet entry={{ ...quick, name: "Quick add" }} onClose={vi.fn()} />);
    const kcal = screen.getByLabelText("Calories");
    await userEvent.clear(kcal);
    await userEvent.type(kcal, "500");
    await userEvent.type(screen.getByLabelText("Protein"), "30");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const body = update.mock.calls[0][0].body;
    expect(body.nutrients).toEqual({ energy_kcal: 500, protein_g: 30 });
    expect(body.grams).toBeUndefined();
  });

  it("asks before deleting", async () => {
    render(<EntrySheet entry={base} onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(remove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    expect(remove).toHaveBeenCalledWith("e1", expect.anything());
  });
});
