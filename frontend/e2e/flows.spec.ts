import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const user = JSON.parse(readFileSync(new URL("./.user.json", import.meta.url), "utf8")) as {
  email: string;
  password: string;
};
// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

function localInput(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T07:00`;
}

test("onboard, log weigh-ins and see them on Home and Trends", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("A few basics")).toBeVisible();
  await page.getByLabel("Height").fill("180");
  await page.getByLabel("Male", { exact: true }).check();
  await page.getByLabel("Date of birth").fill("1990-05-01");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Log your first weigh-in")).toBeVisible();
  await page.getByLabel("Weight").fill("82.4");
  await page.getByLabel("Date & time").fill(localInput(3));
  await page.getByRole("button", { name: /More fields/ }).click();
  await page.getByLabel("Body fat").fill("19");
  await page.getByRole("button", { name: "Save weigh-in" }).click();

  await expect(page.getByText("Fat mass")).toBeVisible();
  await expect(page.getByText("15.7 kg")).toBeVisible(); // 82.4 × 19%

  await page.getByRole("button", { name: "Log" }).click();
  await page.getByLabel("Weight").fill("82,0");
  await page.getByRole("button", { name: /More fields/ }).click();
  await page.getByLabel("Body fat").fill("18.8");
  await page.getByRole("button", { name: "Save weigh-in" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto("/trends?metric=weight_kg&range=1M");
  await expect(page.getByText("Weekly rate")).toBeVisible();
  await expect(page.getByText("Low", { exact: true })).toBeVisible();
});

test("upload progress photos and compare them", async ({ page }) => {
  await signIn(page);
  for (const daysAgo of [10, 1]) {
    await page.getByRole("button", { name: "Log" }).click();
    await page.getByRole("tab", { name: "Photo" }).click();
    await page
      .getByLabel("Choose from gallery")
      .setInputFiles({ name: "front.png", mimeType: "image/png", buffer: PNG });
    await page.getByLabel("Date & time").fill(localInput(daysAgo));
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.goto("/photos");
  await expect(page.getByAltText("front photo", { exact: true })).toHaveCount(2);
  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page.getByLabel("Compare position")).toBeVisible();
});
