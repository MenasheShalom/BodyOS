import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Micros } from "../../lib/types";

const useMicros = vi.fn();
vi.mock("../../lib/queries", () => ({ useMicros: (w: number) => useMicros(w) }));

import { NutrientsTab } from "./NutrientsTab";

const data: Micros = {
  window: 7,
  days_counted: 5,
  nutrients: [
    { key: "vit_c_mg", average: 120, reference: 90, kind: "target", coverage: 0.9, status: "ok" },
    { key: "iron_mg", average: 3, reference: 8, kind: "target", coverage: 0.8, status: "low" },
    {
      key: "sodium_mg",
      average: 3000,
      reference: 2300,
      kind: "limit",
      coverage: 0.9,
      status: "over_limit",
    },
    {
      key: "vit_d_mcg",
      average: 0.5,
      reference: 15,
      kind: "target",
      coverage: 0.25,
      status: "not_enough_data",
    },
    {
      key: "sugar_g",
      average: 40,
      reference: null,
      kind: null,
      coverage: 1,
      status: "no_reference",
    },
  ],
};

const row = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

describe("NutrientsTab", () => {
  it("shows averages against references, in words as well as bars", () => {
    useMicros.mockReturnValue({ isPending: false, isError: false, data });
    render(<NutrientsTab />);
    expect(screen.getByText("Daily average over 5 logged days")).toBeInTheDocument();
    expect(row("Vitamin C")).toHaveTextContent("120 mg of 90 mg133%");
    expect(within(row("Iron")).getByText("Low")).toBeInTheDocument();
    expect(row("Sodium")).toHaveTextContent("3,000 mg stay under 2,300 mg");
    expect(within(row("Sodium")).getByText("Over")).toBeInTheDocument();
    expect(within(row("Sugar")).queryByRole("meter")).not.toBeInTheDocument();
  });

  it("never calls a nutrient low when most food doesn't report it", () => {
    useMicros.mockReturnValue({ isPending: false, isError: false, data });
    render(<NutrientsTab />);
    const vitD = row("Vitamin D");
    expect(vitD).toHaveTextContent("Not enough data (25% of your food reports it)");
    expect(within(vitD).queryByText("Low")).not.toBeInTheDocument();
    expect(within(vitD).getByRole("meter").firstElementChild).toHaveStyle({ width: "0%" });
  });

  it("switches to 28 days", async () => {
    useMicros.mockReturnValue({ isPending: false, isError: false, data });
    render(<NutrientsTab />);
    await userEvent.click(screen.getByRole("radio", { name: "Last 28 days" }));
    expect(useMicros).toHaveBeenLastCalledWith(28);
  });

  it("asks for a few days of logging first", () => {
    useMicros.mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...data, days_counted: 0 },
    });
    render(<NutrientsTab />);
    expect(screen.getByText(/Log food for a few days/)).toBeInTheDocument();
  });
});
