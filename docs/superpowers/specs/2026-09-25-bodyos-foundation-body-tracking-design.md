# BodyOS — Sub-project 1: Foundation + Body Tracking

- **Date:** 2026-09-25
- **Status:** Draft, awaiting review
- **Scope:** First of four sub-projects. Delivers the app shell, auth, data storage, body metrics, tape measurements, progress photos, goals, and graphs/trends.

## 1. Context and goals

BodyOS is a personal (single-user) app for tracking body composition, nutrition and fitness, with AI-assisted planning and insights. The owner loves data: the app's job is to turn regular logging into clear trends and insights.

The full vision is split into sub-projects, each with its own spec → plan → implementation cycle:

1. **Foundation + body tracking** (this spec)
2. Nutrition: food logging, food database, macro/micro targets, adaptive TDEE
3. AI: body-fat estimate from photos, diet-plan builder, recipes from available groceries, weekly report
4. Extras: workout log, health-platform import, correlation insights

### Current goal of the user

**Recomposition** — lose fat while gaining/keeping muscle. The dashboard therefore leads with fat mass, lean mass, body fat % and muscle mass; weight is secondary. Goals are editable at any time.

### Success criteria

- Logging a weigh-in on a phone takes under 15 seconds.
- After ~2 weeks of data, the dashboard shows smoothed trends, weekly rates, and goal projections for body fat % and muscle mass.
- Progress photos of the same pose can be compared side by side across dates.
- The user's data is only readable by the user.
- Runs on free tiers (Supabase, Render, static hosting).

### Non-goals (this sub-project)

- Food/nutrition, workouts, AI features, device/health-platform imports.
- Offline logging (queue-and-sync) — deliberately deferred.
- Multi-user features (sharing, coaches, social).
- CSV import/export (candidate for a later sub-project).

## 2. Decisions

| Topic | Decision |
|---|---|
| Platform | Mobile-first installable web app (PWA); works on desktop too |
| Frontend | React + Vite + TypeScript, Tailwind CSS, Recharts, `vite-plugin-pwa` |
| Backend | Python, FastAPI |
| Database / auth / files | Supabase: Postgres, Auth (email/password + Google), Storage (private bucket) |
| Backend hosting | Render free tier (sleeps after 15 min idle; mitigated by warm-up ping) |
| Frontend hosting | Free static host (Vercel, Netlify or Cloudflare Pages) |
| Units | Metric only (kg, cm) |
| Scale data | Entered manually; weight required, every other scale field optional |

## 3. Architecture

```
┌──────────────────────────┐      ┌────────────────────────┐      ┌──────────────────────────┐
│  React PWA               │─────▶│  FastAPI (Render)      │─────▶│  Supabase                │
│  Vite + TS + Tailwind    │ JWT  │  - verifies JWT        │      │  - Postgres (data)       │
│  Recharts                │◀─────│  - REST API            │◀─────│  - Storage (photos)      │
│  Static hosting          │      │  - calculations        │      │  - Auth                  │
└────────────┬─────────────┘      └────────────────────────┘      └──────────────────────────┘
             │  sign-in only                                                   ▲
             └─────────────────────────────────────────────────────────────────┘
```

### Responsibilities

- **Frontend:** UI, forms, charts. Talks to Supabase **only for authentication** (sign-in, session refresh). Every data operation goes to FastAPI with the Supabase access token (JWT) in the `Authorization: Bearer` header.
- **FastAPI:** the only component that reads/writes application data. Verifies the Supabase JWT on every request and scopes every query to the token's user id. Owns all derived calculations (BMI, fat/lean mass, US Navy body fat, trends, rates, projections) so they are consistent and unit-tested in one place.
- **Supabase Postgres:** stores data. Row Level Security (RLS) is enabled on every table with `user_id = auth.uid()` policies as defence in depth, even though the API is the primary gate.
- **Supabase Storage:** a private bucket `progress-photos`. FastAPI issues short-lived signed upload and view URLs; files are never public. Paths are `{user_id}/{photo_id}.jpg`.

