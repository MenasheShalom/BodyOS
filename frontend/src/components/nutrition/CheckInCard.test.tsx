import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { isoDay } from "../../lib/meals";
import type { Suggestion } from "../../lib/types";

const save = vi.fn().mockResolvedValue({});
const dismiss = vi.fn();
vi.mock("../../lib/queries", () => ({
  useSaveTargets: () => ({ mutateAsync: save, isPending: false }),
  useDismissSuggestion: () => ({ mutate: dismiss, isPending: false }),
}));

import { CheckInCard } from "./CheckInCard";

const suggestion: Suggestion = {
  week_start: "2026-03-01",
  tdee: 2540,
  confidence: 120,
  targets: { energy_kcal: 2290, protein_g: 170, carbs_g: 245, fat_g: 65, fiber_g: 30 },
  current: { energy_kcal: 2140, protein_g: 170, carbs_g: 210, fat_g: 60, fiber_g: 30 },
  capped: true,
  warning: null,
};

describe("CheckInCard", () => {
  it("shows the burn, the suggestion and today's targets", () => {
    render(<CheckInCard suggestion={suggestion} />);
    expect(screen.getByText("2,540 kcal")).toBeInTheDocument();
    expect(screen.getByText("(±120)")).toBeInTheDocument();
    expect(screen.getByText("2,290 kcal · P 170 · C 245 · F 65")).toBeInTheDocument();
    expect(screen.getByText("2,140 kcal · P 170 · C 210 · F 60")).toBeInTheDocument();
    expect(screen.getByText(/at most 150 a week/)).toBeInTheDocument();
  });

  it("accepts the suggestion as new targets from today", async () => {
    render(<CheckInCard suggestion={suggestion} />);
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(save).toHaveBeenCalledWith({
      ...suggestion.targets,
      effective_from: isoDay(new Date()),
      origin: "suggested",
      tdee_at_creation: 2540,
    });
  });

  it("saves edited targets as manual", async () => {
    save.mockClear();
    render(<CheckInCard suggestion={suggestion} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const kcal = screen.getByLabelText("Calories");
    await userEvent.clear(kcal);
    await userEvent.type(kcal, "2200");
    await userEvent.click(screen.getByRole("button", { name: "Save targets" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ energy_kcal: 2200, origin: "manual" }),
    );
  });

  it("can be put off for a week, and shows warnings", async () => {
    render(<CheckInCard suggestion={{ ...suggestion, capped: false, warning: "Losing fast." }} />);
    expect(screen.getByRole("note")).toHaveTextContent("Losing fast.");
    await userEvent.click(screen.getByRole("button", { name: "Not this week" }));
    expect(dismiss).toHaveBeenCalled();
  });
});
