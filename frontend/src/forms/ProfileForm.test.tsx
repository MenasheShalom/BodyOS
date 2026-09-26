import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileForm } from "./ProfileForm";

describe("ProfileForm", () => {
  it("validates height and submits a profile", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProfileForm submitLabel="Continue" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Height"), "300");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Must be between 100 and 250")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Height"));
    await userEvent.type(screen.getByLabelText("Height"), "180");
    await userEvent.click(screen.getByLabelText("Male"));
    await userEvent.type(screen.getByLabelText("Date of birth"), "1990-05-01");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith({
      height_cm: 180,
      sex: "male",
      date_of_birth: "1990-05-01",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hidden_metrics: [],
    });
  });

  it("lets settings hide scale fields", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfileForm
        showHiddenMetrics
        initial={{
          height_cm: 180,
          sex: "male",
          date_of_birth: "1990-05-01",
          timezone: "UTC",
          hidden_metrics: [],
        }}
        submitLabel="Save"
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByLabelText("Protein"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit.mock.calls[0][0].hidden_metrics).toEqual(["protein_pct"]);
  });
});
