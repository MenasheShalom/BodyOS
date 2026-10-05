import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Runs last with the same user, who has targets set. The backend runs with AI_PROVIDER=fake
// and FOOD_SOURCES=fake, so plan ingredients resolve to the fake USDA and OFF foods.
const user = JSON.parse(readFileSync(new URL("./.user.json", import.meta.url), "utf8")) as {
  email: string;
  password: string;
};

test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Food", exact: true })).toBeVisible();
}

test("plan a day, fix an ingredient, log and save a meal", async ({ page }) => {
  await signIn(page);
  await page.goto("/nutrition");
  await page.getByRole("link", { name: /Plan with AI/ }).click();

  const notice = page.getByRole("dialog", { name: "Before you use AI" });
  await expect(notice).toContainText("your calorie and macro targets");
  await notice.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel(/Preferences/).fill("no pork");
  await page.getByRole("button", { name: "Plan my meals" }).click();

  const lunch = page.getByRole("region", { name: "Chicken and avocado" });
  await expect(lunch).toContainText("Avocados, raw");
  await expect(page.getByLabel("Plan against targets")).toBeVisible();

  const breakfast = page.getByRole("region", { name: "Milk and dragon fruit" });
  await expect(breakfast).toContainText("No food found; not counted");
  await breakfast.getByRole("button", { name: "Remove Dragon fruit" }).click();
  await expect(breakfast).not.toContainText("No food found");

  await lunch.getByRole("button", { name: "Log this meal" }).click();
  await expect(lunch.getByRole("button", { name: /Logged to Lunch/ })).toBeVisible();
  await lunch.getByRole("button", { name: "Save meal" }).click();
  await expect(lunch.getByRole("button", { name: /Saved/ })).toBeVisible();

  await page.goto("/food");
  await expect(
    page.getByRole("region", { name: "Lunch" }).getByText("Avocados, raw", { exact: false }),
  ).toBeVisible();
  await page.goto("/nutrition/meals");
  await expect(page.getByText("Chicken and avocado")).toBeVisible();

  // preferences are remembered
  await page.goto("/nutrition/plan");
  await expect(page.getByLabel(/Preferences/)).toHaveValue("no pork");
});

test("turn groceries into a saved recipe with steps", async ({ page }) => {
  await signIn(page);
  await page.goto("/nutrition/plan");
  await page.getByRole("tab", { name: "From groceries" }).click();
  const panel = page.getByRole("tabpanel");
  const notice = page.getByRole("dialog", { name: "Before you use AI" });
  await expect(notice).toContainText("the groceries you list");
  await notice.getByRole("button", { name: "Continue" }).click();

  await panel.getByLabel("What do you have?").fill("chicken, avocado, lemon");
  await panel.getByRole("button", { name: "Suggest recipes" }).click();
  const salad = panel.getByRole("region", { name: "Chicken avocado salad" });
  await expect(salad).toContainText("Slice the chicken.");
  await salad.getByRole("button", { name: /Save recipe/ }).click();
  await salad.getByRole("link", { name: "Open recipe" }).click();

  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Chicken avocado salad");
  await expect(page.getByLabel("Steps (optional)")).toHaveValue(/^1\. Slice the chicken\./);
});
