import { writeFileSync } from "node:fs";

export default async function globalSetup() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for e2e");
  }
  const email = `e2e-${Date.now()}@bodyos.test`;
  const password = "e2e-password-123";
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`Could not create e2e user: ${res.status} ${await res.text()}`);
  writeFileSync(new URL("./.user.json", import.meta.url), JSON.stringify({ email, password }));
}
