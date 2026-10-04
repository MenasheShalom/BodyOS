import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

const { list } = vi.hoisted(() => ({
  list: { useList: () => ({ data: [] }), useCreate: () => ({ mutateAsync: () => {} }) },
}));
vi.mock("../lib/queries", () => ({
  useNavyPreview: () => ({ data: undefined }),
  useProfile: () => ({ data: undefined }),
  bodyEntries: list,
  measurements: list,
  usePhotos: () => ({ data: [] }),
}));
vi.mock("../lib/photos", () => ({ latestByPose: () => ({}), useUploadPhoto: () => ({}) }));
vi.mock("./nutrition/AddFood", () => ({
  AddFood: ({ day, meal }: { day: string; meal: string }) => (
    <p>
      add food to {meal} on {day}
    </p>
  ),
}));

import { LogSheet } from "./LogSheet";

describe("LogSheet", () => {
  it("adding to a meal shows only food, without the tab bar", () => {
    render(
      <MemoryRouter>
        <LogSheet
          initialTab="food"
          food={{ day: "2026-01-15", meal: "dinner" }}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("dialog", { name: "Add to Dinner" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add to Dinner" })).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByText("add food to dinner on 2026-01-15")).toBeInTheDocument();
  });

  it("the main Log button still offers every kind of entry", () => {
    render(
      <MemoryRouter>
        <LogSheet initialTab="weigh-in" onClose={vi.fn()} />
      </MemoryRouter>,
    );
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Food", "Weigh-in", "Measurements", "Photo"]);
    expect(screen.getByRole("tab", { name: "Weigh-in" })).toHaveAttribute("aria-selected", "true");
  });
});
