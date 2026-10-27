import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, setThemePref, themePref } from "./theme";

describe("theme", () => {
  afterEach(() => localStorage.clear());

  it("defaults to following the system", () => {
    expect(themePref()).toBe("system");
    applyTheme();
    // jsdom has no matchMedia, so the system resolves to light.
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("remembers and applies a chosen theme", () => {
    setThemePref("dark");
    expect(themePref()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    setThemePref("system");
    expect(localStorage.getItem("bodyos.theme")).toBeNull();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
