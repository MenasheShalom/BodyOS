import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// Runs after the nutrition specs with the same user. The backend runs with AI_PROVIDER=fake,
// whose program is "Full body, 3 days".
const user = JSON.parse(readFileSync(new URL("./.user.json", import.meta.url), "utf8")) as {
  email: string;
  password: string;
};

test("set up, build a program and log a workout", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Food", exact: true })).toBeVisible();

  await page.goto("/more");
  await page.getByRole("link", { name: /Training/ }).click();
  await page.getByRole("button", { name: "Set up training" }).click();

  // a home setup from the preset, then the profile
  await page.getByRole("button", { name: "Home" }).click();
  await page.getByText("Pull-up bar").click();
  await page.getByRole("button", { name: "Save location" }).click();
  await expect(page.getByRole("region", { name: "Where you train" })).toContainText(
    "Dumbbells, Pull-up bar, Resistance bands",
  );
  await page.getByLabel("Days per week").selectOption("3");
  await page.getByLabel(/Injuries or limits/).fill("sore left knee");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await page.getByRole("button", { name: "Build my program" }).click();
  const notice = page.getByRole("dialog", { name: "Before you use AI" });
  await expect(notice).toContainText("the injuries you noted");
  await notice.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Full body, 3 days" })).toBeVisible();
  const dayA = page.getByRole("region", { name: "Full body A" });
  await dayA.getByRole("button", { name: "Swap Goblet squat" }).click();
  await dayA.getByRole("button", { name: "Swap to Split squat" }).click();
  await expect(dayA).toContainText("Split squat");

  await page.getByRole("link", { name: /Today's workout/ }).click();
  await expect(page.getByRole("heading", { name: "Full body A" })).toBeVisible();
  await page.getByRole("button", { name: "Start workout" }).click();
  const squat = page.getByRole("region", { name: "Split squat" });
  await squat.getByLabel("Split squat set 1 weight").fill("12");
  await squat.getByRole("button", { name: "Log Split squat set 1" }).click();
  await expect(page.getByRole("timer", { name: "Rest" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "Log Push-up set 1" }).click();
  await page.getByRole("button", { name: /Finish workout \(2 sets\)/ }).click();
  await expect(page.getByText("Workout done")).toBeVisible();

  await page.getByRole("link", { name: "Back to training" }).click();
  await expect(page.getByRole("region", { name: "Recent workouts" })).toContainText(
    "Full body A",
  );
  // the next one in rotation shows on Home
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Next workout: Full body B/ })).toBeVisible();
});
