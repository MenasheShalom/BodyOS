import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { status, reports } = vi.hoisted(() => ({ status: vi.fn(), reports: vi.fn() }));
vi.mock("../../lib/queries", () => ({
  useAiStatus: () => status(),
  useReports: () => reports(),
}));

import { ReportCard } from "./ReportCard";

const show = () =>
  render(
    <MemoryRouter>
      <ReportCard />
    </MemoryRouter>,
  );

describe("ReportCard", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 9, 5, 9) }); // Monday 5 October
    status.mockReturnValue({ data: { enabled: true } });
  });
  afterEach(() => vi.useRealTimers());

  it("invites reading the report in the days after the check-in", () => {
    reports.mockReturnValue({ data: { current_week_start: "2026-10-04", reports: [] } });
    show();
    expect(screen.getByRole("link", { name: /Your weekly report/ })).toHaveAttribute(
      "href",
      "/reports/2026-10-04",
    );
  });

  it("hides once the report exists, later in the week, or without AI", () => {
    reports.mockReturnValue({
      data: {
        current_week_start: "2026-10-04",
        reports: [{ week_start: "2026-10-04", summary: "", fallback: false }],
      },
    });
    const { unmount } = show();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    unmount();

    reports.mockReturnValue({ data: { current_week_start: "2026-09-27", reports: [] } });
    show().unmount();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    status.mockReturnValue({ data: { enabled: false } });
    reports.mockReturnValue({ data: { current_week_start: "2026-10-04", reports: [] } });
    show();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
