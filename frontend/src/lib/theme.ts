export type ThemePref = "system" | "light" | "dark";

// Chosen per device in Settings. index.html applies it before first paint with the same key.
const PREF = "bodyos.theme";

export function themePref(): ThemePref {
  try {
    const v = localStorage.getItem(PREF);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

/** Sets `data-theme` on <html> to the resolved light or dark, and the browser bar colour. */
export function applyTheme(pref: ThemePref = themePref()): void {
  const root = document.documentElement;
  root.dataset.theme = pref === "dark" || (pref === "system" && systemDark()) ? "dark" : "light";
  const bg = getComputedStyle(root).getPropertyValue("--color-bg").trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(PREF);
    else localStorage.setItem(PREF, pref);
  } catch {
    // private mode: applies for this visit only
  }
  applyTheme(pref);
}

/** Follow the device's appearance while the preference is "system". */
export function watchSystemTheme(): void {
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themePref() === "system") applyTheme();
  });
}
