import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isoDay } from "../lib/meals";

const useFoodDay = vi.fn();
const useNutritionSettings = vi.fn();
const open = vi.fn();
const flag = vi.fn();
const useSuggestion = vi.fn();
vi.mock("../lib/queries", () => ({
  useFoodDay: (day: string) => useFoodDay(day),
  useNutritionSettings: () => useNutritionSettings(),
  useSuggestion: () => useSuggestion(),
  useFlagDay: () => ({ mutate: flag, isPending: false }),
  useUpdateLogEntry: () => ({ mutateAsync: vi.fn() }),
  useDeleteLogEntry: () => ({ mutate: vi.fn() }),
}));
vi.mock("../components/AppLayout", () => ({ useLogSheet: () => ({ open }) }));
vi.mock("../components/nutrition/NutrientsTab", () => ({ NutrientsTab: () => <p>nutrients</p> }));
vi.mock("../components/nutrition/CheckInCard", () => ({
  CheckInCard: () => <p>check-in card</p>,
}));

import { Food } from "./Food";

const today = isoDay(new Date());
const emptyDay = (day: string) => ({
  isPending: false,
  isError: false,
  data: { day, entries: [], totals: {}, coverage: {}, target: null, excluded: false },
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
    useSuggestion.mockReturnValue({ data: null });
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

  it("shows the check-in card when one is owed", () => {
    useSuggestion.mockReturnValue({ data: { week_start: "2026-03-01" } });
    renderAt("/food");
    expect(screen.getByText("check-in card")).toBeInTheDocument();
  });

  it("switches to the Nutrients tab", async () => {
    renderAt("/food");
    await userEvent.click(screen.getByRole("tab", { name: "Nutrients" }));
    expect(screen.getByText("nutrients")).toBeInTheDocument();
    expect(screen.queryByText("Nothing logged")).not.toBeInTheDocument();
  });

  it("marks a logged day incomplete and back", async () => {
    const entry = {
      id: "e1",
      eaten_at: "2026-01-15T08:00:00Z",
      meal: "breakfast",
      food_id: null,
      name: "Quick add",
      grams: null,
      serving_label: null,
      serving_count: null,
      nutrients: { energy_kcal: 400 },
      meal_ref: null,
    };
    useFoodDay.mockImplementation((day: string) => ({
      ...emptyDay(day),
      data: { ...emptyDay(day).data, entries: [entry] },
    }));
    const { unmount } = renderAt("/food?day=2026-01-15");
    await userEvent.click(screen.getByRole("button", { name: /Mark day incomplete/ }));
    expect(flag).toHaveBeenCalledWith({ day: "2026-01-15", excluded: true });
    unmount();

    useFoodDay.mockImplementation((day: string) => ({
      ...emptyDay(day),
      data: { ...emptyDay(day).data, entries: [entry], excluded: true },
    }));
    renderAt("/food?day=2026-01-15");
    expect(screen.getByRole("status")).toHaveTextContent("Marked incomplete");
    await userEvent.click(screen.getByRole("button", { name: "Count this day again" }));
    expect(flag).toHaveBeenLastCalledWith({ day: "2026-01-15", excluded: false });
  });
});
