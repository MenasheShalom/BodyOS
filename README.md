# BodyOS

A personal, mobile-first web app for tracking body composition, tape measurements, progress photos and food, with smoothed trends, goal projections and calorie/macro targets.

- `frontend/`: React + Vite PWA (installable on your phone)
- `backend/`: FastAPI (Python) for the API, calculations, signed photo URLs and the food database proxy (Open Food Facts + USDA FoodData Central)
- `supabase/`: database migrations (Postgres tables, row level security, private photo bucket)
- `docs/superpowers/`: design spec and implementation plan

## Local development

Requirements: Python 3.11+, Node 22, Docker.

```bash
# 1. Supabase (Postgres, auth and storage in Docker; applies the migrations)
npx supabase start
npx supabase status          # API URL, anon key, service role key, JWT secret, DB URL

# 2. Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env         # fill in from `supabase status`
uvicorn app.main:app --reload --port 8000

# 3. Frontend
cd ../frontend
npm install
cp .env.example .env.local   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL
npm run dev                  # http://localhost:5173
```

## Tests

```bash
# Backend unit and API tests (uses a throwaway Postgres database)
docker run -d --name bodyos-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bodyos_test -p 5432:5432 postgres:15
cd backend && pytest

# Frontend unit tests
cd frontend && npm test

# End-to-end (needs `npx supabase start` and the backend virtualenv active)
eval "$(npx supabase status -o env | sed 's/^/export /')"
export DATABASE_URL="$DB_URL" SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" SUPABASE_JWT_SECRET="$JWT_SECRET"
export FOOD_SOURCES=fake     # built-in demo foods instead of calling Open Food Facts / USDA
export VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" VITE_API_URL="http://localhost:8000"
cd frontend && npx playwright test
```

CI (`.github/workflows/ci.yml`) runs all three on every push.

## Deploying (all free tiers)

### 1. Supabase
1. Create a project at supabase.com.
2. Link it and push the migrations: `npx supabase link --project-ref <ref>`, then `npx supabase db push`.
3. **Authentication → URL configuration:** set *Site URL* to your frontend URL and add it to *Redirect URLs*.
4. Optional: **Authentication → Providers → Google** to enable Google sign-in.
5. From **Project settings → API**, copy the project URL, the anon (publishable) key, the service role (secret) key, and the legacy JWT secret if your project shows one.
6. From **Connect**, copy the **Session pooler** connection string. Render can't reach the direct connection host, which is IPv6-only.

Free projects pause after about a week without activity; open the dashboard to resume one.

