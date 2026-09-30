import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TargetsForm } from "./TargetsForm";

const initial = { energy_kcal: 2340, protein_g: 170, carbs_g: 270, fat_g: 65, fiber_g: 35 };

describe("TargetsForm", () => {
  it("shows the kcal the macros add up to and warns past 5%", async () => {
    render(<TargetsForm initial={initial} submitLabel="Save" onSubmit={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("add up to 2,345 kcal.");
    const fat = screen.getByLabelText("Fat");
    await userEvent.clear(fat);
    await userEvent.type(fat, "100");
    expect(screen.getByRole("status")).toHaveTextContent("more than 5% away");
  });

  it("validates ranges and submits whole numbers", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TargetsForm initial={initial} submitLabel="Save" onSubmit={onSubmit} />);
    const kcal = screen.getByLabelText("Calories");
    await userEvent.clear(kcal);
    await userEvent.type(kcal, "500");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Must be between 800 and 6000")).toBeInTheDocument();
    await userEvent.clear(kcal);
    await userEvent.type(kcal, "2300,4");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ ...initial, energy_kcal: 2300 });
  });
});
