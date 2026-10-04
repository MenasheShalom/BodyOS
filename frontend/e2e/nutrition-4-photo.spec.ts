import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Runs after the other nutrition specs with the same user. The backend runs with
// AI_PROVIDER=fake, which answers every food photo with the same three items.
const user = JSON.parse(readFileSync(new URL("./.user.json", import.meta.url), "utf8")) as {
  email: string;
  password: string;
};

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Food", exact: true })).toBeVisible();
}

test("log a meal from a photo", async ({ page }) => {
  await signIn(page);
  await page.goto("/food");
  await page.getByRole("button", { name: "Add to Dinner" }).click();
  const sheet = page.getByRole("dialog", { name: "Add to Dinner" });
  await sheet.getByRole("tab", { name: "Meal photo" }).click();

  const notice = page.getByRole("dialog", { name: "Before you use AI" });
  await notice.getByRole("button", { name: "Continue" }).click();
  await expect(notice).toBeHidden();

  await sheet.getByLabel("Food photo").setInputFiles({
    name: "plate.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  const items = sheet.getByRole("list", { name: "Foods in the photo" });
  await expect(items.getByText("Grilled chicken breast")).toBeVisible();
  await sheet.getByRole("button", { name: "Remove Israeli salad" }).click();
  await sheet.getByLabel("Grams of White rice").fill("90");
  await expect(sheet.getByText("Total 365 kcal · P 49 g")).toBeVisible();
  await sheet.getByRole("button", { name: "Log 2 items" }).click();
  await expect(sheet).toBeHidden();

  const dinner = page.getByRole("region", { name: "Dinner" });
  await expect(dinner.getByText("Grilled chicken breast (~150 g)")).toBeVisible();
  await expect(dinner.getByText("White rice (~90 g)")).toBeVisible();
  await expect(dinner.getByText("AI estimate")).toHaveCount(2);

  await page.goto("/settings");
  await expect(page.getByText(/1 of 300 requests used this month/)).toBeVisible();
});
