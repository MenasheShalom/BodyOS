import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WeeklyReport } from "../lib/types";

const { report, write, settings, status } = vi.hoisted(() => ({
  report: vi.fn(),
  write: vi.fn(),
  settings: vi.fn(),
  status: vi.fn(),
}));
vi.mock("../lib/queries", () => ({
  useAiStatus: () => status(),
  useReport: () => report(),
  useWriteReport: () => ({ mutate: write, isPending: false }),
  useAiSettings: () => settings(),
  useSaveAiSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ReportDetail } from "./ReportDetail";

const REPORT: WeeklyReport = {
  week_start: "2026-10-04",
  facts: {},
  summary: "A steady week.",
  sections: [
    { title: "Body", body: "Weight trend down 0.3 kg.", tone: "good" },
    { title: "Eating", body: "4 of 7 days logged.", tone: "watch" },
  ],
  focus: ["Log the weekend too."],
  fallback: false,
  can_regenerate: true,
  created_at: "2026-10-04T18:00:00Z",
  updated_at: "2026-10-04T18:00:00Z",
};

function show() {
  render(
    <MemoryRouter initialEntries={["/reports/2026-10-04"]}>
      <Routes>
        <Route path="/reports/:week" element={<ReportDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ReportDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status.mockReturnValue({ data: { enabled: true, provider: "google" } });
    settings.mockReturnValue({ data: { enabled: true, acknowledged: ["weekly_report"] } });
  });

  it("shows the report with its sections and next week's focus", async () => {
    report.mockReturnValue({ isPending: false, isError: false, data: REPORT });
    show();
    expect(screen.getByRole("heading", { name: "Week to 4 Oct" })).toBeInTheDocument();
    expect(screen.getByText("A steady week.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Eating" })).toHaveTextContent("Needs attention");
    expect(screen.getByText("Log the weekend too.")).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Rewrite this report" }));
    expect(write).toHaveBeenCalledWith("2026-10-04", expect.anything());
  });

  it("says when the plain template was used", () => {
    report.mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...REPORT, fallback: true, can_regenerate: false },
    });
    show();
    expect(screen.getByRole("note")).toHaveTextContent("plain summary");
    expect(screen.queryByRole("button", { name: /Rewrite/ })).not.toBeInTheDocument();
  });

  it("writes a missing report once the notice has been seen", () => {
    report.mockReturnValue({ isPending: false, isError: false, data: null });
    show();
    expect(screen.getByRole("status")).toHaveTextContent("Writing your report");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("asks first when the notice hasn't been seen", () => {
    report.mockReturnValue({ isPending: false, isError: false, data: null });
    settings.mockReturnValue({ data: { enabled: true, acknowledged: [] } });
    show();
    expect(screen.getByRole("dialog", { name: "Before you use AI" })).toHaveTextContent(
      "this week's numbers",
    );
    expect(write).not.toHaveBeenCalled();
  });
});
