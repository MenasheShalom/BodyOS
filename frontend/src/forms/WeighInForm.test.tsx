import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { WeighInForm } from "./WeighInForm";

describe("WeighInForm", () => {
  it("requires weight", async () => {
    const onSubmit = vi.fn();
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects out-of-range weight", async () => {
    const onSubmit = vi.fn();
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "805");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(await screen.findByText("Must be between 20 and 400")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits comma decimals, optional fields and an ISO date", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "82,4");
    await userEvent.click(screen.getByRole("button", { name: /More fields/ }));
    await userEvent.type(screen.getByLabelText("Body fat"), "18.3");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.weight_kg).toBe(82.4);
    expect(payload.body_fat_pct).toBe(18.3);
    expect(payload.muscle_mass_kg).toBeNull();
    expect(payload.measured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  });

  it("hides hidden metrics and shows last values as placeholders", async () => {
    render(
      <WeighInForm
        hiddenMetrics={["protein_pct"]}
        lastValues={{ weight_kg: 82.1, body_fat_pct: 18.4 }}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Weight")).toHaveAttribute("placeholder", "82.1");
    await userEvent.click(screen.getByRole("button", { name: /More fields/ }));
    expect(screen.getByLabelText("Body fat")).toHaveAttribute("placeholder", "18.4");
    expect(screen.queryByLabelText("Protein")).not.toBeInTheDocument();
  });

  it("shows server errors and keeps the input", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new ApiError(422, "Please fix the highlighted fields.", { weight_kg: "Too heavy" }),
      );
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "80");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(await screen.findByText("Too heavy")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    expect(screen.getByLabelText("Weight")).toHaveValue("80");
  });

  it("prefills when editing", () => {
    render(
      <WeighInForm
        hiddenMetrics={[]}
        initial={
          {
            id: "1",
            measured_at: "2026-02-28T05:00:00Z",
            weight_kg: 81.5,
            body_fat_pct: 18,
            note: null,
          } as never
        }
        submitLabel="Save changes"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Weight")).toHaveValue("81.5");
    expect(screen.getByLabelText("Body fat")).toHaveValue("18");
  });

  it("shows body fat and muscle mass without expanding, keeps the rest behind More fields", () => {
    render(<WeighInForm hiddenMetrics={[]} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText("Body fat")).toBeInTheDocument();
    expect(screen.getByLabelText("Muscle mass")).toBeInTheDocument();
    expect(screen.queryByLabelText("Body water")).not.toBeInTheDocument();
  });

  it("saves body fat typed in the always-visible field", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "74");
    await userEvent.type(screen.getByLabelText("Body fat"), "22.8");
    await userEvent.type(screen.getByLabelText("Muscle mass"), "55,1");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({ weight_kg: 74, body_fat_pct: 22.8, muscle_mass_kg: 55.1 });
  });

  it("asks before saving a weight far from the last one", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<WeighInForm hiddenMetrics={[]} lastValues={{ weight_kg: 74 }} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "22.8");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That's very different from your last weigh-in (74.0 kg).",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].weight_kg).toBe(22.8);
  });

  it("saves a normal change without asking", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<WeighInForm hiddenMetrics={[]} lastValues={{ weight_kg: 74 }} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "73.2");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
