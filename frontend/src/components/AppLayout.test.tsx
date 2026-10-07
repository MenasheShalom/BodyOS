import { render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("./WakingBanner", () => ({ WakingBanner: () => null }));
vi.mock("./LogSheet", () => ({ LogSheet: () => null }));
vi.mock("./trophies/TrophyCelebration", () => ({ TrophyCelebration: () => null }));

import { AppLayout } from "./AppLayout";

describe("AppLayout", () => {
  it("puts Food in the phone tab bar and Photos in the sidebar only", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response()));
    const { container } = render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>,
    );
    const tabBar = container.querySelector("nav") as HTMLElement;
    const items = Array.from(tabBar.querySelectorAll("a, button")).map(
      (el) => el.textContent?.trim() || el.getAttribute("aria-label"),
    );
    expect(items).toEqual(["Home", "Food", "Log", "Trends", "More"]);
    const sidebar = container.querySelector("aside") as HTMLElement;
    expect(within(sidebar).getByRole("link", { name: "Photos" })).toHaveAttribute(
      "href",
      "/photos",
    );
    vi.unstubAllGlobals();
  });
});
