import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isoDay } from "../lib/meals";

const useFoodDay = vi.fn();
const useNutritionSettings = vi.fn();
const open = vi.fn();
vi.mock("../lib/queries", () => ({
  useFoodDay: (day: string) => useFoodDay(day),
  useNutritionSettings: () => useNutritionSettings(),
  useUpdateLogEntry: () => ({ mutateAsync: vi.fn() }),
  useDeleteLogEntry: () => ({ mutate: vi.fn() }),
}));
vi.mock("../components/AppLayout", () => ({ useLogSheet: () => ({ open }) }));

import { Food } from "./Food";

const today = isoDay(new Date());
const emptyDay = (day: string) => ({
  isPending: false,
  isError: false,
  data: { day, entries: [], totals: {}, coverage: {}, target: null },
});
const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Food />
    </MemoryRouter>,
  );

describe("Food", () => {
  beforeEach(() => {
    useFoodDay.mockImplementation(emptyDay);
    useNutritionSettings.mockReturnValue({ data: { configured: true } });
  });

  it("shows today with next disabled", () => {
    renderAt("/food");
    expect(useFoodDay).toHaveBeenCalledWith(today);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    expect(screen.getAllByText("Nothing logged")).toHaveLength(4);
  });

  it("takes the day from the URL and moves between days", async () => {
    renderAt("/food?day=2026-01-15");
    expect(useFoodDay).toHaveBeenLastCalledWith("2026-01-15");
    await userEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(useFoodDay).toHaveBeenLastCalledWith("2026-01-14");
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(useFoodDay).toHaveBeenLastCalledWith("2026-01-15");
  });

  it("ignores future or malformed days", () => {
    renderAt("/food?day=2999-01-01");
    expect(useFoodDay).toHaveBeenLastCalledWith(today);
  });

  it("opens the log sheet on the right meal and day", async () => {
    renderAt("/food?day=2026-01-15");
    await userEvent.click(screen.getByRole("button", { name: "Add to Dinner" }));
    expect(open).toHaveBeenCalledWith("food", { day: "2026-01-15", meal: "dinner" });
  });

  it("offers setup when nutrition isn't configured", () => {
    useNutritionSettings.mockReturnValue({ data: { configured: false } });
    renderAt("/food");
    expect(screen.getByRole("link", { name: /Set up nutrition targets/ })).toHaveAttribute(
      "href",
      "/nutrition/setup",
    );
  });
});
