import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";

const useTdee = vi.fn();
vi.mock("../../lib/queries", () => ({ useTdee: () => useTdee() }));
vi.mock("recharts", async (orig) => {
  const mod = await orig<typeof import("recharts")>();
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 200 }}>{children}</div>
    ),
  };
});

import { TdeeBlock } from "./TdeeBlock";

const weekly = [
  { day: "2026-02-22", observed: 2410, tdee: 2440, intake: 2050 },
  { day: "2026-03-01", observed: 2390, tdee: 2400, intake: 2010 },
];

describe("TdeeBlock", () => {
  it("shows the measured burn with its band and the weekly table", () => {
    useTdee.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        tdee: 2400,
        confidence: 40,
        has_data: true,
        eligible_days: 26,
        start_tdee: 2468,
        check_in_weekday: 6,
        weekly,
      },
    });
    render(<TdeeBlock />);
    expect(
      screen.getByRole("region", { name: "Burn estimate" }).querySelector(".readout"),
    ).toHaveTextContent("2,400");
    expect(screen.getByText(/\(±40\)/)).toBeInTheDocument();
    expect(screen.getByText(/26 logged days/)).toHaveTextContent("Updated every Sunday");
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("2,010");
    expect(table).toHaveTextContent("2,400");
  });

  it("explains the starting estimate before two weeks of data", () => {
    useTdee.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        tdee: 2468,
        confidence: null,
        has_data: false,
        eligible_days: 9,
        start_tdee: 2468,
        check_in_weekday: 6,
        weekly: [],
      },
    });
    render(<TdeeBlock />);
    expect(screen.getByText("kcal a day, your starting estimate")).toBeInTheDocument();
    expect(screen.getByText(/9 of 14 days logged so far/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("asks for a weigh-in first", () => {
    useTdee.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(409, "Log a weigh-in first"),
    });
    render(<TdeeBlock />);
    expect(screen.getByText("Log a weigh-in first to see your burn estimate.")).toBeInTheDocument();
  });
});
