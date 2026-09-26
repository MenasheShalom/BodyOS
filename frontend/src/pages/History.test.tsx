import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const del = vi.fn();
const update = vi.fn().mockResolvedValue({});
const entry = {
  id: "e1",
  measured_at: "2026-02-28T05:00:00Z",
  weight_kg: 81.5,
  body_fat_pct: 18,
  muscle_mass_kg: null,
  note: null,
};
vi.mock("../lib/queries", () => ({
  useProfile: () => ({ data: { hidden_metrics: [], sex: "male" } }),
  bodyEntries: {
    useList: () => ({ data: [entry], isPending: false }),
    useUpdate: () => ({ mutateAsync: update }),
    useDelete: () => ({ mutate: del }),
  },
  measurements: {
    useList: () => ({ data: [], isPending: false }),
    useUpdate: () => ({ mutateAsync: vi.fn() }),
    useDelete: () => ({ mutate: vi.fn() }),
  },
  useNavyPreview: () => ({ data: undefined }),
}));

import { History } from "./History";

describe("History", () => {
  it("deletes an entry after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<History />);
    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(del).toHaveBeenCalledWith("e1");
  });

  it("edits an entry in a modal", async () => {
    render(<History />);
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    const weight = screen.getByLabelText("Weight");
    await userEvent.clear(weight);
    await userEvent.type(weight, "81");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(update).toHaveBeenCalledWith({
      id: "e1",
      body: expect.objectContaining({ weight_kg: 81 }),
    });
  });
});
