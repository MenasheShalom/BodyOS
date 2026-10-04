import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { status, save } = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn() }));
vi.mock("../../lib/queries", () => ({
  useAiStatus: () => status(),
  useAiSettings: () => ({ data: { enabled: true, acknowledged: ["food_photo"] } }),
  useSaveAiSettings: () => ({ mutate: save, isPending: false }),
}));

import { AiSettingsSection } from "./AiSettingsSection";

const configured = {
  enabled: true,
  configured: true,
  provider: "google",
  model: "gemini-test",
  used_this_month: 12,
  limit: 300,
  resets_on: "2026-11-01",
};

describe("AiSettingsSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the provider, usage and an on/off switch", async () => {
    status.mockReturnValue({ data: configured });
    render(<AiSettingsSection />);
    expect(screen.getByText(/Google \(Gemini\)/)).toBeInTheDocument();
    expect(
      screen.getByText("12 of 300 requests used this month · resets 1 November"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Use AI features" }));
    expect(save).toHaveBeenCalledWith({ enabled: false, acknowledged: ["food_photo"] });
    await userEvent.click(screen.getByRole("button", { name: "Show privacy notices again" }));
    expect(save).toHaveBeenLastCalledWith({ enabled: true, acknowledged: [] });
  });

  it("says when the server has no AI provider", () => {
    status.mockReturnValue({ data: { ...configured, enabled: false, configured: false } });
    render(<AiSettingsSection />);
    expect(screen.getByText(/aren't set up on the server/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