### 2. Backend on Render
1. New → Blueprint → select this repository (it uses `render.yaml`).
2. Set the environment variables: `DATABASE_URL` (session pooler), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (leave empty if your project uses asymmetric JWT keys), `CORS_ORIGINS`, for example `["https://bodyos.vercel.app"]`, and `USDA_API_KEY` (free from https://fdc.nal.usda.gov/api-key-signup; `DEMO_KEY` works but is heavily rate-limited). `OFF_USER_AGENT` identifies the app to Open Food Facts; set it to include a contact email.
3. AI features are off until you choose a provider (see [AI features](#ai-features)).
4. The free instance sleeps after 15 minutes idle. The app pings `/health` when it opens and shows "Waking up server…" while the backend starts.

### 3. Frontend on Vercel (or Netlify / Cloudflare Pages)
1. Import the repository with root directory `frontend` and the Vite framework preset.
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_URL` (your Render URL).
3. Deploy, open the site on your phone and choose "Add to Home Screen".

## Food data

Food search and barcode lookups go through the backend to [Open Food Facts](https://world.openfoodfacts.org) (packaged foods, barcodes; products sold in Israel rank first by default) and [USDA FoodData Central](https://fdc.nal.usda.gov) (generic foods). A food is cached in the database the first time it's opened or logged, and each log entry keeps a copy of its nutrients, so later edits never change past days.

Open Food Facts data is available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/); the app credits it and links to the product on every food it shows. USDA data is public domain.

The test fixtures in `backend/tests/fixtures/food_sources/` can be refreshed from the live APIs with `python backend/scripts/record_food_fixtures.py`.

## How the burn estimate (adaptive TDEE) works

Targets start from a standard estimate: BMR (Katch-McArdle when there's a recent body-fat reading, otherwise Mifflin-St Jeor) × an activity factor. Once there's enough history, the app measures your burn instead, from energy balance:

> burn = average daily intake − weight change per day × 7,700 kcal/kg

- Once a week, on your check-in day, it looks at the 28 days before. It needs at least 14 counted food days and 8 weigh-ins spread over 2 weeks or more.
- **Which days count.** A day isn't counted if it's marked incomplete or holds less than half of that day's calorie target. Half-logged days would otherwise read as eating less.
- **Weight change** is a least-squares slope through the window, so one day of water weight doesn't decide it. Once the weight trend has 2 weeks of history before the window, the slope is fitted to the trend instead of the raw weigh-ins.
- **Smoothing.** Each weekly reading moves the estimate up to 70% of the way from its previous value, less when fewer days were logged. The ± figure is the spread of the last 4 readings.
- **Weekly check-in.** It suggests new targets from the estimate. They only change when you accept or edit them, and each check-in moves calories by at most 150 kcal. Suggestions never go below your BMR or 1,500 kcal (men) / 1,200 kcal (women). They never cut further while you're losing more than 1% of your body weight a week.

Nutrient averages use only the logged foods that report each nutrient. A nutrient reported by under 60% of your food shows "Not enough data" rather than a falsely low number. Reference amounts are the US Dietary Reference Intakes for your sex and age.

## Training

More → **Training** builds a workout program with AI and helps you follow it.

**Setup:**
- **Where you train:** your places and the equipment at each, starting from presets (Gym, Home, Outdoors) and editable. Bodyweight work is always allowed.
- **About your training:** experience, injuries or limits, days per week, minutes per session, and how much cardio you want.

**Building a program.** The AI gets:
- your profile and trend body numbers (weight, body fat, lean mass)
- your nutrition phase and deficit, and your active goals
- your setup and the locations you choose

It returns a multi-week program: the requested number of days, each assigned to one of your locations and using only that location's equipment, plus a daily step target. Each exercise comes with one or two alternatives. Programs are saved; building a new one replaces the active program and keeps your history.

**Using it:**
- Move a day to another location, or swap an exercise to one of its alternatives. No extra AI request is needed.
- **Today's workout** is the next day in rotation. Each set is prefilled from double progression: add a rep each session until every set reaches the top of the range, then add weight (1 kg under 20 kg, 2.5 kg above). Timed holds add 5 seconds.
- Tick each set as you go; a rest timer starts after each one. Finishing records the session (sets and volume).
- Progression follows the exercise name, so it carries over to a new program that uses the same exercises.

## Trophies

More → **Trophies** lists 31 trophies in bronze, silver and gold:
- **Consistency:** weigh-in and food-logging streaks, a weigh-in every week for 12 weeks, protein target on 5 days in a week, calories within 10% on 5 days in a week.
- **Body:** trend weight, waist and body fat below their peak by set amounts, and "Muscle keeper": 2 kg down while lean mass holds.
- **Goals:** halfway to a goal, a goal reached, three goals reached.
- **Habits:** firsts (weigh-in, tape measurement, photo, recipe, weekly report, AI-planned meal) and counts (foods logged, photo weeks, target updates, foods logged from photos).

How they work:
- Trophies are computed from your history, so the first visit backfills everything you'd already earned, dated the day you earned it.
- Body and goal trophies use the smoothed trend, not single readings.
- Once earned, a trophy stays earned, even if a streak later breaks.
- Trophies for metrics you hide in Settings are left out.
- A new trophy gets a full-screen celebration the next time the app loads it. Many at once (like the first backfill) get one summary card instead.
- Celebrations can be switched off per device in Settings, and they don't animate when the phone asks for reduced motion.

The catalogue lives in `backend/app/services/achievement_service.py`. The `achievements` table only stores which trophies were earned, when, and whether their celebration was shown.

## Connect Claude (MCP)

The API is also an MCP server, so Claude (or another AI assistant that supports remote MCP servers) can read your BodyOS data and log for you: "log 2 eggs and toast for breakfast", "how did my protein look this week?".

**Connecting:**
- **Claude app or claude.ai:** add a custom connector at https://claude.ai/customize/connectors with the URL `https://<your-api>.onrender.com/mcp`. Settings → Connected apps shows the exact URL with a copy button.
- **Claude Code:** `claude mcp add --transport http bodyos https://<your-api>.onrender.com/mcp`.
- Claude opens BodyOS in the browser. Sign in, check which app is asking and where you'll be sent back, then tap Allow.
- Settings → Connected apps lists connected assistants and disconnects them.

**Tools:**
- **Reading:** `get_summary`, `get_trend`, `get_food_day`, `get_targets`, `get_trophies`, `search_foods`.
- **Logging:** `log_weigh_in`, `log_food`, `quick_add`, `delete_food_entry`.

They run as you and use the same code as the app, so validation and numbers match.

**Security:**
- **OAuth 2.1:** dynamic client registration, PKCE, short-lived access tokens (1 hour) and rotating refresh tokens (60 days).
- **Stored as hashes:** codes and tokens are kept only as SHA-256 hashes.
- **Locked tables:** the OAuth tables have row level security with no policies, so only the backend can use them.
- **Disconnecting:** deleting a connected app ends its tokens at once.

**Settings (Render):**
- `PUBLIC_API_URL` defaults to Render's `RENDER_EXTERNAL_URL`.
- `APP_URL` (the frontend, where the consent page lives) defaults to the first `CORS_ORIGINS` entry. Set it if that isn't the frontend.
- `MCP_ENABLED=false` turns the server off.
- On Render's free plan the API sleeps when idle, so the first request after a while can take up to a minute.

## AI features

AI features: logging food from a photo, a written weekly report (More → Weekly reports), a rough body-fat range from a day's progress photos (Photos, shown as ranges on Trends), and Nutrition → **Plan with AI**: a day of meals (or the rest of today) aimed at your targets, or recipe ideas from the groceries you have.

In plans and recipes the AI only chooses ingredients and amounts. Each ingredient is matched to a real food (your own and cached foods first, then USDA, then a few Open Food Facts lookups), so the calories and macros come from the food database. Ingredients with no match are flagged and not counted until you pick a food. From there you can swap foods, change amounts, log a meal, save it as a saved meal, or save a recipe with its steps. Your planning preferences (for example "kosher, no fish") are remembered.

The weekly report's numbers are computed by the app (trends, intake against targets, burn, low nutrients, goal projections) and sent to the model as facts; any number in the AI's text that isn't in the facts gets one retry and then a plain template report instead. The backend calls the AI through one small interface, so the vendor is a configuration choice:

| `AI_PROVIDER` | Also set | Notes |
|---|---|---|
| `none` (default) | | Every AI feature is hidden. |
| `anthropic` | `ANTHROPIC_API_KEY` | Claude. `AI_MODEL` is optional (defaults to `claude-opus-5-5`). |
| `google` | `GOOGLE_API_KEY`, `AI_MODEL` | Gemini. `AI_MODEL` is required because Gemini model names change often: use a current model that accepts images and JSON-schema output (a Flash model is a good price/speed balance). |
| `fake` | | Canned answers, for tests and end-to-end runs. |

Optional settings:
- `AI_EFFORT` (`low`/`medium`/`high`, default `medium`) trades answer quality against speed and cost.
- `AI_MONTHLY_REQUEST_LIMIT` (default 300) caps requests per user per calendar month. Requests that fail because the provider is down don't count. Settings → AI shows the usage.

To switch vendor, change the variables on Render and redeploy. Both vendor SDKs are regular dependencies, so nothing else changes. Values are case-insensitive (`Google` works). To check a setup before using it in the app, run one real request from `backend/`:

```bash
AI_PROVIDER=google GOOGLE_API_KEY=... AI_MODEL=... python scripts/ai_smoke.py meal.jpg
```

**Privacy:**
- Nothing is sent to the AI unless you start it: you choose the food photo, open the week's report, tap "Estimate body fat" on a day of progress photos, ask for a meal plan (your targets and preferences are sent) or recipes (your grocery list is sent), or build a training program (your profile, body trends, goals, training setup and noted injuries are sent). The first use of each feature shows a notice naming the provider and what is sent.
- Food photos are resized in the browser (which also drops location metadata), sent to the provider, and never stored by BodyOS.
- AI answers are drafts: nothing is logged until you review it and tap Log, and estimates are tagged "AI estimate" in the day view.
- AI can be switched off per user in Settings.

