import { type Page, expect, test } from "@playwright/test";

// A user of its own, with three weeks of food and weigh-ins seeded through the API: the adaptive
// TDEE needs history the UI can't create in one run.
const supabaseUrl = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const apiUrl = process.env.VITE_API_URL ?? "http://localhost:8000";
const email = `e2e-insight-${Date.now()}@bodyos.test`;
const password = "e2e-password-123";
const SEEDED_DAYS = 21;

test.describe.configure({ mode: "serial" });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const noonUtc = (n: number) => `${isoDay(daysAgo(n))}T12:00:00Z`;

async function api(token: string, method: string, path: string, body: unknown) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
}

test.beforeAll(async () => {
  const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`Could not create user: ${await created.text()}`);
  const session = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { access_token: token } = (await session.json()) as { access_token: string };

  await api(token, "PUT", "/me/profile", {
    height_cm: 180,
    sex: "male",
    date_of_birth: "1990-01-01",
    timezone: "UTC",
  });
  // Check in today (Monday = 0), so the suggestion is due now.
  await api(token, "PUT", "/nutrition/settings", {
    check_in_weekday: (new Date().getUTCDay() + 6) % 7,
  });
  // 2,100 kcal a day while losing 0.05 kg a day: a burn of about 2,100 + 0.05 × 7,700 = 2,485.
  for (let n = SEEDED_DAYS; n >= 1; n--) {
    await api(token, "POST", "/food-log/quick", {
      nutrients: { energy_kcal: 2100, protein_g: 150 },
      meal: "lunch",
      eaten_at: noonUtc(n),
    });
  }
  for (let n = SEEDED_DAYS - 1; n >= 0; n -= 2) {
    await api(token, "POST", "/body-entries", {
      measured_at: n === 0 ? new Date().toISOString() : noonUtc(n),
      weight_kg: Math.round((83 - 0.05 * (SEEDED_DAYS - 1 - n)) * 100) / 100,
    });
  }
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Food", exact: true })).toBeVisible();
}

test("accept the weekly check-in and see the measured burn", async ({ page }) => {
  await signIn(page);
  const checkIn = page.getByRole("region", { name: "Weekly check-in" });
  await expect(checkIn).toContainText(/Your burn is about 2,\d{3} kcal/);
  await checkIn.getByRole("button", { name: "Accept" }).click();
  await expect(checkIn).toBeHidden();

  await page.goto("/nutrition/targets");
  const burn = page.getByRole("region", { name: "Burn estimate" });
  await expect(burn).toContainText(`over ${SEEDED_DAYS} logged days`);
});

test("mark a day incomplete, then check micronutrient coverage", async ({ page }) => {
  await signIn(page);
  await page.goto(`/food?day=${isoDay(daysAgo(1))}`);
  await page.getByRole("button", { name: /Mark day incomplete/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Marked incomplete" })).toBeVisible();

  await page.goto("/nutrition/targets");
  await expect(page.getByRole("region", { name: "Burn estimate" })).toContainText(
    `over ${SEEDED_DAYS - 1} logged days`,
  );

  await page.goto("/food?tab=nutrients");
  const vitaminD = page.getByRole("listitem").filter({ hasText: "Vitamin D" });
  await expect(vitaminD).toContainText("Not enough data (0% of your food reports it)");
});
