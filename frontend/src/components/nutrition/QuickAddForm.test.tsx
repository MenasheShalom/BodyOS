import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const quickAdd = vi.fn().mockResolvedValue({});
vi.mock("../../lib/queries", () => ({ useQuickAdd: () => ({ mutateAsync: quickAdd }) }));

import { QuickAddForm } from "./QuickAddForm";

describe("QuickAddForm", () => {
  it("requires calories", async () => {
    render(<QuickAddForm day="2026-01-15" meal="dinner" onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter calories");
    expect(quickAdd).not.toHaveBeenCalled();
  });

  it("sends only the macros that were filled", async () => {
    const onDone = vi.fn();
    render(<QuickAddForm day="2026-01-15" meal="dinner" onDone={onDone} />);
    await userEvent.type(screen.getByLabelText("Calories"), "450");
    await userEvent.type(screen.getByLabelText("Protein"), "30,5");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(quickAdd).toHaveBeenCalledWith({
      nutrients: { energy_kcal: 450, protein_g: 30.5 },
      meal: "dinner",
      eaten_at: new Date(2026, 0, 15, 19, 0).toISOString(),
    });
    expect(onDone).toHaveBeenCalled();
  });
});
