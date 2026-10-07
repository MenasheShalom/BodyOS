import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";

const m = vi.hoisted(() => ({ request: vi.fn(), answer: vi.fn(), apps: vi.fn(), disconnect: vi.fn() }));
vi.mock("../lib/queries", () => ({
  useConsentRequest: () => m.request(),
  useAnswerConsent: () => ({ mutateAsync: m.answer, isPending: false }),
  useConnectedApps: () => ({ data: m.apps() }),
  useDisconnectApp: () => ({ mutate: m.disconnect, isPending: false }),
}));

import { ConnectedApps } from "../components/ConnectedApps";
import { Connect } from "./Connect";

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  m.request.mockReturnValue({
    isPending: false,
    isError: false,
    data: { client_name: "Claude", client_uri: null, redirect_host: "claude.ai" },
  });
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(() => vi.unstubAllGlobals());

function renderConnect(search = "?request=abc") {
  return render(
    <MemoryRouter initialEntries={[`/connect${search}`]}>
      <Connect />
    </MemoryRouter>,
  );
}

describe("Connect", () => {
  it("shows who is asking and sends the answer back", async () => {
    m.answer.mockResolvedValue({ redirect_url: "https://claude.ai/cb?code=x&state=s" });
    renderConnect();
    expect(screen.getByRole("heading")).toHaveTextContent("Claude wants to connect to your BodyOS");
    expect(screen.getByText("claude.ai")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(m.answer).toHaveBeenCalledWith({ id: "abc", allow: true });
    expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=x&state=s");
  });

  it("can deny", async () => {
    m.answer.mockResolvedValue({ redirect_url: "https://claude.ai/cb?error=access_denied" });
    renderConnect();
    await userEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(m.answer).toHaveBeenCalledWith({ id: "abc", allow: false });
    expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?error=access_denied");
  });

  it("explains an expired request", () => {
    m.request.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(404, "This request has expired. Start connecting again from your assistant."),
    });
    renderConnect();
    expect(screen.getByRole("alert")).toHaveTextContent("This request has expired");
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("needs a request id", () => {
    renderConnect("");
    expect(screen.getByRole("alert")).toHaveTextContent("missing its request");
  });
});

describe("ConnectedApps", () => {
  it("shows the connector URL and disconnects an app", async () => {
    m.apps.mockReturnValue([
      { id: "g1", client_name: "Claude", created_at: "2026-10-01T10:00:00Z", last_used_at: "2026-10-07T09:00:00Z" },
    ]);
    render(<ConnectedApps />);
    expect(screen.getByText("http://localhost:8000/mcp")).toBeInTheDocument();
    expect(screen.getByText(/Connected 1 Oct 2026 · last used 7 Oct 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(m.disconnect).toHaveBeenCalledWith("g1");
  });
});
