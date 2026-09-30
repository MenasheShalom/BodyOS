import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { isoDay } from "../lib/meals";

const estimate = {
  bmr: 1795,
  tdee: 2468,
  method: "mifflin",
  activity_factor: 1.375,
  weight_kg: 85,
  lean_mass_kg: null,
  targets: { energy_kcal: 2220, protein_g: 170, carbs_g: 245, fat_g: 60, fiber_g: 30 },
};
const useEstimate = vi.fn();
const saveSettings = vi.fn().mockResolvedValue({});
const saveTargets = vi.fn().mockResolvedValue({});
const navigate = vi.fn();
vi.mock("react-router", async (orig) => ({
  ...(await orig<typeof import("react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("../lib/queries", () => ({
  useNutritionSettings: () => ({
    isPending: false,
    data: {
      mode: "recomp",
      deficit_pct: null,
      protein_g_per_kg: 2,
      activity_level: "light",
      check_in_weekday: 6,
      food_country: "en:israel",
      configured: false,
    },
  }),
  useEstimate: (...args: unknown[]) => useEstimate(...args),
  useSaveNutritionSettings: () => ({ mutateAsync: saveSettings }),
  useSaveTargets: () => ({ mutateAsync: saveTargets }),
}));

import { NutritionSetup } from "./NutritionSetup";

const renderSetup = () =>
  render(
    <MemoryRouter>
      <NutritionSetup />
    </MemoryRouter>,
  );

describe("NutritionSetup", () => {
  beforeEach(() => {
    useEstimate.mockReturnValue({ isPending: false, isError: false, data: estimate });
    saveTargets.mockClear();
  });

  it("explains the estimate and saves unchanged targets as suggested", async () => {
    renderSetup();
    await userEvent.click(screen.getByRole("radio", { name: /Cut/ }));
    await userEvent.selectOptions(screen.getByRole("combobox"), "moderate");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(useEstimate).toHaveBeenLastCalledWith(
      { mode: "cut", activity_level: "moderate", deficit_pct: null, protein_g_per_kg: 2 },
      true,
    );
    expect(screen.getByText(/Mifflin-St Jeor/)).toBeInTheDocument();
    expect(screen.getByText("2,468 kcal")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save targets" }));
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "cut", activity_level: "moderate" }),
    );
    expect(saveTargets).toHaveBeenCalledWith({
      ...estimate.targets,
      effective_from: isoDay(new Date()),
      origin: "suggested",
      tdee_at_creation: 2468,
    });
    expect(navigate).toHaveBeenCalledWith("/food");
  });

  it("saves edited targets as manual", async () => {
    renderSetup();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const protein = screen.getByLabelText("Protein");
    await userEvent.clear(protein);
    await userEvent.type(protein, "180");
    await userEvent.click(screen.getByRole("button", { name: "Save targets" }));
    expect(saveTargets).toHaveBeenCalledWith(
      expect.objectContaining({ protein_g: 180, origin: "manual" }),
    );
  });

  it("asks for a weigh-in when the estimate needs one", async () => {
    useEstimate.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(409, "Log a weigh-in first"),
    });
    renderSetup();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Log a weigh-in first");
  });
});
