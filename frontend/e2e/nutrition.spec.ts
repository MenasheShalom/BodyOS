import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Runs after flows.spec.ts with the same user, who has onboarded and has a weigh-in.
// The backend runs with FOOD_SOURCES=fake, so "Demo hummus" comes from the fake OFF source.
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
  await expect(page.getByRole("link", { name: "Food" })).toBeVisible();
}

const meal = (page: Page, name: string) => page.getByRole("region", { name });
const summary = (page: Page) => page.getByRole("region", { name: "Daily summary" });

test("set up targets, then log from search and quick add", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Food" }).click();
  await page.getByRole("link", { name: /Set up nutrition targets/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText(/Resting burn \(BMR\)/)).toBeVisible();
  await page.getByRole("button", { name: "Save targets" }).click();
  await expect(page).toHaveURL(/\/food$/);
  await expect(summary(page).getByText(/^of [\d,]+ kcal$/)).toBeVisible();

  await page.getByRole("button", { name: "Add to Breakfast" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("searchbox", { name: "Search foods" }).fill("hummus");
  await sheet.getByRole("searchbox", { name: "Search foods" }).press("Enter");
  await sheet.getByRole("button", { name: /Demo hummus/ }).click();
  await sheet.getByLabel("Amount").fill("2");
  await sheet.getByRole("button", { name: "Log", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(meal(page, "Breakfast").getByText("2 × 2 tbsp")).toBeVisible();
  await expect(meal(page, "Breakfast").getByText("162 kcal")).toBeVisible(); // 60 g × 2.7

  await page.getByRole("button", { name: "Add to Dinner" }).click();
  await sheet.getByRole("tab", { name: "Quick add" }).click();
  await sheet.getByLabel("Calories").fill("450");
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(summary(page).getByText("612", { exact: true })).toBeVisible();
});

test("custom foods keep past entries unchanged when edited", async ({ page }) => {
  await signIn(page);
  await page.goto("/nutrition/foods/new");
  await page.getByLabel("Name", { exact: true }).fill("Protein shake");
  await page.getByLabel("Serving name").fill("1 scoop");
  await page.getByLabel("Serving size").fill("30");
  await page.getByLabel("Calories").fill("120");
  await page.getByLabel("Protein").fill("24");
  await page.getByRole("button", { name: "Create food" }).click();
  await expect(page.getByRole("link", { name: /Protein shake/ })).toBeVisible();

  await page.goto("/food");
  await page.getByRole("button", { name: "Add to Snacks" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("searchbox", { name: "Search foods" }).fill("shake");
  await sheet.getByRole("region", { name: "My foods" }).getByText("Protein shake").click();
  await sheet.getByRole("button", { name: "Log", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(meal(page, "Snacks").getByText("120 kcal")).toBeVisible();

  await page.goto("/nutrition/foods");
  await page.getByRole("link", { name: /Protein shake/ }).click();
  await page.getByLabel("Calories").fill("500"); // per 100 g, was 400
  await page.getByRole("button", { name: "Save food" }).click();
  await expect(page.getByText("500 kcal per 100 g")).toBeVisible();

  await page.goto("/food");
  await expect(meal(page, "Snacks").getByText("120 kcal")).toBeVisible();
});

test("move to the previous day", async ({ page }) => {
  await signIn(page);
  await page.goto("/food");
  await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.getByText("Yesterday")).toBeVisible();
  await expect(page.getByText("Nothing logged")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Next day" })).toBeEnabled();
});
