import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const copy = vi.fn();
const saveMeal = vi.fn().mockResolvedValue({});
vi.mock("../../lib/queries", () => ({
  useCopyEntries: () => ({ mutateAsync: copy, isPending: false }),
  useSaveMealFromLog: () => ({ mutateAsync: saveMeal, isPending: false }),
}));

import { CopyDialog, SaveMealDialog } from "./MealDialogs";

describe("CopyDialog", () => {
  it("copies yesterday's same meal into this one by default", async () => {
    copy.mockResolvedValueOnce([{ id: "e1" }]);
    const onClose = vi.fn();
    render(<CopyDialog day="2026-01-15" meal="breakfast" onClose={onClose} />);
    expect(screen.getByLabelText("From")).toHaveValue("2026-01-14");
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(copy).toHaveBeenCalledWith({
      from_day: "2026-01-14",
      to_day: "2026-01-15",
      meal: "breakfast",
      to_meal: "breakfast",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("copies a whole day and says when there was nothing", async () => {
    copy.mockResolvedValueOnce([]);
    const onClose = vi.fn();
    render(<CopyDialog day="2026-01-15" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(copy).toHaveBeenLastCalledWith({ from_day: "2026-01-14", to_day: "2026-01-15" });
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was logged then.");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SaveMealDialog", () => {
  it("saves the meal under a name", async () => {
    const onClose = vi.fn();
    render(<SaveMealDialog day="2026-01-15" meal="lunch" onClose={onClose} />);
    const name = screen.getByLabelText("Name");
    expect(name).toHaveValue("Lunch");
    await userEvent.clear(name);
    await userEvent.type(name, "Office lunch");
    await userEvent.click(screen.getByRole("button", { name: "Save meal" }));
    expect(saveMeal).toHaveBeenCalledWith({
      name: "Office lunch",
      day: "2026-01-15",
      meal: "lunch",
    });
    expect(onClose).toHaveBeenCalled();
  });
});
