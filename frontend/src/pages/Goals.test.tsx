import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const update = vi.fn().mockResolvedValue({});
const goal = {
  id: "g1",
  metric: "fat_mass_kg",
  start_value: 16,
  target_value: 15,
  start_date: "2026-02-01",
  target_date: null,
  status: "active",
  projection: { current: 15.6, progress_pct: 40, state: "on_track", projected_date: "2026-04-12" },
};
vi.mock("../lib/queries", () => ({
  goals: {
    useList: () => ({ data: [goal], isPending: false, isError: false }),
    useCreate: () => ({ mutateAsync: vi.fn() }),
    useUpdate: () => ({ mutate: vi.fn(), mutateAsync: update }),
    useDelete: () => ({ mutate: vi.fn() }),
  },
}));

import { Goals } from "./Goals";

describe("Goals", () => {
  it("edits the target of an active goal", async () => {
    render(<Goals />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit goal" });
    const target = dialog.querySelector("input[name=target_value]") as HTMLInputElement;
    await userEvent.clear(target);
    await userEvent.type(target, "14");
    await userEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(update).toHaveBeenCalledWith({
      id: "g1",
      body: { target_value: 14, target_date: null },
    });
  });
});
