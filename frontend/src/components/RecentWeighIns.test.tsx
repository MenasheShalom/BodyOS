import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn().mockResolvedValue({});
const remove = vi.fn().mockResolvedValue(undefined);
const entry = (id: string, day: number, weight: number, fat: number | null = null) => ({
  id,
  measured_at: new Date(2026, 8, day, 7, 0).toISOString(),
  weight_kg: weight,
  body_fat_pct: fat,
  muscle_mass_kg: null,
  note: null,
});
const entries = [
  entry("e6", 30, 74, 22.8),
  entry("e5", 29, 74.2),
  entry("e4", 28, 74.4),
  entry("e3", 27, 74.1),
  entry("e2", 26, 74.6),
  entry("e1", 25, 75),
];
vi.mock("../lib/queries", () => ({
  useProfile: () => ({ data: { hidden_metrics: [] } }),
  bodyEntries: {
    useList: () => ({ data: entries, isPending: false }),
    useUpdate: () => ({ mutateAsync: update }),
    useDelete: () => ({ mutateAsync: remove }),
  },
}));

import { RecentWeighIns } from "./RecentWeighIns";

const renderIt = () =>
  render(
    <MemoryRouter>
      <RecentWeighIns />
    </MemoryRouter>,
  );

describe("RecentWeighIns", () => {
  beforeEach(() => {
    update.mockClear();
    remove.mockClear();
  });

  it("lists the five most recent weigh-ins with a link to the full history", () => {
    renderIt();
    expect(screen.getAllByRole("button", { name: /Edit weigh-in from/ })).toHaveLength(5);
    expect(screen.getByText("74.0 kg")).toBeInTheDocument();
    expect(screen.getByText("22.8% fat")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/history");
  });

  it("edits a weigh-in when tapped", async () => {
    renderIt();
    await userEvent.click(screen.getAllByRole("button", { name: /Edit weigh-in from/ })[0]);
    const weight = screen.getByLabelText("Weight");
    await userEvent.clear(weight);
    await userEvent.type(weight, "73.8");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(update).toHaveBeenCalledWith({
      id: "e6",
      body: expect.objectContaining({ weight_kg: 73.8, body_fat_pct: 22.8 }),
    });
  });

  it("deletes a weigh-in after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderIt();
    await userEvent.click(screen.getAllByRole("button", { name: /Edit weigh-in from/ })[1]);
    await userEvent.click(screen.getByRole("button", { name: "Delete weigh-in" }));
    expect(remove).toHaveBeenCalledWith("e5");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
