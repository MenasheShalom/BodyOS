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
});
