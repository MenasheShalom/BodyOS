import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Runs last (files run in name order) with the same user, whose history from the other specs
// (weigh-ins, photos, a recipe, a report, an AI-planned meal) has earned several trophies
// that were never shown, since the other specs run with celebrations off.
const user = JSON.parse(readFileSync(new URL("./.user.json", import.meta.url), "utf8")) as {
  email: string;
  password: string;
};

test.use({ storageState: { cookies: [], origins: [] } });

test("celebrate backfilled trophies, then browse them", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const card = page.getByRole("dialog", { name: "Trophies earned" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("list", { name: "New trophies" })).toContainText("First step");
  await card.getByRole("button", { name: "See my trophies" }).click();

  await expect(page.getByRole("heading", { name: "Trophies" })).toBeVisible();
  const habits = page.getByRole("region", { name: "Habits" });
  await expect(habits.getByRole("listitem").filter({ hasText: "First step" })).toContainText(
    "Earned",
  );
  await expect(habits.getByText("New").first()).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toBeVisible();

  // seen now: no celebration on the next visit
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Food", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Trophies earned" })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("checkbox", { name: /Celebrate new trophies/ })).toBeChecked();
});
