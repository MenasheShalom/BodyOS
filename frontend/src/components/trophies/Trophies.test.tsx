import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Achievement } from "../../lib/types";

const trophy = (key: string, extra: Partial<Achievement> = {}): Achievement => ({
  key,
  category: "consistency",
  tier: "bronze",
  title: key,
  description: `About ${key}`,
  target: 7,
  unit: "days",
  progress: 7,
  earned_on: "2026-01-10",
  new: false,
  ...extra,
});

const mocks = vi.hoisted(() => ({ data: vi.fn(), markSeen: vi.fn() }));
vi.mock("../../lib/queries", () => ({
  useAchievements: () => ({ data: mocks.data(), isPending: false, isError: false }),
  useMarkAchievementsSeen: () => ({ mutate: mocks.markSeen }),
}));

import { Trophies } from "../../pages/Trophies";
import { TrophyCelebration } from "./TrophyCelebration";
import { setCelebrations } from "./trophyMeta";

function app(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TrophyCelebration />
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="/trophies" element={<Trophies />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.data.mockReturnValue([]);
});

describe("TrophyCelebration", () => {
  it("shows nothing when there's nothing new", () => {
    mocks.data.mockReturnValue([trophy("a")]);
    app();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("celebrates new trophies one at a time, gold first", async () => {
    let data = [
      trophy("Week on the scale", { new: true }),
      trophy("Ten down", { new: true, tier: "gold", category: "body" }),
    ];
    mocks.data.mockImplementation(() => data);
    mocks.markSeen.mockImplementation((keys: string[]) => {
      data = data.map((a) => (keys.includes(a.key) ? { ...a, new: false } : a));
    });
    const { rerender } = app();
    const card = screen.getByRole("dialog", { name: "Trophy earned" });
    expect(card).toHaveTextContent("Trophy earned · 1 of 2");
    expect(within(card).getByRole("heading")).toHaveTextContent("Ten down");
    expect(card).toHaveTextContent("Gold · Earned 10 Jan 2026");

    await userEvent.click(within(card).getByRole("button", { name: "Next" }));
    expect(mocks.markSeen).toHaveBeenLastCalledWith(["Ten down"]);
    rerender(
      <MemoryRouter>
        <TrophyCelebration />
      </MemoryRouter>,
    );
    const second = screen.getByRole("dialog", { name: "Trophy earned" });
    expect(within(second).getByRole("heading")).toHaveTextContent("Week on the scale");
    await userEvent.click(within(second).getByRole("button", { name: "Nice!" }));
    expect(mocks.markSeen).toHaveBeenLastCalledWith(["Week on the scale"]);
  });

  it("sums up a big batch (the first backfill) in one card", async () => {
    mocks.data.mockReturnValue(
      ["a", "b", "c", "d", "e"].map((k, i) =>
        trophy(k, { new: true, tier: i === 0 ? "gold" : "bronze" }),
      ),
    );
    app();
    const card = screen.getByRole("dialog", { name: "Trophies earned" });
    expect(card).toHaveTextContent("5");
    expect(card).toHaveTextContent("including 1 gold");
    expect(within(card).getAllByRole("listitem")).toHaveLength(5);
    await userEvent.click(within(card).getByRole("button", { name: "Later" }));
    expect(mocks.markSeen).toHaveBeenCalledWith(["a", "b", "c", "d", "e"]);
  });

  it("goes to the trophies page, which marks them seen", async () => {
    mocks.data.mockReturnValue([trophy("First step", { new: true, category: "habits" })]);
    app();
    await userEvent.click(screen.getByRole("button", { name: "See all trophies" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trophies" })).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(mocks.markSeen).toHaveBeenCalledWith(["First step"]);
  });

  it("can be switched off", () => {
    setCelebrations(false);
    mocks.data.mockReturnValue([trophy("a", { new: true })]);
    app();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.markSeen).not.toHaveBeenCalled();
  });
});

describe("Trophies page", () => {
  it("groups trophies and shows progress for locked ones", () => {
    mocks.data.mockReturnValue([
      trophy("Week on the scale"),
      trophy("Month on the scale", { earned_on: null, progress: 12, target: 30, tier: "silver" }),
      trophy("First kilo", { category: "body", earned_on: null, progress: 0.4, target: 1, unit: "kg" }),
      trophy("Five down", {
        category: "body",
        tier: "gold",
        earned_on: null,
        progress: 2.5,
        target: 5,
        unit: "kg",
      }),
    ]);
    app("/trophies");
    expect(screen.getByText(/1 of 4 earned/)).toHaveTextContent("1 of 4 earned · 1 bronze");
    const consistency = screen.getByRole("region", { name: "Consistency" });
    expect(within(consistency).getAllByRole("listitem")[0]).toHaveTextContent("Week on the scale");
    const bar = within(consistency).getByRole("progressbar", { name: "Month on the scale progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "12");
    expect(consistency).toHaveTextContent("12 / 30 days");
    const body = screen.getByRole("region", { name: "Body" });
    // closest first; a one-step target has no bar
    expect(within(body).getAllByRole("listitem")[0]).toHaveTextContent("Five down");
    expect(within(body).getByText("2.5 / 5 kg")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Goals" })).not.toBeInTheDocument();
    expect(mocks.markSeen).not.toHaveBeenCalled();
  });
});
