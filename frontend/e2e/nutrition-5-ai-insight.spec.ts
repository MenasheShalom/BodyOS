import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Runs after the other specs with the same user, who has two days of front photos (flows)
// and a week of food. The backend runs with AI_PROVIDER=fake.
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

test("write this week's report", async ({ page }) => {
  await signIn(page);
  await page.goto("/more");
  await page.getByRole("link", { name: /Weekly reports/ }).click();
  await page.getByRole("link", { name: /Write this week's report/ }).click();

  const notice = page.getByRole("dialog", { name: "Before you use AI" });
  await expect(notice).toContainText("this week's numbers");
  await notice.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("A steady week")).toBeVisible();
  await expect(page.getByRole("region", { name: "Body" })).toContainText("Going well");
  await expect(page.getByText("Log the weekend days too.")).toBeVisible();

  await page.getByRole("link", { name: "All reports" }).click();
  await expect(page.getByRole("link", { name: /A steady week/ })).toBeVisible();
});

test("estimate body fat from a day's photos and see it on Trends", async ({ page }) => {
  await signIn(page);
  await page.goto("/photos");
  await page.getByRole("button", { name: "Estimate body fat (AI)" }).first().click();
  const notice = page.getByRole("dialog", { name: "Before you use AI" });
  await expect(notice).toContainText("these progress photos");
  await notice.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("AI estimate: 17–21% (rough)")).toBeVisible();

  await page.goto("/trends?metric=ai_body_fat_pct&range=1M");
  await expect(page.getByText("Estimate and range")).toBeVisible();
});