### Warm-up

On app load the frontend calls `GET /health` (fire-and-forget) so the Render instance is waking while the user navigates.

### Repository layout

```
BodyOS/
  frontend/         React + Vite app
  backend/          FastAPI app
    app/            routers, services (calculations), db access, auth
    tests/          pytest
  supabase/
    migrations/     versioned SQL (schema, RLS policies, storage bucket)
  docs/superpowers/ specs and plans
```

### Local development

Backend and frontend run locally against a Supabase project (a free cloud dev project, or the Supabase CLI local stack via Docker). Configuration via environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` for the backend only, `SUPABASE_JWT_SECRET` or JWKS URL, `DATABASE_URL`). Secrets are never committed; `.env.example` files document the variables.

## 4. Data model

All tables carry `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users on delete cascade`, `created_at`, `updated_at`, and RLS policies restricting all operations to `user_id = auth.uid()`. All units are metric. Derived values are **computed, not stored**.

### `profiles` (one row per user; `user_id` is the primary key)

| Column | Type | Notes |
|---|---|---|
| `height_cm` | numeric(5,1) | 100–250; required for BMI |
| `sex` | enum `male` / `female` | Needed for US Navy formula |
| `date_of_birth` | date | Age context |
| `timezone` | text | IANA name, auto-detected at onboarding; used for day bucketing |
| `hidden_metrics` | text[] | Optional scale fields hidden from forms and charts |

### `body_entries` (scale readings)

| Column | Type | Required | Range check |
|---|---|---|---|
| `measured_at` | timestamptz | ✅ | — |
| `weight_kg` | numeric(5,2) | ✅ | 20–400 |
| `body_fat_pct` | numeric(4,1) | | 2–70 |
| `muscle_mass_kg` | numeric(5,2) | | 5–200 |
| `skeletal_muscle_pct` | numeric(4,1) | | 5–80 |
| `body_water_pct` | numeric(4,1) | | 20–80 |
| `bone_mass_kg` | numeric(4,2) | | 0.5–10 |
| `visceral_fat` | numeric(4,1) | | 1–60 |
| `protein_pct` | numeric(4,1) | | 5–30 |
| `bmr_kcal` | integer | | 500–5000 |
| `metabolic_age` | integer | | 10–100 |
| `note` | text | | ≤ 500 chars |

### `measurements` (tape measurements)

| Column | Type | Notes |
|---|---|---|
| `measured_at` | timestamptz | required |
| `waist_cm`, `hips_cm`, `chest_cm`, `neck_cm`, `arm_cm`, `thigh_cm` | numeric(5,1) | each optional, 10–250; at least one required (check constraint) |
| `note` | text | ≤ 500 chars |

### `progress_photos`

| Column | Type | Notes |
|---|---|---|
| `taken_at` | timestamptz | required |
| `pose` | enum `front` / `side` / `back` | required |
| `storage_path` | text | `{user_id}/{id}.jpg` in `progress-photos` bucket |
| `note` | text | ≤ 500 chars |

Images are resized client-side to a max 1600 px long edge, JPEG quality ~0.85, before upload.

### `goals`

| Column | Type | Notes |
|---|---|---|
| `metric` | enum | `weight_kg`, `body_fat_pct`, `muscle_mass_kg`, `fat_mass_kg`, `lean_mass_kg`, `waist_cm`, `navy_body_fat_pct` |
| `start_value` | numeric | Captured from current trend value when created |
| `target_value` | numeric | required |
| `start_date` | date | required |
| `target_date` | date | optional |
| `status` | enum `active` / `achieved` / `archived` | Partial unique index: one `active` goal per `(user_id, metric)` |

### Derived metrics (computed in FastAPI)

- **BMI** = `weight_kg / (height_cm / 100)²`
- **Fat mass (kg)** = `weight_kg × body_fat_pct / 100` (only when body fat present)
- **Lean mass (kg)** = `weight_kg − fat_mass_kg`
- **US Navy body fat %** — see §6.5 (from `measurements` + `profiles`)

### Multiple readings per day

Allowed. Charts and trend calculations use the **daily mean** per metric (days bucketed in the profile timezone). History lists show raw entries.

## 5. Screens

Mobile-first. Bottom navigation on phones; sidebar on wide screens.

**Bottom nav:** `Home` · `Trends` · **`＋`** · `Photos` · `More`

1. **Sign in** — email/password or Google (Supabase Auth).
2. **Onboarding** (first sign-in only) — height, sex, date of birth, timezone (auto-detected), optional initial goals (skippable).
3. **Home (dashboard)**
   - Hero row: **fat mass** and **lean mass** — latest trend value + 30-day change, coloured by whether the direction matches the goal.
   - Body fat % and muscle mass cards with 90-day sparklines.
   - Goal progress bars: % complete + projected date or status text.
   - Secondary strip: weight, BMI, waist.
   - Nudges: days since last weigh-in; "no photos in 4 weeks".
4. **＋ Log** (bottom sheet, three tabs)
   - *Weigh-in:* large weight input; "More fields ▾" reveals visible optional scale fields; each shows the last logged value as placeholder. Date/time default to now, editable for backfilling.
   - *Measurements:* tape fields; live US Navy estimate preview when waist + neck (+ hips for female) are present.
   - *Photo:* pick pose, take photo or pick from gallery; translucent overlay of the last photo of the same pose to help alignment.
5. **Trends**
   - Metric picker (raw + derived metrics); range chips `1M · 3M · 6M · 1Y · All`.
   - Chart: raw daily points faint, trend line bold, active goal as dashed line.
   - Overlay mode: two metrics on dual axes; default fat mass vs lean mass.
   - Stats strip: change over range, avg weekly rate, min / max.
6. **Photos**
   - Timeline grid grouped by date, filter by pose.
   - Compare: choose two dates, same pose, drag slider to reveal before/after.
7. **More**
   - History: entries by type with edit / delete.
   - Goals: create / edit / archive / mark achieved.
   - Settings: profile, hidden metrics, sign out.

Visual design (palette, typography, tone) is decided during implementation using the frontend-design skill; charts follow the dataviz skill.

## 6. Calculations

Implemented in a pure-Python `calculations` module (pandas/numpy), independent of HTTP and DB, so it can be unit-tested directly.

### 6.1 Daily bucketing

Convert `measured_at` to the profile timezone, group by local date, mean per metric. Missing values are ignored per metric (a day with only weight contributes nothing to body fat).

### 6.2 Trend (time-aware EWMA)

For daily series `x` on dates `d`:

- `trend₀ = x₀`
- `trendᵢ = trendᵢ₋₁ + a·(xᵢ − trendᵢ₋₁)`, where `a = 1 − (1 − α)^(dᵢ − dᵢ₋₁ in days)`

`α = 0.1` for scale metrics and derived metrics built from them; `α = 0.3` for tape measurements and Navy body fat (sparser data). Gaps therefore give the next reading proportionally more weight.

### 6.3 Change and weekly rate

- **Change over range** = trend at last date in range − trend at first date in range.
- **Weekly rate** = slope of an ordinary least-squares fit over trend values in the last 28 days, × 7. Requires ≥ 4 points spanning ≥ 14 days; otherwise `null`.

### 6.4 Goal projection

Given current trend `c`, target `t`, weekly rate `r`:

- If `r` is `null` → status `insufficient_data` ("Need more data").
- If the goal is reached (`c` at or past `t` in the goal direction) → `reached`.
- If `r` moves away from `t`, or `|r|` is below a per-metric flatness threshold (e.g. 0.05 kg/week, 0.05 %/week) → `not_on_pace`.
- Otherwise → `on_track` with `projected_date = today + (t − c) / r weeks`. If `projected_date` is more than 2 years away → `not_on_pace`.
- Progress % = `(start − c) / (start − t)`, clamped to 0–100.

### 6.5 US Navy body fat (cm, log base 10)

- **Male:** `495 / (1.0324 − 0.19077·log10(waist − neck) + 0.15456·log10(height)) − 450`
- **Female:** `495 / (1.29579 − 0.35004·log10(waist + hips − neck) + 0.22100·log10(height)) − 450`

Computed per measurement entry when required inputs exist; displayed alongside scale body fat. Results outside 2–70% are discarded as invalid input.

### 6.6 Long ranges

For ranges > 1 year, the API returns weekly means of raw points for plotting; trend lines are still computed on the full daily series and then sampled weekly.

## 7. API (FastAPI, JSON, all routes require auth except `/health`)

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness / warm-up |
| `GET /me/profile`, `PUT /me/profile` | Read / upsert profile |
| `GET/POST /body-entries`, `PATCH/DELETE /body-entries/{id}` | CRUD; list supports `from`, `to` |
| `GET/POST /measurements`, `PATCH/DELETE /measurements/{id}` | CRUD |
| `POST /photos/upload-url` | Returns signed upload URL + reserved path |
| `POST /photos` | Create photo record after successful upload (verifies object exists) |
| `GET /photos`, `DELETE /photos/{id}` | List (with signed view URLs) / delete record + object |
| `GET/POST /goals`, `PATCH/DELETE /goals/{id}` | CRUD |
| `GET /series?metric=…&range=…` | Daily points, trend, change, weekly rate for one metric |
| `GET /dashboard` | Aggregated payload for Home (hero cards, sparklines, goal progress, nudges) |

Validation via Pydantic models mirroring DB ranges. Errors use FastAPI's standard shape; 422 responses carry field-level details.

## 8. Error handling

| Situation | Behaviour |
|---|---|
| Invalid input | Client-side validation (zod) with inline messages; server re-validates (Pydantic) and 422 field errors map back onto form fields |
| Expired session | Supabase client refreshes tokens; on 401, redirect to sign-in and return to the previous route afterwards |
| Render cold start | Warm-up ping on load; slow requests show "Waking up server…"; client timeout 60 s |
| Network failure on save | Form retains input; error banner with Retry. No offline queue in v1 |
| Photo upload failure | DB record created only after upload succeeds; Retry offered; unused reserved paths are harmless |
| Insufficient data | Every chart/stat has an explicit empty state explaining what's needed |
| Unexpected server error | Generic message to user; structured server log with request id |

## 9. Testing

Work proceeds test-first (TDD).

- **Backend — pytest**
  - `calculations`: BMI; fat/lean mass; US Navy (male and female reference values); daily bucketing across timezones; EWMA with gaps, single point, duplicate days; weekly rate thresholds; every projection status.
  - API tests with `httpx` against a real Postgres (Docker service in CI): CRUD for each resource, validation errors, and **isolation: user A cannot read, modify or delete user B's data**.
  - Auth: missing/invalid/expired JWT → 401.
- **Frontend — Vitest + React Testing Library:** forms and validation, empty states, dashboard rendering from fixture payloads.
- **End-to-end — Playwright:** log weigh-in → visible on Home and Trends; upload two photos → compare view.
- **CI — GitHub Actions** on every push: ruff + mypy (backend), ESLint + `tsc --noEmit` (frontend), all test suites.

## 10. Future sub-projects (context only, not in scope)

- **Nutrition:** food log, food database, barcode/photo logging, macro & micronutrient targets, adaptive TDEE from intake + weight trend.
- **AI:** body-fat estimate from progress photos + metrics (clearly labelled as an estimate), diet-plan builder, recipe suggestions from available groceries, weekly AI report. AI calls run server-side in FastAPI; costs are per use.
- **Extras:** workout log with volume/PR charts, Apple Health / Google Fit import, correlation insights, water & supplements, CSV export.
