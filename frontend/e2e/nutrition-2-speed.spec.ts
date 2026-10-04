import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Runs after nutrition-1-core.spec.ts (files run in name order) with the same user: targets are set, and today's Breakfast
// has 2 × 2 tbsp of Demo hummus (162 kcal). Food sources are the backend's fakes.
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

const meal = (page: Page, name: string) => page.getByRole("region", { name });

test("log to yesterday, then copy yesterday's breakfast into today", async ({ page }) => {
  await signIn(page);
  await page.goto("/food");
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.getByText("Yesterday")).toBeVisible();

  await page.getByRole("button", { name: "Add to Breakfast" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("searchbox", { name: "Search foods" }).fill("hummus");
  await sheet.getByRole("region", { name: "My foods" }).getByText("Demo hummus").click();
  await sheet.getByRole("button", { name: "Log", exact: true }).click(); // 1 × 2 tbsp = 81 kcal
  await expect(sheet).toBeHidden();
  await expect(meal(page, "Breakfast").getByText("81 kcal")).toBeVisible();

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.getByText("Today")).toBeVisible();
  await expect(meal(page, "Breakfast").getByText("162 kcal")).toBeVisible();
  await page.getByRole("button", { name: "Copy into Breakfast" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Copy" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(meal(page, "Breakfast").getByText("243 kcal")).toBeVisible();
});

test("re-log a recent food in one tap and reuse a saved meal", async ({ page }) => {
  await signIn(page);
  await page.goto("/food");
  await page.getByRole("button", { name: "Add to Lunch" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Log Demo hummus again" }).click();
  await expect(sheet.getByRole("button", { name: "Log Demo hummus again" })).toBeDisabled();
  await page.keyboard.press("Escape");
  // re-logs the most recent amount, which depends on the time of day the copy landed at
  await expect(meal(page, "Lunch").getByText("Demo hummus")).toBeVisible();

  await page.getByRole("button", { name: "Save Breakfast as a meal" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Hummus breakfast");
  await page.getByRole("dialog").getByRole("button", { name: "Save meal" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Add to Snacks" }).click();
  await sheet.getByRole("region", { name: "Saved meals" }).getByText("Hummus breakfast").click();
  await sheet.getByRole("button", { name: /Log all 2/ }).click();
  await expect(sheet).toBeHidden();
  await expect(meal(page, "Snacks").getByText("Demo hummus")).toHaveCount(2);
});

test("build a recipe and log a serving", async ({ page }) => {
  await signIn(page);
  await page.goto("/nutrition/recipes/new");
  await page.getByLabel("Name", { exact: true }).fill("Hummus bowl");
  await page.getByLabel("Servings").fill("2");
  await page.getByRole("button", { name: "Add ingredient" }).click();
  await page.getByRole("searchbox", { name: "Search ingredients" }).fill("hummus");
  await page.getByRole("dialog").getByText("Demo hummus").click();
  await page.getByLabel("Grams of Demo hummus").fill("200");
  await expect(page.getByRole("region", { name: "Per serving" })).toContainText("270 kcal");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("link", { name: /Hummus bowl/ })).toBeVisible();

  await page.goto("/food");
  await page.getByRole("button", { name: "Add to Dinner" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("searchbox", { name: "Search foods" }).fill("hummus bowl");
  await sheet.getByRole("region", { name: "My foods" }).getByText("Hummus bowl").click();
  await sheet.getByRole("button", { name: "Log", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(meal(page, "Dinner").getByText("Hummus bowl")).toBeVisible();
});

test("look up a barcode by typing it", async ({ page }) => {
  await signIn(page);
  await page.goto("/food");
  await page.getByRole("button", { name: "Add to Snacks" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Scan barcode" }).click();
  await sheet.getByLabel("Or type the barcode").fill("7290000066318");
  await sheet.getByRole("button", { name: "Look up" }).click();
  await expect(sheet.getByText("במבה")).toBeVisible();
  await sheet.getByRole("button", { name: "Log", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(meal(page, "Snacks").getByText("במבה")).toBeVisible();
});
