import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

const saveProfile = vi.fn().mockResolvedValue({});
vi.mock("../lib/queries", () => ({
  useSaveProfile: () => ({ mutateAsync: saveProfile }),
  bodyEntries: { useCreate: () => ({ mutateAsync: vi.fn() }) },
}));

import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("saves the profile, then offers a first weigh-in that can be skipped", async () => {
    render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Height"), "180");
    await userEvent.click(screen.getByLabelText("Male"));
    await userEvent.type(screen.getByLabelText("Date of birth"), "1990-05-01");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(saveProfile).toHaveBeenCalled();
    expect(await screen.findByText("Log your first weigh-in")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });
});
