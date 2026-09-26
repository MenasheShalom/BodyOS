import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { GOAL_METRICS } from "../lib/metrics";
import { GoalForm } from "./GoalForm";

describe("GoalForm", () => {
  it("submits a goal", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<GoalForm availableMetrics={GOAL_METRICS} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Metric"), "body_fat_pct");
    await userEvent.type(screen.getByLabelText("Target"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(onSubmit).toHaveBeenCalledWith({
      metric: "body_fat_pct",
      target_value: 15,
      target_date: null,
    });
  });

  it("shows why the server refused", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new ApiError(422, "Log at least one Body fat reading before setting this goal"),
      );
    render(<GoalForm availableMetrics={GOAL_METRICS} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Metric"), "body_fat_pct");
    await userEvent.type(screen.getByLabelText("Target"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Log at least one Body fat reading",
    );
  });

  it("edits an existing goal without changing its metric", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <GoalForm
        availableMetrics={GOAL_METRICS}
        initial={{ metric: "fat_mass_kg", target_value: 15, target_date: "2026-06-01" }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByLabelText("Metric")).toBeDisabled();
    expect(screen.getByLabelText("Metric")).toHaveValue("fat_mass_kg");
    const target = screen.getByLabelText("Target");
    expect(target).toHaveValue("15");
    await userEvent.clear(target);
    await userEvent.type(target, "14");
    await userEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(onSubmit).toHaveBeenCalledWith({
      metric: "fat_mass_kg",
      target_value: 14,
      target_date: "2026-06-01",
    });
  });
});
