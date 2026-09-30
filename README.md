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
3. The free instance sleeps after 15 minutes idle. The app pings `/health` when it opens and shows "Waking up server…" while the backend starts.

### 3. Frontend on Vercel (or Netlify / Cloudflare Pages)
1. Import the repository with root directory `frontend` and the Vite framework preset.
2. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_URL` (your Render URL).
3. Deploy, open the site on your phone and choose "Add to Home Screen".

## Food data

Food search and barcode lookups go through the backend to [Open Food Facts](https://world.openfoodfacts.org) (packaged foods, barcodes; products sold in Israel rank first by default) and [USDA FoodData Central](https://fdc.nal.usda.gov) (generic foods). A food is cached in the database the first time it's opened or logged, and each log entry keeps a copy of its nutrients, so later edits never change past days.

Open Food Facts data is available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/); the app credits it and links to the product on every food it shows. USDA data is public domain.

The test fixtures in `backend/tests/fixtures/food_sources/` can be refreshed from the live APIs with `python backend/scripts/record_food_fixtures.py`.
