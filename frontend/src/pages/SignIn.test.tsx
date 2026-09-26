import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
      signUp: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  },
}));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ session: null, loading: false }) }));

import { SignIn, safeNext } from "./SignIn";

describe("safeNext", () => {
  it("only allows same-origin paths", () => {
    expect(safeNext("/trends?x=1")).toBe("/trends?x=1");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("SignIn", () => {
  it("signs in and returns to the next path", async () => {
    signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    render(
      <MemoryRouter initialEntries={["/sign-in?next=%2Ftrends"]}>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/trends" element={<p>trends page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter22");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "me@example.com", password: "hunter22" });
    expect(await screen.findByText("trends page")).toBeInTheDocument();
  });

  it("shows the auth error", async () => {
    signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: "Invalid login credentials" },
    });
    render(
      <MemoryRouter initialEntries={["/sign-in"]}>
        <SignIn />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
  });
});
