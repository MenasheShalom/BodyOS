import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { addDays, isoDay } from "../lib/meals";

const { foodDays } = vi.hoisted(() => ({ foodDays: vi.fn() }));

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
  useFoodDays: (from: string, to: string) => foodDays(from, to),
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

  it("lists the last 30 days of food, linking to each day", async () => {
    const today = isoDay(new Date());
    foodDays.mockReturnValue({
      isPending: false,
      isError: false,
      data: [
        { day: today, energy_kcal: 2104.6, protein_g: 162, entries: 5, excluded: false },
        { day: addDays(today, -1), energy_kcal: 950, protein_g: 40, entries: 1, excluded: true },
      ],
    });
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Food" }));
    expect(foodDays).toHaveBeenLastCalledWith(addDays(today, -29), today);
    const todayRow = screen.getByRole("link", { name: /Today/ });
    expect(todayRow).toHaveAttribute("href", `/food?day=${today}`);
    expect(todayRow).toHaveTextContent("5 entries");
    expect(todayRow).toHaveTextContent("2,105 kcal");
    expect(screen.getByRole("link", { name: /Yesterday/ })).toHaveTextContent(
      "1 entry · marked incomplete",
    );
  });
});
