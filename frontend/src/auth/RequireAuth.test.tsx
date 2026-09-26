import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

const auth = { session: null as unknown, loading: false };
vi.mock("./AuthProvider", () => ({ useAuth: () => auth }));

import { RequireAuth } from "./RequireAuth";

function SignInProbe() {
  const location = useLocation();
  return <p>sign-in {location.search}</p>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in" element={<SignInProbe />} />
        <Route element={<RequireAuth />}>
          <Route path="/trends" element={<p>trends page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  it("redirects signed-out users to sign-in and remembers where they were", () => {
    auth.session = null;
    renderAt("/trends?metric=weight_kg");
    const next = encodeURIComponent("/trends?metric=weight_kg");
    expect(screen.getByText(`sign-in ?next=${next}`)).toBeInTheDocument();
  });

  it("renders the page for signed-in users", () => {
    auth.session = { access_token: "t" };
    renderAt("/trends");
    expect(screen.getByText("trends page")).toBeInTheDocument();
  });
});
