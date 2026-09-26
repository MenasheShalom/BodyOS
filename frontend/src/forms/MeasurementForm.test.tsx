import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const navy = vi.fn();
vi.mock("../lib/queries", () => ({
  useNavyPreview: (w: number | null, n: number | null, h: number | null) => navy(w, n, h),
}));

import { MeasurementForm } from "./MeasurementForm";

describe("MeasurementForm", () => {
  it("needs at least one measurement", async () => {
    navy.mockReturnValue({ data: undefined });
    const onSubmit = vi.fn();
    render(<MeasurementForm sex="male" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Save measurements" }));
    expect(await screen.findByText("Enter at least one measurement")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("previews Navy body fat once waist and neck are entered", async () => {
    navy.mockImplementation((w, n) => ({
      data: w && n ? { navy_body_fat_pct: 16.1 } : undefined,
    }));
    render(<MeasurementForm sex="male" onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Waist"), "85");
    await userEvent.type(screen.getByLabelText("Neck"), "38");
    expect(await screen.findByText("16.1%")).toBeInTheDocument();
    expect(navy).toHaveBeenLastCalledWith(85, 38, null);
  });

  it("submits only filled values plus nulls", async () => {
    navy.mockReturnValue({ data: undefined });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MeasurementForm sex="female" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Arm"), "31,5");
    await userEvent.click(screen.getByRole("button", { name: "Save measurements" }));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.arm_cm).toBe(31.5);
    expect(payload.waist_cm).toBeNull();
  });
});
