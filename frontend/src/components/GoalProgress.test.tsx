import { describe, expect, it } from "vitest";
import type { Goal } from "../lib/types";
import { goalStatusText } from "./GoalProgress";

const goal = (state: Goal["projection"]["state"], projected_date: string | null = null): Goal => ({
  id: "g",
  metric: "body_fat_pct",
  start_value: 20,
  target_value: 15,
  start_date: "2026-02-01",
  target_date: null,
  status: "active",
  projection: { current: 18, progress_pct: 40, state, projected_date },
});

describe("goalStatusText", () => {
  it("describes each projection state", () => {
    expect(goalStatusText(goal("on_track", "2026-04-12"))).toBe("On track for 12 Apr");
    expect(goalStatusText(goal("reached"))).toBe("Goal reached");
    expect(goalStatusText(goal("not_on_pace"))).toBe("Not on pace at current rate");
    expect(goalStatusText(goal("insufficient_data"))).toBe("Need more data");
  });
});
