# BodyOS Foundation + Body Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first installable web app where one user logs scale readings, tape measurements and progress photos, sets recomposition goals, and sees smoothed trends, weekly rates and goal projections.

**Architecture:** A React + Vite PWA talks to Supabase only for sign-in; every data call goes to a FastAPI backend with the Supabase JWT. FastAPI verifies the token, is the only component that reads/writes Postgres, owns every calculation (BMI, fat/lean mass, US Navy body fat, EWMA trends, weekly rates, goal projections), and issues signed URLs for a private Supabase Storage bucket.

**Tech Stack:** Python 3.11+ · FastAPI · Pydantic v2 · psycopg 3 · PyJWT · httpx · pytest · ruff · mypy — React 19 · TypeScript · Vite · Tailwind CSS v4 · TanStack Query · React Router · react-hook-form + zod · Recharts · supabase-js · vite-plugin-pwa · Vitest + Testing Library · Playwright — Supabase (Postgres, Auth, Storage) · Render · GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-25-bodyos-foundation-body-tracking-design.md`

## Global Constraints

- Single user per account; every query is scoped to the JWT's `sub` (user id). A user must never read, modify or delete another user's rows or photos.
- Metric units only: kg, cm, %, kcal. No unit conversion code.
- `weight_kg` is the only required scale field; every other scale field is optional.
- Derived values (BMI, fat mass, lean mass, US Navy body fat, trends, rates, projections) are **computed in the backend, never stored**.
- Validation ranges (copied from spec §4): weight 20–400; body fat 2–70; muscle mass 5–200; skeletal muscle 5–80; body water 20–80; bone mass 0.5–10; visceral fat 1–60; protein 5–30; BMR 500–5000; metabolic age 10–100; each tape measurement 10–250; height 100–250; notes ≤ 500 chars.
- Trend: time-aware EWMA, `α = 0.1` for scale-derived metrics, `α = 0.3` for tape measurements and Navy body fat.
- Weekly rate: OLS slope over the last 28 days of trend × 7; needs ≥ 4 points spanning ≥ 14 days, else `null`.
- Projection beyond 2 years (730 days) → `not_on_pace`.
- Ranges longer than 1 year are plotted as weekly means (raw) / weekly last value (trend).
- Photos: private bucket `progress-photos`, path `{user_id}/{photo_id}.jpg`, resized client-side to max 1600 px long edge, JPEG quality 0.85. DB row created only after the upload is verified.
- Client request timeout 60 s; show "Waking up server…" after 3 s; `GET /health` warm-up ping on app load.
- Secrets never committed. `.env.example` files document every variable.
- Free tiers only: Supabase free, Render free web service, free static hosting.
- Deliberate deviation from spec §6: calculations use the Python standard library instead of pandas/numpy. The maths is small, and this keeps the Render image light. pandas can arrive with the nutrition/insights sub-projects.
- Deliberate deviation from spec §5: onboarding step 2 is the first weigh-in, not initial goals. A goal's start value comes from the current trend, so goals need data first; Home prompts for a goal once data exists (Task 17, Task 20).
- Enum-like columns (`sex`, `pose`, `metric`, `status`) are `text` with `check` constraints, not Postgres enum types. This avoids driver casting issues and keeps migrations simple.

## Review Focus

1. **Late-night weigh-ins near midnight** (e.g. 23:30 local = 21:30 UTC). They must land on the user's local day, not the UTC day. Pinned in Task 3 (`daily_means` timezone test) and Task 9 (series uses profile timezone).
2. **Backfilled / out-of-order entries.** Logging last Tuesday's reading today must slot into the trend by date, not insertion order. Pinned in Task 9 (`test_series_orders_backfilled_entries`).
3. **Editing or deleting an entry.** Trends and dashboard must reflect the change immediately (server recomputes; client invalidates caches). Pinned in Task 9 (`test_series_reflects_deleted_entry`) and Task 14 (`queries.test.tsx`: mutations invalidate `series`/`dashboard`/`goals`).
4. **Changing height in Settings.** BMI and Navy body fat for *all history* must update, since nothing derived is stored. Pinned in Task 9 (`test_bmi_uses_current_height`).
5. **Session expiring while the app is open** (phone left idle overnight). The next request must send the user to sign-in and back to where they were, not show a broken screen. Pinned in Task 14 (`api` 401 handler test) and Task 15 (`RequireAuth` redirect test, `safeNext`).

---

## File Structure

```
BodyOS/
  .github/workflows/ci.yml            CI: backend lint/type/test with Postgres; frontend lint/type/test; e2e
  .gitignore
  README.md                           setup, local dev, deploy
  render.yaml                         Render blueprint for the API
  supabase/
    config.toml                       generated by `supabase init`
    migrations/
      20260925000001_body_tracking.sql   tables, checks, indexes, triggers, RLS
      20260925000002_photo_bucket.sql    private storage bucket
  backend/
    pyproject.toml                    deps + ruff/mypy/pytest config
    .env.example
    app/
      __init__.py
      main.py                         create_app(): CORS, request-id logging, error handler, routers
      config.py                       Settings (pydantic-settings), get_settings()
      clock.py                        get_now() dependency (overridable in tests)
      db.py                           get_conn() dependency (psycopg, dict rows)
      auth.py                         decode_token(), current_user_id dependency
      crud.py                         generic user-scoped insert/list/get/update/delete
      profiles.py                     load_profile()
      schemas.py                      Pydantic request/response models
      metrics.py                      metric registry + load_readings()
      storage.py                      PhotoStorage protocol + SupabaseStorage + get_storage
      calculations/
        __init__.py
        body.py                       bmi, fat/lean mass, navy body fat
        series.py                     Point, daily_means, ewma_trend, weekly_rate, change, weekly buckets
        goals.py                      GoalProjection, project_goal
      services/
        __init__.py
        series_service.py             build_series() for one metric + range
        goal_service.py               goal_with_projection()
        dashboard_service.py          build_dashboard()
      routers/
        __init__.py
        profile.py  body_entries.py  measurements.py  photos.py  goals.py  series.py  dashboard.py
    tests/
      conftest.py                     DB harness, tokens, client, fake storage
      sql/supabase_shim.sql           auth/storage schema stand-ins for plain Postgres
      test_health.py  test_calc_body.py  test_calc_series.py  test_calc_goals.py
      test_migrations.py  test_auth_profile.py  test_body_entries.py  test_measurements.py
      test_series_api.py  test_goals_api.py  test_photos_api.py  test_dashboard_api.py
  frontend/
    package.json  vite.config.ts  tsconfig*.json  eslint.config.js  index.html  .env.example
    playwright.config.ts
    public/icon.svg
    e2e/global-setup.ts  e2e/flows.spec.ts   (global setup writes e2e/.user.json, git-ignored)
    src/
      main.tsx  App.tsx  index.css
      test/setup.ts
      lib/env.ts  lib/supabase.ts  lib/api.ts  lib/types.ts  lib/metrics.ts
      lib/format.ts  lib/forms.ts  lib/image.ts  lib/photos.ts  lib/queries.ts  lib/chart.ts
      auth/AuthProvider.tsx  auth/RequireAuth.tsx  auth/RequireProfile.tsx
      components/AppLayout.tsx  components/WakingBanner.tsx  components/LogSheet.tsx
      components/Field.tsx  components/EmptyState.tsx  components/StatCard.tsx
      components/CompareSlider.tsx  components/GoalProgress.tsx  components/Modal.tsx
      components/charts/TrendChart.tsx  components/charts/Sparkline.tsx
      forms/ProfileForm.tsx  forms/WeighInForm.tsx  forms/MeasurementForm.tsx  forms/PhotoForm.tsx  forms/GoalForm.tsx
      pages/SignIn.tsx  pages/Onboarding.tsx  pages/Home.tsx  pages/Trends.tsx  pages/Photos.tsx
      pages/PhotoCompare.tsx  pages/History.tsx  pages/Goals.tsx  pages/Settings.tsx  pages/More.tsx
      (tests live next to files as *.test.ts / *.test.tsx)
```

Conventions:
- Backend commands run from `backend/` inside a virtualenv (`python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"`).
- Frontend commands run from `frontend/`.
- A Postgres for backend tests: `docker run -d --name bodyos-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bodyos_test -p 5432:5432 postgres:15`. Tests read `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/bodyos_test`).
- Commit after every task with the message shown.

---

## Phase A — Backend

### Task 1: Backend scaffold, health endpoint, error handling, CI

**Files:**
- Create: `.gitignore`, `backend/pyproject.toml`, `backend/.env.example`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/main.py`, `backend/tests/__init__.py`, `backend/tests/test_health.py`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `app.config.Settings` (fields `database_url`, `supabase_url`, `supabase_service_role_key`, `supabase_jwt_secret`, `cors_origins`, `photo_bucket`), `app.config.get_settings() -> Settings`, `app.main.create_app() -> FastAPI`, `app.main.app`. Unhandled exceptions return `500 {"detail": "Something went wrong", "request_id": "<uuid>"}`; every response carries an `X-Request-ID` header.

- [ ] **Step 1: Create repo-level `.gitignore`**

```gitignore
# Python
__pycache__/
*.pyc
.venv/
.pytest_cache/
.mypy_cache/
.ruff_cache/
*.egg-info/
# Node
node_modules/
dist/
dev-dist/
playwright-report/
test-results/
# Env
.env
.env.local
# Supabase
supabase/.branches/
supabase/.temp/
```

- [ ] **Step 2: Create `backend/pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "bodyos-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.8",
  "pydantic-settings>=2.4",
  "psycopg[binary]>=3.2",
  "pyjwt[crypto]>=2.9",
  "httpx>=0.27",
  "tzdata>=2024.1",
]

[project.optional-dependencies]
dev = ["pytest>=8", "ruff>=0.6", "mypy>=1.11"]

[tool.setuptools.packages.find]
include = ["app*"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
# The formatter enforces line length; long string literals are allowed.
ignore = ["E501"]

[tool.ruff.lint.flake8-bugbear]
extend-immutable-calls = ["fastapi.Depends", "fastapi.Query"]

[tool.mypy]
python_version = "3.11"
strict = true
plugins = ["pydantic.mypy"]
```

- [ ] **Step 3: Create `backend/.env.example`**

```dotenv
# Postgres connection. On Render use the Supabase *Session pooler* URL (IPv4), not the direct URL.
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
# Service role key: backend only, never ship to the frontend.
SUPABASE_SERVICE_ROLE_KEY=
# Legacy HS256 JWT secret. Leave empty if your project signs tokens with asymmetric keys (JWKS is used then).
SUPABASE_JWT_SECRET=
# JSON list
CORS_ORIGINS=["http://localhost:5173"]
PHOTO_BUCKET=progress-photos
```

- [ ] **Step 4: Write the failing tests `backend/tests/test_health.py`** (also create empty `backend/tests/__init__.py` and `backend/app/__init__.py`)

```python
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_ok() -> None:
    client = TestClient(create_app())
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert res.headers["X-Request-ID"]


def test_unhandled_error_returns_generic_500_with_request_id() -> None:
    app = create_app()

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret internals")

    client = TestClient(app, raise_server_exceptions=False)
    res = client.get("/boom")
    assert res.status_code == 500
    body = res.json()
    assert body["detail"] == "Something went wrong"
    assert "secret" not in res.text
    assert body["request_id"] == res.headers["X-Request-ID"]
```

- [ ] **Step 5: Run to verify failure**

Run: `cd backend && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && pytest tests/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 6: Implement `backend/app/config.py`**

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/bodyos_test"
    supabase_url: str = "http://127.0.0.1:54321"
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str | None = None
    cors_origins: list[str] = ["http://localhost:5173"]
    photo_bucket: str = "progress-photos"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 7: Implement `backend/app/main.py`**

```python
import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings

logger = logging.getLogger("bodyos")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="BodyOS API")

    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("Unhandled error request_id=%s path=%s", request_id, request.url.path)
            response = JSONResponse(
                status_code=500,
                content={"detail": "Something went wrong", "request_id": request_id},
            )
        response.headers["X-Request-ID"] = request_id
        return response

    # CORS is added last so it wraps everything, including error responses.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pytest tests/test_health.py -v`
Expected: 2 passed

- [ ] **Step 9: Lint and type-check**

Run: `ruff check . && ruff format --check . && mypy app`
Expected: no errors (run `ruff format .` first if the format check complains).

- [ ] **Step 10: Create `.github/workflows/ci.yml`** (backend job; later tasks add jobs)

```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: bodyos_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      TEST_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/bodyos_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - run: ruff check .
      - run: ruff format --check .
      - run: mypy app
      - run: pytest -v
```

- [ ] **Step 11: Commit**

```bash
git add .gitignore backend .github
git commit -m "feat(backend): scaffold FastAPI app with health check, request ids and CI"
```

---

### Task 2: Body calculations (BMI, fat/lean mass, US Navy)

**Files:**
- Create: `backend/app/calculations/__init__.py` (empty), `backend/app/calculations/body.py`
- Test: `backend/tests/test_calc_body.py`

**Interfaces:**
- Produces:
  - `Sex = Literal["male", "female"]`
  - `bmi(weight_kg: float, height_cm: float) -> float` (1 decimal)
  - `fat_mass_kg(weight_kg: float, body_fat_pct: float) -> float` (2 decimals)
  - `lean_mass_kg(weight_kg: float, body_fat_pct: float) -> float` (2 decimals)
  - `navy_body_fat_pct(sex: Sex, height_cm: float, waist_cm: float, neck_cm: float, hips_cm: float | None = None) -> float | None` (1 decimal; `None` when inputs are missing, the log argument is ≤ 0, or the result is outside 2–70)

- [ ] **Step 1: Write failing tests `backend/tests/test_calc_body.py`**

```python
import pytest

from app.calculations.body import bmi, fat_mass_kg, lean_mass_kg, navy_body_fat_pct


def test_bmi() -> None:
    assert bmi(80, 180) == 24.7


def test_fat_and_lean_mass() -> None:
    assert fat_mass_kg(80, 20) == 16.0
    assert lean_mass_kg(80, 20) == 64.0
    assert fat_mass_kg(82.4, 18.3) == 15.08
    assert lean_mass_kg(82.4, 18.3) == 67.32


def test_navy_male_reference() -> None:
    # 180 cm, waist 85, neck 38 -> ~16.1 %
    assert navy_body_fat_pct("male", 180, 85, 38) == pytest.approx(16.1, abs=0.15)


def test_navy_female_reference() -> None:
    # 165 cm, waist 70, hips 95, neck 32 -> ~24.9 %
    assert navy_body_fat_pct("female", 165, 70, 32, hips_cm=95) == pytest.approx(24.9, abs=0.15)


def test_navy_female_requires_hips() -> None:
    assert navy_body_fat_pct("female", 165, 70, 32) is None


def test_navy_invalid_geometry_returns_none() -> None:
    assert navy_body_fat_pct("male", 180, 38, 40) is None  # waist <= neck


def test_navy_out_of_range_result_returns_none() -> None:
    # Absurd waist produces > 70 %
    assert navy_body_fat_pct("male", 150, 240, 30) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_calc_body.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.calculations'`

- [ ] **Step 3: Implement `backend/app/calculations/body.py`**

```python
import math
from typing import Literal

Sex = Literal["male", "female"]


def bmi(weight_kg: float, height_cm: float) -> float:
    meters = height_cm / 100
    return round(weight_kg / (meters * meters), 1)


def fat_mass_kg(weight_kg: float, body_fat_pct: float) -> float:
    return round(weight_kg * body_fat_pct / 100, 2)


def lean_mass_kg(weight_kg: float, body_fat_pct: float) -> float:
    return round(weight_kg - weight_kg * body_fat_pct / 100, 2)


def navy_body_fat_pct(
    sex: Sex,
    height_cm: float,
    waist_cm: float,
    neck_cm: float,
    hips_cm: float | None = None,
) -> float | None:
    """US Navy circumference method, metric (cm), log base 10."""
    if sex == "male":
        girth = waist_cm - neck_cm
        if girth <= 0:
            return None
        value = (
            495 / (1.0324 - 0.19077 * math.log10(girth) + 0.15456 * math.log10(height_cm)) - 450
        )
    else:
        if hips_cm is None:
            return None
        girth = waist_cm + hips_cm - neck_cm
        if girth <= 0:
            return None
        value = (
            495 / (1.29579 - 0.35004 * math.log10(girth) + 0.22100 * math.log10(height_cm)) - 450
        )
    if not 2 <= value <= 70:
        return None
    return round(value, 1)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_calc_body.py -v`
Expected: 7 passed. If `test_navy_out_of_range_result_returns_none` fails because the value is ≤ 70, raise the waist in the test until the formula exceeds 70. The guard is what's being tested, not the specific inputs.

- [ ] **Step 5: Commit**

```bash
git add backend/app/calculations backend/tests/test_calc_body.py
git commit -m "feat(backend): add BMI, fat/lean mass and US Navy body fat calculations"
```

---

### Task 3: Series calculations (daily bucketing, EWMA trend, weekly rate, change, weekly buckets)

**Files:**
- Create: `backend/app/calculations/series.py`
- Test: `backend/tests/test_calc_series.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Point: day: date; value: float`
  - `daily_means(readings: Iterable[tuple[datetime, float]], tz: ZoneInfo) -> list[Point]`: sorted by day, mean per local day
  - `ewma_trend(points: Sequence[Point], alpha: float) -> list[Point]`: expects points sorted by day (as `daily_means` returns)
  - `weekly_rate(trend: Sequence[Point], today: date, window_days: int = 28, min_points: int = 4, min_span_days: int = 14) -> float | None`
  - `change(points: Sequence[Point]) -> float | None`: last − first; `None` if fewer than 2 points
  - `weekly_means(points: Sequence[Point]) -> list[Point]`: keyed by the Monday of each week
  - `weekly_last(points: Sequence[Point]) -> list[Point]`: last value of each week, keyed by Monday

- [ ] **Step 1: Write failing tests `backend/tests/test_calc_series.py`**

```python
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.calculations.series import (
    Point,
    change,
    daily_means,
    ewma_trend,
    weekly_last,
    weekly_means,
    weekly_rate,
)

JERUSALEM = ZoneInfo("Asia/Jerusalem")


def test_daily_means_uses_local_day() -> None:
    # 23:30 UTC on Jan 1 is 01:30 on Jan 2 in Jerusalem (UTC+2)
    readings = [
        (datetime(2026, 1, 1, 23, 30, tzinfo=UTC), 80.0),
        (datetime(2026, 1, 2, 6, 0, tzinfo=UTC), 81.0),
        (datetime(2026, 1, 1, 8, 0, tzinfo=UTC), 79.0),
    ]
    assert daily_means(readings, JERUSALEM) == [
        Point(date(2026, 1, 1), 79.0),
        Point(date(2026, 1, 2), 80.5),
    ]


def test_daily_means_empty() -> None:
    assert daily_means([], JERUSALEM) == []


def test_ewma_consecutive_days() -> None:
    pts = [Point(date(2026, 1, 1), 100.0), Point(date(2026, 1, 2), 90.0)]
    trend = ewma_trend(pts, alpha=0.1)
    assert trend[0].value == 100.0
    assert trend[1].value == pytest.approx(99.0)


def test_ewma_gap_gives_more_weight() -> None:
    pts = [Point(date(2026, 1, 1), 100.0), Point(date(2026, 1, 6), 90.0)]
    trend = ewma_trend(pts, alpha=0.1)
    # a = 1 - 0.9**5 = 0.40951
    assert trend[1].value == pytest.approx(95.9049, abs=1e-4)


def test_ewma_single_and_empty() -> None:
    assert ewma_trend([], 0.1) == []
    assert ewma_trend([Point(date(2026, 1, 1), 70.0)], 0.1) == [Point(date(2026, 1, 1), 70.0)]


def _line(start: date, days: int, first: float, per_day: float) -> list[Point]:
    return [Point(start + timedelta(days=i), first + per_day * i) for i in range(days)]


def test_weekly_rate_linear() -> None:
    today = date(2026, 3, 1)
    trend = _line(today - timedelta(days=20), 21, 80.0, -0.1)
    assert weekly_rate(trend, today) == pytest.approx(-0.7)


def test_weekly_rate_ignores_points_older_than_window() -> None:
    today = date(2026, 3, 1)
    old = _line(today - timedelta(days=100), 10, 50.0, 5.0)  # steep, old
    recent = _line(today - timedelta(days=20), 21, 80.0, -0.1)
    assert weekly_rate(old + recent, today) == pytest.approx(-0.7)


def test_weekly_rate_needs_four_points() -> None:
    today = date(2026, 3, 1)
    trend = [Point(today - timedelta(days=d), 80.0) for d in (20, 10, 0)]
    assert weekly_rate(trend, today) is None


def test_weekly_rate_needs_fourteen_day_span() -> None:
    today = date(2026, 3, 1)
    trend = _line(today - timedelta(days=9), 10, 80.0, -0.1)
    assert weekly_rate(trend, today) is None


def test_change() -> None:
    assert change([]) is None
    assert change([Point(date(2026, 1, 1), 5.0)]) is None
    assert change([Point(date(2026, 1, 1), 5.0), Point(date(2026, 1, 9), 3.5)]) == -1.5


def test_weekly_means_and_last() -> None:
    # 2026-01-05 is a Monday
    pts = [
        Point(date(2026, 1, 5), 10.0),
        Point(date(2026, 1, 7), 20.0),
        Point(date(2026, 1, 12), 30.0),
    ]
    assert weekly_means(pts) == [Point(date(2026, 1, 5), 15.0), Point(date(2026, 1, 12), 30.0)]
    assert weekly_last(pts) == [Point(date(2026, 1, 5), 20.0), Point(date(2026, 1, 12), 30.0)]
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_calc_series.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.calculations.series'`

- [ ] **Step 3: Implement `backend/app/calculations/series.py`**

```python
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Point:
    day: date
    value: float


def daily_means(readings: Iterable[tuple[datetime, float]], tz: ZoneInfo) -> list[Point]:
    buckets: dict[date, list[float]] = defaultdict(list)
    for measured_at, value in readings:
        buckets[measured_at.astimezone(tz).date()].append(value)
    return [Point(day, sum(vals) / len(vals)) for day, vals in sorted(buckets.items())]


def ewma_trend(points: Sequence[Point], alpha: float) -> list[Point]:
    """Time-aware EWMA: after a gap of n days, the new reading gets weight 1-(1-alpha)^n."""
    if not points:
        return []
    trend = [Point(points[0].day, points[0].value)]
    for point in points[1:]:
        prev = trend[-1]
        gap_days = (point.day - prev.day).days
        weight = 1 - (1 - alpha) ** gap_days
        trend.append(Point(point.day, prev.value + weight * (point.value - prev.value)))
    return trend


def weekly_rate(
    trend: Sequence[Point],
    today: date,
    window_days: int = 28,
    min_points: int = 4,
    min_span_days: int = 14,
) -> float | None:
    """Least-squares slope of trend values in the last `window_days`, per week."""
    cutoff = today - timedelta(days=window_days)
    recent = [p for p in trend if cutoff < p.day <= today]
    if len(recent) < min_points:
        return None
    if (recent[-1].day - recent[0].day).days < min_span_days:
        return None
    xs = [float((p.day - recent[0].day).days) for p in recent]
    ys = [p.value for p in recent]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    sxx = sum((x - mean_x) ** 2 for x in xs)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys, strict=True))
    return sxy / sxx * 7


def change(points: Sequence[Point]) -> float | None:
    if len(points) < 2:
        return None
    return points[-1].value - points[0].value


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def weekly_means(points: Sequence[Point]) -> list[Point]:
    buckets: dict[date, list[float]] = defaultdict(list)
    for p in points:
        buckets[_week_start(p.day)].append(p.value)
    return [Point(week, sum(vals) / len(vals)) for week, vals in sorted(buckets.items())]


def weekly_last(points: Sequence[Point]) -> list[Point]:
    last: dict[date, float] = {}
    for p in sorted(points, key=lambda p: p.day):
        last[_week_start(p.day)] = p.value
    return [Point(week, value) for week, value in sorted(last.items())]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_calc_series.py -v`
Expected: 11 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/calculations/series.py backend/tests/test_calc_series.py
git commit -m "feat(backend): add daily bucketing, EWMA trend and weekly rate calculations"
```

---

### Task 4: Goal projection

**Files:**
- Create: `backend/app/calculations/goals.py`
- Test: `backend/tests/test_calc_goals.py`

**Interfaces:**
- Produces:
  - `ProjectionState = Literal["insufficient_data", "reached", "not_on_pace", "on_track"]`
  - `@dataclass(frozen=True) class GoalProjection: state: ProjectionState; progress_pct: float | None; projected_date: date | None`
  - `project_goal(start: float, target: float, current: float | None, rate_per_week: float | None, today: date, flat_threshold: float, max_horizon_days: int = 730) -> GoalProjection`
- Rule order: no current value → `insufficient_data`; at or past target → `reached`; no rate → `insufficient_data`; moving away from target, or `|rate| < flat_threshold` → `not_on_pace`; ETA beyond horizon → `not_on_pace`; else `on_track`. (Spec §6.4 lists "rate null" first. `reached` is checked first here so that a goal the user has already hit reads as reached, even with sparse data.)

- [ ] **Step 1: Write failing tests `backend/tests/test_calc_goals.py`**

```python
from datetime import date

from app.calculations.goals import project_goal

TODAY = date(2026, 3, 1)


def test_on_track_projects_date_and_progress() -> None:
    p = project_goal(20, 15, 18, -0.5, TODAY, flat_threshold=0.05)
    assert p.state == "on_track"
    assert p.progress_pct == 40.0
    assert p.projected_date == date(2026, 4, 12)  # 4 kg / 0.5 per week = 6 weeks = 42 days


def test_upward_goal_on_track() -> None:
    p = project_goal(60, 64, 61, 0.25, TODAY, flat_threshold=0.05)
    assert p.state == "on_track"
    assert p.progress_pct == 25.0
    assert p.projected_date == date(2026, 5, 24)  # 3 / 0.25 = 12 weeks


def test_reached_even_without_rate() -> None:
    p = project_goal(20, 15, 14.8, None, TODAY, flat_threshold=0.05)
    assert p.state == "reached"
    assert p.progress_pct == 100.0
    assert p.projected_date is None


def test_no_current_value() -> None:
    p = project_goal(20, 15, None, None, TODAY, flat_threshold=0.05)
    assert p.state == "insufficient_data"
    assert p.progress_pct is None


def test_no_rate_is_insufficient_but_keeps_progress() -> None:
    p = project_goal(20, 15, 19, None, TODAY, flat_threshold=0.05)
    assert p.state == "insufficient_data"
    assert p.progress_pct == 20.0


def test_moving_away_is_not_on_pace() -> None:
    p = project_goal(20, 15, 19, 0.3, TODAY, flat_threshold=0.05)
    assert p.state == "not_on_pace"
    assert p.projected_date is None


def test_flat_is_not_on_pace() -> None:
    p = project_goal(20, 15, 19, -0.01, TODAY, flat_threshold=0.05)
    assert p.state == "not_on_pace"


def test_beyond_two_years_is_not_on_pace() -> None:
    p = project_goal(20, 10, 19, -0.06, TODAY, flat_threshold=0.05)  # 150 weeks
    assert p.state == "not_on_pace"


def test_progress_clamped_when_going_backwards() -> None:
    p = project_goal(20, 15, 21, 0.2, TODAY, flat_threshold=0.05)
    assert p.progress_pct == 0.0
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_calc_goals.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement `backend/app/calculations/goals.py`**

```python
import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

ProjectionState = Literal["insufficient_data", "reached", "not_on_pace", "on_track"]


@dataclass(frozen=True)
class GoalProjection:
    state: ProjectionState
    progress_pct: float | None
    projected_date: date | None


def _progress(start: float, target: float, current: float) -> float:
    if start == target:
        return 100.0
    pct = (start - current) / (start - target) * 100
    return round(max(0.0, min(100.0, pct)), 1)


def project_goal(
    start: float,
    target: float,
    current: float | None,
    rate_per_week: float | None,
    today: date,
    flat_threshold: float,
    max_horizon_days: int = 730,
) -> GoalProjection:
    if current is None:
        return GoalProjection("insufficient_data", None, None)

    progress = _progress(start, target, current)
    direction = 1 if target > start else -1
    if start == target or (current - target) * direction >= 0:
        return GoalProjection("reached", 100.0, None)
    if rate_per_week is None:
        return GoalProjection("insufficient_data", progress, None)
    if rate_per_week * direction <= 0 or abs(rate_per_week) < flat_threshold:
        return GoalProjection("not_on_pace", progress, None)

    days = math.ceil((target - current) / rate_per_week * 7)
    if days > max_horizon_days:
        return GoalProjection("not_on_pace", progress, None)
    return GoalProjection("on_track", progress, today + timedelta(days=days))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_calc_goals.py -v`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/calculations/goals.py backend/tests/test_calc_goals.py
git commit -m "feat(backend): add goal projection calculation"
```

---
### Task 5: Database schema, RLS and test harness

**Files:**
- Create: `supabase/config.toml` (generated), `supabase/migrations/20260925000001_body_tracking.sql`, `supabase/migrations/20260925000002_photo_bucket.sql`, `backend/tests/sql/supabase_shim.sql`, `backend/tests/conftest.py`
- Test: `backend/tests/test_migrations.py`

**Interfaces:**
- Produces tables `public.profiles`, `public.body_entries`, `public.measurements`, `public.progress_photos`, `public.goals` (columns exactly as in the migration below). Every table except `profiles` has `id uuid` PK, `user_id`, `created_at`, `updated_at`.
- Produces pytest fixtures in `tests/conftest.py`: `migrated_db -> str` (session, DB URL), `db -> str` (truncates all tables, returns DB URL), `make_user -> Callable[[], uuid.UUID]` (inserts into `auth.users`).

- [ ] **Step 1: Initialise the Supabase project folder**

Run (repo root): `npx --yes supabase@latest init` (answer `N` to the IDE-settings prompts).
Expected: `supabase/config.toml` created. Then open `supabase/config.toml` and confirm `[auth.email] enable_confirmations = false` (the default). E2E tests in Task 22 rely on signing up without email confirmation locally.

- [ ] **Step 2: Write the test shim `backend/tests/sql/supabase_shim.sql`**

Plain Postgres has no `auth` or `storage` schemas. This shim recreates the tiny subset the migrations reference.

```sql
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema auth to authenticated;
grant usage on schema public to authenticated;
alter default privileges in schema public grant all on tables to authenticated;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);
```

- [ ] **Step 3: Write `backend/tests/conftest.py`**

```python
import os
import pathlib
import uuid
from collections.abc import Callable, Iterator

import psycopg
import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
SHIM = pathlib.Path(__file__).parent / "sql" / "supabase_shim.sql"
TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/bodyos_test"
)
TABLES = ["goals", "progress_photos", "measurements", "body_entries", "profiles"]


@pytest.fixture(scope="session")
def migrated_db() -> str:
    with psycopg.connect(TEST_DB_URL, autocommit=True) as conn:
        conn.execute(
            "drop schema if exists public cascade;"
            " drop schema if exists auth cascade;"
            " drop schema if exists storage cascade;"
            " create schema public;"
        )
        conn.execute(SHIM.read_text())
        for migration in MIGRATIONS:
            conn.execute(migration.read_text())
    return TEST_DB_URL


@pytest.fixture
def db(migrated_db: str) -> Iterator[str]:
    with psycopg.connect(migrated_db, autocommit=True) as conn:
        tables = ", ".join(f"public.{t}" for t in TABLES)
        conn.execute(f"truncate {tables}, auth.users cascade")
    yield migrated_db


@pytest.fixture
def make_user(db: str) -> Callable[[], uuid.UUID]:
    def _make() -> uuid.UUID:
        user_id = uuid.uuid4()
        with psycopg.connect(db, autocommit=True) as conn:
            conn.execute("insert into auth.users (id) values (%s)", (user_id,))
        return user_id

    return _make
```

- [ ] **Step 4: Write failing tests `backend/tests/test_migrations.py`**

```python
from decimal import Decimal

import psycopg
import pytest


def test_weight_out_of_range_rejected(db, make_user) -> None:
    uid = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into body_entries (user_id, measured_at, weight_kg) values (%s, now(), 800)",
            (uid,),
        )


def test_measurement_requires_at_least_one_value(db, make_user) -> None:
    uid = make_user()
    with psycopg.connect(db) as conn, pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(
            "insert into measurements (user_id, measured_at) values (%s, now())", (uid,)
        )


def test_one_active_goal_per_metric(db, make_user) -> None:
    uid = make_user()
    sql = (
        "insert into goals (user_id, metric, start_value, target_value, start_date, status)"
        " values (%s, 'body_fat_pct', 20, 15, current_date, %s)"
    )
    with psycopg.connect(db) as conn:
        conn.execute(sql, (uid, "active"))
        conn.execute(sql, (uid, "archived"))  # archived duplicates are fine
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute(sql, (uid, "active"))


def test_rls_hides_other_users_rows(db, make_user) -> None:
    a, b = make_user(), make_user()
    with psycopg.connect(db) as conn:
        conn.execute(
            "insert into body_entries (user_id, measured_at, weight_kg)"
            " values (%s, now(), 80), (%s, now(), 90)",
            (a, b),
        )
        conn.execute("set local role authenticated")
        conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(a),))
        rows = conn.execute("select weight_kg from body_entries").fetchall()
    assert [r[0] for r in rows] == [Decimal("80.00")]


def test_updated_at_trigger(db, make_user) -> None:
    uid = make_user()
    with psycopg.connect(db, autocommit=True) as conn:
        row = conn.execute(
            "insert into body_entries (user_id, measured_at, weight_kg, updated_at)"
            " values (%s, now(), 80, now() - interval '1 day') returning id, updated_at",
            (uid,),
        ).fetchone()
        assert row is not None
        after = conn.execute(
            "update body_entries set weight_kg = 81 where id = %s returning updated_at", (row[0],)
        ).fetchone()
    assert after is not None and after[0] > row[1]


def test_photo_bucket_is_private(db) -> None:
    with psycopg.connect(db) as conn:
        row = conn.execute(
            "select public from storage.buckets where id = 'progress-photos'"
        ).fetchone()
    assert row == (False,)
```

- [ ] **Step 5: Run to verify failure**

Run: start Postgres (see Conventions), then `pytest tests/test_migrations.py -v`
Expected: FAIL. With no migration files yet, inserts fail with `UndefinedTable: relation "body_entries" does not exist`.

- [ ] **Step 6: Write `supabase/migrations/20260925000001_body_tracking.sql`**

```sql
-- BodyOS sub-project 1: body tracking schema

create or replace function public.set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  height_cm numeric(5,1) not null check (height_cm between 100 and 250),
  sex text not null check (sex in ('male', 'female')),
  date_of_birth date not null,
  timezone text not null default 'UTC',
  hidden_metrics text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.body_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  measured_at timestamptz not null,
  weight_kg numeric(5,2) not null check (weight_kg between 20 and 400),
  body_fat_pct numeric(4,1) check (body_fat_pct between 2 and 70),
  muscle_mass_kg numeric(5,2) check (muscle_mass_kg between 5 and 200),
  skeletal_muscle_pct numeric(4,1) check (skeletal_muscle_pct between 5 and 80),
  body_water_pct numeric(4,1) check (body_water_pct between 20 and 80),
  bone_mass_kg numeric(4,2) check (bone_mass_kg between 0.5 and 10),
  visceral_fat numeric(4,1) check (visceral_fat between 1 and 60),
  protein_pct numeric(4,1) check (protein_pct between 5 and 30),
  bmr_kcal integer check (bmr_kcal between 500 and 5000),
  metabolic_age integer check (metabolic_age between 10 and 100),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index body_entries_user_time on public.body_entries (user_id, measured_at);

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  measured_at timestamptz not null,
  waist_cm numeric(5,1) check (waist_cm between 10 and 250),
  hips_cm numeric(5,1) check (hips_cm between 10 and 250),
  chest_cm numeric(5,1) check (chest_cm between 10 and 250),
  neck_cm numeric(5,1) check (neck_cm between 10 and 250),
  arm_cm numeric(5,1) check (arm_cm between 10 and 250),
  thigh_cm numeric(5,1) check (thigh_cm between 10 and 250),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint measurements_at_least_one
    check (num_nonnulls(waist_cm, hips_cm, chest_cm, neck_cm, arm_cm, thigh_cm) >= 1)
);
create index measurements_user_time on public.measurements (user_id, measured_at);

create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  taken_at timestamptz not null,
  pose text not null check (pose in ('front', 'side', 'back')),
  storage_path text not null unique,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index progress_photos_user_time on public.progress_photos (user_id, taken_at);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  metric text not null check (metric in (
    'weight_kg', 'body_fat_pct', 'muscle_mass_kg', 'fat_mass_kg',
    'lean_mass_kg', 'waist_cm', 'navy_body_fat_pct'
  )),
  start_value numeric(7,2) not null,
  target_value numeric(7,2) not null,
  start_date date not null,
  target_date date,
  status text not null default 'active' check (status in ('active', 'achieved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index goals_one_active_per_metric
  on public.goals (user_id, metric) where status = 'active';

-- updated_at triggers and row level security
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'body_entries', 'measurements', 'progress_photos', 'goals']
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t
    );
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated'
      ' using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own_rows', t
    );
  end loop;
end $$;
```

- [ ] **Step 7: Write `supabase/migrations/20260925000002_photo_bucket.sql`**

```sql
-- Private bucket for progress photos. Access only through signed URLs issued by the API.
insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', false)
on conflict (id) do nothing;
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pytest tests/test_migrations.py -v`
Expected: 6 passed

- [ ] **Step 9: Commit**

```bash
git add supabase backend/tests
git commit -m "feat(db): add body tracking schema, RLS, photo bucket and test harness"
```

---

### Task 6: Auth, DB connection and profile endpoints

**Files:**
- Create: `backend/app/db.py`, `backend/app/auth.py`, `backend/app/clock.py`, `backend/app/profiles.py`, `backend/app/schemas.py`, `backend/app/routers/__init__.py` (empty), `backend/app/routers/profile.py`
- Modify: `backend/app/main.py` (include router), `backend/tests/conftest.py` (token + client fixtures)
- Test: `backend/tests/test_auth_profile.py`

**Interfaces:**
- Produces:
  - `app.db.Conn = psycopg.Connection[dict[str, Any]]`, `get_conn() -> Iterator[Conn]` (commits on success, rolls back on error)
  - `app.auth.decode_token(token: str, settings: Settings) -> uuid.UUID` (raises `HTTPException(401)`), `current_user_id` dependency `-> uuid.UUID`
  - `app.clock.get_now() -> datetime` (aware UTC)
  - `app.profiles.Profile` (dataclass: `height_cm: float, sex: Sex, date_of_birth: date, timezone: str, hidden_metrics: list[str]`, property `tz -> ZoneInfo`), `load_profile(conn: Conn, user_id: UUID) -> Profile | None`
  - `app.schemas.OPTIONAL_SCALE_FIELDS: tuple[str, ...]`, `ProfileIn`, `ProfileOut`
  - `GET /me/profile` → 200 `ProfileOut` | 404 `{"detail": "Profile not set up"}`; `PUT /me/profile` (`ProfileIn`) → 200 `ProfileOut`
  - Test fixtures: `JWT_SECRET`, `make_token(user_id, *, expires_in=3600, secret=JWT_SECRET) -> str`, `client -> TestClient`, `user -> UUID`, `headers -> dict[str, str]`, `auth_for(user_id) -> dict[str, str]`

- [ ] **Step 1: Append fixtures to `backend/tests/conftest.py`**

Add these imports at the top of the file (merge with existing):

```python
import time
from datetime import UTC, datetime
from typing import Any

import jwt
from fastapi.testclient import TestClient

from app.clock import get_now
from app.config import Settings, get_settings
from app.main import create_app
```

Append:

```python
JWT_SECRET = "test-secret-with-at-least-32-characters!!"
FIXED_NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)


def make_token(user_id: uuid.UUID, *, expires_in: int = 3600, secret: str = JWT_SECRET) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "aud": "authenticated",
        "role": "authenticated",
        "iat": now,
        "exp": now + expires_in,
    }
    return jwt.encode(claims, secret, algorithm="HS256")


def auth_for(user_id: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


@pytest.fixture
def app_under_test(db: str) -> Any:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url=db, supabase_jwt_secret=JWT_SECRET
    )
    app.dependency_overrides[get_now] = lambda: FIXED_NOW
    return app


@pytest.fixture
def client(app_under_test: Any) -> Iterator[TestClient]:
    with TestClient(app_under_test) as c:
        yield c


@pytest.fixture
def user(make_user: Callable[[], uuid.UUID]) -> uuid.UUID:
    return make_user()


@pytest.fixture
def headers(user: uuid.UUID) -> dict[str, str]:
    return auth_for(user)
```

- [ ] **Step 2: Write failing tests `backend/tests/test_auth_profile.py`**

```python
import uuid

from tests.conftest import auth_for, make_token

PROFILE = {
    "height_cm": 180,
    "sex": "male",
    "date_of_birth": "1990-05-01",
    "timezone": "Asia/Jerusalem",
    "hidden_metrics": ["protein_pct"],
}


def test_missing_token_is_401(client) -> None:
    assert client.get("/me/profile").status_code == 401


def test_expired_token_is_401(client, user) -> None:
    token = make_token(user, expires_in=-10)
    res = client.get("/me/profile", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_wrong_secret_is_401(client, user) -> None:
    token = make_token(user, secret="another-secret-that-is-also-32-chars-long")
    res = client.get("/me/profile", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401


def test_garbage_token_is_401(client) -> None:
    res = client.get("/me/profile", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401


def test_profile_404_before_setup(client, headers) -> None:
    res = client.get("/me/profile", headers=headers)
    assert res.status_code == 404
    assert res.json()["detail"] == "Profile not set up"


def test_put_then_get_profile(client, headers) -> None:
    res = client.put("/me/profile", json=PROFILE, headers=headers)
    assert res.status_code == 200
    assert res.json() == {**PROFILE, "height_cm": 180.0}
    assert client.get("/me/profile", headers=headers).json()["timezone"] == "Asia/Jerusalem"


def test_put_updates_existing_profile(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = client.put("/me/profile", json={**PROFILE, "height_cm": 181.5}, headers=headers)
    assert res.json()["height_cm"] == 181.5


def test_invalid_timezone_422(client, headers) -> None:
    res = client.put("/me/profile", json={**PROFILE, "timezone": "Mars/Base"}, headers=headers)
    assert res.status_code == 422


def test_height_out_of_range_422(client, headers) -> None:
    res = client.put("/me/profile", json={**PROFILE, "height_cm": 300}, headers=headers)
    assert res.status_code == 422


def test_unknown_hidden_metric_422(client, headers) -> None:
    res = client.put(
        "/me/profile", json={**PROFILE, "hidden_metrics": ["weight_kg"]}, headers=headers
    )
    assert res.status_code == 422


def test_profiles_are_isolated(client, headers, make_user) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    other = make_user()
    assert client.get("/me/profile", headers=auth_for(other)).status_code == 404


def test_tampered_token_is_401(client) -> None:
    token = make_token(uuid.uuid4())
    bad = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    assert client.get("/me/profile", headers={"Authorization": f"Bearer {bad}"}).status_code == 401
```

- [ ] **Step 3: Run to verify failure**

Run: `pytest tests/test_auth_profile.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.clock'`

- [ ] **Step 4: Implement `backend/app/clock.py`**

```python
from datetime import UTC, datetime


def get_now() -> datetime:
    return datetime.now(UTC)
```

- [ ] **Step 5: Implement `backend/app/db.py`**

```python
from collections.abc import Iterator
from typing import Any

import psycopg
from fastapi import Depends
from psycopg.rows import dict_row

from app.config import Settings, get_settings

Conn = psycopg.Connection[dict[str, Any]]


def get_conn(settings: Settings = Depends(get_settings)) -> Iterator[Conn]:
    # prepare_threshold=None keeps us compatible with Supabase's pooler.
    with psycopg.connect(
        settings.database_url, row_factory=dict_row, prepare_threshold=None
    ) as conn:
        yield conn
```

- [ ] **Step 6: Implement `backend/app/auth.py`**

```python
import uuid
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def decode_token(token: str, settings: Settings) -> uuid.UUID:
    """Verify a Supabase access token. HS256 uses the project secret; RS256/ES256 use JWKS."""
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        key: Any
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                raise _unauthorized("Invalid or expired token")
            key, algorithms = settings.supabase_jwt_secret, ["HS256"]
        else:
            jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
            key = _jwks_client(jwks_url).get_signing_key_from_jwt(token).key
            algorithms = ["RS256", "ES256"]
        claims = jwt.decode(token, key, algorithms=algorithms, audience="authenticated")
        return uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise _unauthorized("Invalid or expired token") from exc


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    settings: Settings = Depends(get_settings),
) -> uuid.UUID:
    if credentials is None:
        raise _unauthorized("Not authenticated")
    return decode_token(credentials.credentials, settings)
```

- [ ] **Step 7: Implement `backend/app/schemas.py`** (profile part; later tasks append)

```python
from datetime import date
from typing import Literal
from zoneinfo import available_timezones

from pydantic import BaseModel, Field, field_validator

OPTIONAL_SCALE_FIELDS: tuple[str, ...] = (
    "body_fat_pct",
    "muscle_mass_kg",
    "skeletal_muscle_pct",
    "body_water_pct",
    "bone_mass_kg",
    "visceral_fat",
    "protein_pct",
    "bmr_kcal",
    "metabolic_age",
)
HiddenMetric = Literal[
    "body_fat_pct",
    "muscle_mass_kg",
    "skeletal_muscle_pct",
    "body_water_pct",
    "bone_mass_kg",
    "visceral_fat",
    "protein_pct",
    "bmr_kcal",
    "metabolic_age",
]
_TIMEZONES = available_timezones()


class ProfileIn(BaseModel):
    height_cm: float = Field(ge=100, le=250)
    sex: Literal["male", "female"]
    date_of_birth: date
    timezone: str
    hidden_metrics: list[HiddenMetric] = []

    @field_validator("timezone")
    @classmethod
    def _known_timezone(cls, value: str) -> str:
        if value not in _TIMEZONES:
            raise ValueError("Unknown timezone")
        return value

    @field_validator("date_of_birth")
    @classmethod
    def _past_date(cls, value: date) -> date:
        if value >= date.today():
            raise ValueError("Date of birth must be in the past")
        return value


class ProfileOut(ProfileIn):
    pass
```

- [ ] **Step 8: Implement `backend/app/profiles.py`**

```python
from dataclasses import dataclass
from datetime import date
from uuid import UUID
from zoneinfo import ZoneInfo

from app.calculations.body import Sex
from app.db import Conn


@dataclass(frozen=True)
class Profile:
    height_cm: float
    sex: Sex
    date_of_birth: date
    timezone: str
    hidden_metrics: list[str]

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


def load_profile(conn: Conn, user_id: UUID) -> Profile | None:
    row = conn.execute(
        "select height_cm, sex, date_of_birth, timezone, hidden_metrics"
        " from profiles where user_id = %s",
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    return Profile(
        height_cm=float(row["height_cm"]),
        sex=row["sex"],
        date_of_birth=row["date_of_birth"],
        timezone=row["timezone"],
        hidden_metrics=list(row["hidden_metrics"]),
    )
```

- [ ] **Step 9: Implement `backend/app/routers/profile.py`**

```python
from dataclasses import asdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.auth import current_user_id
from app.db import Conn, get_conn
from app.profiles import load_profile
from app.schemas import ProfileIn, ProfileOut

router = APIRouter(prefix="/me", tags=["profile"])


@router.get("/profile", response_model=ProfileOut)
def get_profile(
    user_id: UUID = Depends(current_user_id), conn: Conn = Depends(get_conn)
) -> ProfileOut:
    profile = load_profile(conn, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not set up")
    return ProfileOut.model_validate(asdict(profile))


@router.put("/profile", response_model=ProfileOut)
def put_profile(
    body: ProfileIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
) -> ProfileOut:
    conn.execute(
        """
        insert into profiles (user_id, height_cm, sex, date_of_birth, timezone, hidden_metrics)
        values (%s, %s, %s, %s, %s, %s::text[])
        on conflict (user_id) do update set
          height_cm = excluded.height_cm,
          sex = excluded.sex,
          date_of_birth = excluded.date_of_birth,
          timezone = excluded.timezone,
          hidden_metrics = excluded.hidden_metrics
        """,
        (
            user_id,
            body.height_cm,
            body.sex,
            body.date_of_birth,
            body.timezone,
            list(body.hidden_metrics),
        ),
    )
    profile = load_profile(conn, user_id)
    assert profile is not None
    return ProfileOut.model_validate(asdict(profile))
```

- [ ] **Step 10: Register the router in `backend/app/main.py`**

Add the import `from app.routers import profile` at the top, and add this line after the `/health` route inside `create_app()`:

```python
    app.include_router(profile.router)
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `pytest tests/test_auth_profile.py -v`
Expected: 12 passed

- [ ] **Step 12: Lint/type-check and commit**

Run: `ruff check . && ruff format --check . && mypy app`

```bash
git add backend
git commit -m "feat(backend): verify Supabase JWTs and add profile endpoints"
```

---

### Task 7: Generic user-scoped CRUD + body entries API

**Files:**
- Create: `backend/app/crud.py`, `backend/app/routers/body_entries.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py` (include router)
- Test: `backend/tests/test_body_entries.py`

**Interfaces:**
- Consumes: `Conn`, `get_conn`, `current_user_id`, `get_now`
- Produces:
  - `app.crud.Table = Literal["body_entries", "measurements", "progress_photos", "goals"]`
  - `insert_row(conn, table, user_id, data: Mapping[str, Any]) -> dict[str, Any]`
  - `list_rows(conn, table, user_id, time_col: str, start: datetime | None = None, end: datetime | None = None, filters: Mapping[str, Any] | None = None) -> list[dict[str, Any]]` (newest first)
  - `get_row(conn, table, user_id, row_id) -> dict[str, Any] | None`
  - `update_row(conn, table, user_id, row_id, data) -> dict[str, Any] | None`
  - `delete_row(conn, table, user_id, row_id) -> bool`
  - `app.crud.require(row: dict | None) -> dict` (raises 404 `"Not found"`)
  - Schemas: `BodyEntryIn`, `BodyEntryPatch`, `BodyEntryOut` (adds `id: UUID`), `validate_not_future(dt, now)`.
  - Routes: `GET /body-entries?from=&to=`, `POST /body-entries` (201), `PATCH /body-entries/{id}`, `DELETE /body-entries/{id}` (204). Another user's id → 404.

- [ ] **Step 1: Write failing tests `backend/tests/test_body_entries.py`**

```python
from tests.conftest import auth_for

BASE = {"measured_at": "2026-02-28T06:30:00+02:00", "weight_kg": 82.4}


def test_create_minimal_entry(client, headers) -> None:
    res = client.post("/body-entries", json=BASE, headers=headers)
    assert res.status_code == 201
    body = res.json()
    assert body["weight_kg"] == 82.4
    assert body["body_fat_pct"] is None
    assert body["id"]


def test_create_full_entry(client, headers) -> None:
    full = {
        **BASE,
        "body_fat_pct": 18.3,
        "muscle_mass_kg": 63.1,
        "skeletal_muscle_pct": 44.0,
        "body_water_pct": 57.2,
        "bone_mass_kg": 3.3,
        "visceral_fat": 8,
        "protein_pct": 18.1,
        "bmr_kcal": 1780,
        "metabolic_age": 31,
        "note": "after coffee",
    }
    res = client.post("/body-entries", json=full, headers=headers)
    assert res.status_code == 201
    assert res.json()["bmr_kcal"] == 1780


def test_weight_required_and_ranges(client, headers) -> None:
    assert client.post("/body-entries", json={"measured_at": BASE["measured_at"]}, headers=headers).status_code == 422
    res = client.post("/body-entries", json={**BASE, "weight_kg": 800}, headers=headers)
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"][-1] == "weight_kg"
    res = client.post("/body-entries", json={**BASE, "body_fat_pct": 95}, headers=headers)
    assert res.status_code == 422


def test_future_and_naive_dates_rejected(client, headers) -> None:
    # FIXED_NOW is 2026-03-01T12:00Z
    res = client.post("/body-entries", json={**BASE, "measured_at": "2026-03-02T12:00:00Z"}, headers=headers)
    assert res.status_code == 422
    res = client.post("/body-entries", json={**BASE, "measured_at": "2026-02-28T06:30:00"}, headers=headers)
    assert res.status_code == 422


def test_list_newest_first_and_filter(client, headers) -> None:
    for day, w in (("2026-02-01", 84), ("2026-02-15", 83), ("2026-02-27", 82)):
        client.post("/body-entries", json={"measured_at": f"{day}T07:00:00Z", "weight_kg": w}, headers=headers)
    rows = client.get("/body-entries", headers=headers).json()
    assert [r["weight_kg"] for r in rows] == [82, 83, 84]
    rows = client.get(
        "/body-entries",
        params={"from": "2026-02-10T00:00:00Z", "to": "2026-02-20T00:00:00Z"},
        headers=headers,
    ).json()
    assert [r["weight_kg"] for r in rows] == [83]


def test_patch_partial_update(client, headers) -> None:
    created = client.post("/body-entries", json=BASE, headers=headers).json()
    res = client.patch(f"/body-entries/{created['id']}", json={"body_fat_pct": 18}, headers=headers)
    assert res.status_code == 200
    assert res.json()["body_fat_pct"] == 18
    assert res.json()["weight_kg"] == 82.4


def test_patch_cannot_null_weight(client, headers) -> None:
    created = client.post("/body-entries", json=BASE, headers=headers).json()
    res = client.patch(f"/body-entries/{created['id']}", json={"weight_kg": None}, headers=headers)
    assert res.status_code == 422


def test_delete(client, headers) -> None:
    created = client.post("/body-entries", json=BASE, headers=headers).json()
    assert client.delete(f"/body-entries/{created['id']}", headers=headers).status_code == 204
    assert client.get("/body-entries", headers=headers).json() == []
    assert client.delete(f"/body-entries/{created['id']}", headers=headers).status_code == 404


def test_other_user_cannot_see_edit_or_delete(client, headers, make_user) -> None:
    created = client.post("/body-entries", json=BASE, headers=headers).json()
    other = auth_for(make_user())
    assert client.get("/body-entries", headers=other).json() == []
    assert client.patch(f"/body-entries/{created['id']}", json={"weight_kg": 50}, headers=other).status_code == 404
    assert client.delete(f"/body-entries/{created['id']}", headers=other).status_code == 404
    assert client.get("/body-entries", headers=headers).json()[0]["weight_kg"] == 82.4
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_body_entries.py -v`
Expected: FAIL with 404s (route missing) or `ModuleNotFoundError`

- [ ] **Step 3: Implement `backend/app/crud.py`**

```python
from collections.abc import Mapping
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from psycopg import sql

from app.db import Conn

Table = Literal["body_entries", "measurements", "progress_photos", "goals"]


def require(row: dict[str, Any] | None) -> dict[str, Any]:
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    return row


def insert_row(conn: Conn, table: Table, user_id: UUID, data: Mapping[str, Any]) -> dict[str, Any]:
    cols = ["user_id", *data.keys()]
    query = sql.SQL("insert into {} ({}) values ({}) returning *").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(c) for c in cols),
        sql.SQL(", ").join([sql.Placeholder()] * len(cols)),
    )
    row = conn.execute(query, [user_id, *data.values()]).fetchone()
    assert row is not None
    return row


def list_rows(
    conn: Conn,
    table: Table,
    user_id: UUID,
    time_col: str,
    start: datetime | None = None,
    end: datetime | None = None,
    filters: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    clauses: list[sql.Composable] = [sql.SQL("user_id = %s")]
    params: list[Any] = [user_id]
    if start is not None:
        clauses.append(sql.SQL("{} >= %s").format(sql.Identifier(time_col)))
        params.append(start)
    if end is not None:
        clauses.append(sql.SQL("{} <= %s").format(sql.Identifier(time_col)))
        params.append(end)
    for col, value in (filters or {}).items():
        clauses.append(sql.SQL("{} = %s").format(sql.Identifier(col)))
        params.append(value)
    query = sql.SQL("select * from {} where {} order by {} desc").format(
        sql.Identifier(table), sql.SQL(" and ").join(clauses), sql.Identifier(time_col)
    )
    return conn.execute(query, params).fetchall()


def get_row(conn: Conn, table: Table, user_id: UUID, row_id: UUID) -> dict[str, Any] | None:
    query = sql.SQL("select * from {} where id = %s and user_id = %s").format(
        sql.Identifier(table)
    )
    return conn.execute(query, (row_id, user_id)).fetchone()


def update_row(
    conn: Conn, table: Table, user_id: UUID, row_id: UUID, data: Mapping[str, Any]
) -> dict[str, Any] | None:
    if not data:
        return get_row(conn, table, user_id, row_id)
    assignments = sql.SQL(", ").join(
        sql.SQL("{} = %s").format(sql.Identifier(c)) for c in data.keys()
    )
    query = sql.SQL("update {} set {} where id = %s and user_id = %s returning *").format(
        sql.Identifier(table), assignments
    )
    return conn.execute(query, [*data.values(), row_id, user_id]).fetchone()


def delete_row(conn: Conn, table: Table, user_id: UUID, row_id: UUID) -> bool:
    query = sql.SQL("delete from {} where id = %s and user_id = %s returning id").format(
        sql.Identifier(table)
    )
    return conn.execute(query, (row_id, user_id)).fetchone() is not None
```

- [ ] **Step 4: Append body entry schemas to `backend/app/schemas.py`**

Add imports at top: `from datetime import datetime, timedelta`, `from uuid import UUID`, `from pydantic import AwareDatetime, model_validator`, `from typing import Self`.

```python
FUTURE_SLACK = timedelta(minutes=10)


def validate_not_future(value: datetime, now: datetime) -> None:
    """Raise ValueError if `value` is in the future (with a small clock-skew allowance)."""
    if value > now + FUTURE_SLACK:
        raise ValueError("Date can't be in the future")


class BodyEntryBase(BaseModel):
    body_fat_pct: float | None = Field(default=None, ge=2, le=70)
    muscle_mass_kg: float | None = Field(default=None, ge=5, le=200)
    skeletal_muscle_pct: float | None = Field(default=None, ge=5, le=80)
    body_water_pct: float | None = Field(default=None, ge=20, le=80)
    bone_mass_kg: float | None = Field(default=None, ge=0.5, le=10)
    visceral_fat: float | None = Field(default=None, ge=1, le=60)
    protein_pct: float | None = Field(default=None, ge=5, le=30)
    bmr_kcal: int | None = Field(default=None, ge=500, le=5000)
    metabolic_age: int | None = Field(default=None, ge=10, le=100)
    note: str | None = Field(default=None, max_length=500)


class BodyEntryIn(BodyEntryBase):
    measured_at: AwareDatetime
    weight_kg: float = Field(ge=20, le=400)


class BodyEntryPatch(BodyEntryBase):
    measured_at: AwareDatetime | None = None
    weight_kg: float | None = Field(default=None, ge=20, le=400)

    @model_validator(mode="after")
    def _required_not_null(self) -> Self:
        for name in ("measured_at", "weight_kg"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} can't be empty")
        return self


class BodyEntryOut(BodyEntryIn):
    id: UUID
```

(`typing.Self` requires Python 3.11+, which matches `requires-python`.)

- [ ] **Step 5: Implement `backend/app/routers/body_entries.py`**

```python
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError

from app.auth import current_user_id
from app.clock import get_now
from app.crud import delete_row, insert_row, list_rows, require, update_row
from app.db import Conn, get_conn
from app.schemas import BodyEntryIn, BodyEntryOut, BodyEntryPatch, validate_not_future

router = APIRouter(prefix="/body-entries", tags=["body entries"])


def check_not_future(field: str, value: datetime | None, now: datetime) -> None:
    if value is None:
        return
    try:
        validate_not_future(value, now)
    except ValueError as exc:
        raise RequestValidationError(
            [{"type": "value_error", "loc": ("body", field), "msg": str(exc), "input": str(value)}]
        ) from exc


@router.get("", response_model=list[BodyEntryOut])
def list_entries(
    start: datetime | None = Query(default=None, alias="from"),
    end: datetime | None = Query(default=None, alias="to"),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
) -> list[dict[str, Any]]:
    return list_rows(conn, "body_entries", user_id, "measured_at", start, end)


@router.post("", response_model=BodyEntryOut, status_code=201)
def create_entry(
    body: BodyEntryIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("measured_at", body.measured_at, now)
    return insert_row(conn, "body_entries", user_id, body.model_dump())


@router.patch("/{entry_id}", response_model=BodyEntryOut)
def update_entry(
    entry_id: UUID,
    body: BodyEntryPatch,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("measured_at", body.measured_at, now)
    data = body.model_dump(exclude_unset=True)
    return require(update_row(conn, "body_entries", user_id, entry_id, data))


@router.delete("/{entry_id}", status_code=204)
def delete_entry(
    entry_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
) -> Response:
    if not delete_row(conn, "body_entries", user_id, entry_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
```

- [ ] **Step 6: Register router in `backend/app/main.py`**

Change the import to `from app.routers import body_entries, profile` and add `app.include_router(body_entries.router)` below the profile router.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/test_body_entries.py -v`
Expected: 9 passed

- [ ] **Step 8: Lint/type-check and commit**

Run: `ruff check . && ruff format . && mypy app && pytest -q`

```bash
git add backend
git commit -m "feat(backend): add user-scoped CRUD helper and body entries API"
```

---

### Task 8: Measurements API with US Navy body fat

**Files:**
- Create: `backend/app/routers/measurements.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py`
- Test: `backend/tests/test_measurements.py`

**Interfaces:**
- Consumes: `crud.*`, `load_profile`, `navy_body_fat_pct`, `check_not_future` (from `app.routers.body_entries`)
- Produces:
  - Schemas: `MEASUREMENT_FIELDS: tuple[str, ...] = ("waist_cm", "hips_cm", "chest_cm", "neck_cm", "arm_cm", "thigh_cm")`, `MeasurementIn`, `MeasurementPatch`, `MeasurementOut` (adds `id`, `navy_body_fat_pct: float | None`), `NavyPreview { navy_body_fat_pct: float | None }`
  - `app.routers.measurements.navy_for(row: Mapping[str, Any], profile: Profile | None) -> float | None`
  - Routes: `GET/POST /measurements`, `PATCH/DELETE /measurements/{id}`, `GET /measurements/navy-preview?waist_cm=&neck_cm=&hips_cm=`

- [ ] **Step 1: Write failing tests `backend/tests/test_measurements.py`**

```python
import pytest

from tests.conftest import auth_for

PROFILE = {"height_cm": 180, "sex": "male", "date_of_birth": "1990-05-01", "timezone": "UTC"}
BASE = {"measured_at": "2026-02-28T07:00:00Z", "waist_cm": 85, "neck_cm": 38}


def test_create_with_navy_estimate(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = client.post("/measurements", json=BASE, headers=headers)
    assert res.status_code == 201
    assert res.json()["navy_body_fat_pct"] == pytest.approx(16.1, abs=0.15)


def test_navy_is_null_without_profile_or_inputs(client, headers) -> None:
    res = client.post("/measurements", json=BASE, headers=headers)
    assert res.json()["navy_body_fat_pct"] is None
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = client.post(
        "/measurements", json={"measured_at": BASE["measured_at"], "arm_cm": 36}, headers=headers
    )
    assert res.json()["navy_body_fat_pct"] is None


def test_requires_at_least_one_measurement(client, headers) -> None:
    res = client.post("/measurements", json={"measured_at": BASE["measured_at"]}, headers=headers)
    assert res.status_code == 422


def test_range_validation(client, headers) -> None:
    res = client.post("/measurements", json={**BASE, "waist_cm": 400}, headers=headers)
    assert res.status_code == 422


def test_patch_and_delete(client, headers) -> None:
    created = client.post("/measurements", json=BASE, headers=headers).json()
    res = client.patch(f"/measurements/{created['id']}", json={"waist_cm": 84}, headers=headers)
    assert res.json()["waist_cm"] == 84
    assert client.delete(f"/measurements/{created['id']}", headers=headers).status_code == 204


def test_patch_cannot_clear_last_value(client, headers) -> None:
    created = client.post(
        "/measurements", json={"measured_at": BASE["measured_at"], "arm_cm": 36}, headers=headers
    ).json()
    res = client.patch(f"/measurements/{created['id']}", json={"arm_cm": None}, headers=headers)
    assert res.status_code == 422


def test_navy_preview(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    res = client.get(
        "/measurements/navy-preview", params={"waist_cm": 85, "neck_cm": 38}, headers=headers
    )
    assert res.json()["navy_body_fat_pct"] == pytest.approx(16.1, abs=0.15)


def test_isolation(client, headers, make_user) -> None:
    created = client.post("/measurements", json=BASE, headers=headers).json()
    other = auth_for(make_user())
    assert client.get("/measurements", headers=other).json() == []
    assert client.patch(f"/measurements/{created['id']}", json={"waist_cm": 1}, headers=other).status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_measurements.py -v`
Expected: FAIL (404 for missing routes)

- [ ] **Step 3: Append measurement schemas to `backend/app/schemas.py`**

```python
MEASUREMENT_FIELDS: tuple[str, ...] = (
    "waist_cm",
    "hips_cm",
    "chest_cm",
    "neck_cm",
    "arm_cm",
    "thigh_cm",
)


class MeasurementBase(BaseModel):
    waist_cm: float | None = Field(default=None, ge=10, le=250)
    hips_cm: float | None = Field(default=None, ge=10, le=250)
    chest_cm: float | None = Field(default=None, ge=10, le=250)
    neck_cm: float | None = Field(default=None, ge=10, le=250)
    arm_cm: float | None = Field(default=None, ge=10, le=250)
    thigh_cm: float | None = Field(default=None, ge=10, le=250)
    note: str | None = Field(default=None, max_length=500)


class MeasurementIn(MeasurementBase):
    measured_at: AwareDatetime

    @model_validator(mode="after")
    def _at_least_one(self) -> Self:
        if all(getattr(self, f) is None for f in MEASUREMENT_FIELDS):
            raise ValueError("Enter at least one measurement")
        return self


class MeasurementPatch(MeasurementBase):
    measured_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def _measured_at_not_null(self) -> Self:
        if "measured_at" in self.model_fields_set and self.measured_at is None:
            raise ValueError("measured_at can't be empty")
        return self


class MeasurementOut(MeasurementIn):
    id: UUID
    navy_body_fat_pct: float | None = None


class NavyPreview(BaseModel):
    navy_body_fat_pct: float | None
```

- [ ] **Step 4: Implement `backend/app/routers/measurements.py`**

```python
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.auth import current_user_id
from app.calculations.body import navy_body_fat_pct
from app.clock import get_now
from app.crud import delete_row, get_row, insert_row, list_rows, require, update_row
from app.db import Conn, get_conn
from app.profiles import Profile, load_profile
from app.routers.body_entries import check_not_future
from app.schemas import (
    MEASUREMENT_FIELDS,
    MeasurementIn,
    MeasurementOut,
    MeasurementPatch,
    NavyPreview,
)

router = APIRouter(prefix="/measurements", tags=["measurements"])


def _f(value: Any) -> float | None:
    return None if value is None else float(value)


def navy_for(row: Mapping[str, Any], profile: Profile | None) -> float | None:
    waist, neck, hips = _f(row.get("waist_cm")), _f(row.get("neck_cm")), _f(row.get("hips_cm"))
    if profile is None or waist is None or neck is None:
        return None
    return navy_body_fat_pct(profile.sex, profile.height_cm, waist, neck, hips)


def _out(row: dict[str, Any], profile: Profile | None) -> dict[str, Any]:
    return {**row, "navy_body_fat_pct": navy_for(row, profile)}


@router.get("/navy-preview", response_model=NavyPreview)
def navy_preview(
    waist_cm: float = Query(ge=10, le=250),
    neck_cm: float = Query(ge=10, le=250),
    hips_cm: float | None = Query(default=None, ge=10, le=250),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
) -> NavyPreview:
    row = {"waist_cm": waist_cm, "neck_cm": neck_cm, "hips_cm": hips_cm}
    return NavyPreview(navy_body_fat_pct=navy_for(row, load_profile(conn, user_id)))


@router.get("", response_model=list[MeasurementOut])
def list_measurements(
    start: datetime | None = Query(default=None, alias="from"),
    end: datetime | None = Query(default=None, alias="to"),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
) -> list[dict[str, Any]]:
    profile = load_profile(conn, user_id)
    rows = list_rows(conn, "measurements", user_id, "measured_at", start, end)
    return [_out(r, profile) for r in rows]


@router.post("", response_model=MeasurementOut, status_code=201)
def create_measurement(
    body: MeasurementIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("measured_at", body.measured_at, now)
    row = insert_row(conn, "measurements", user_id, body.model_dump())
    return _out(row, load_profile(conn, user_id))


@router.patch("/{measurement_id}", response_model=MeasurementOut)
def update_measurement(
    measurement_id: UUID,
    body: MeasurementPatch,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("measured_at", body.measured_at, now)
    existing = require(get_row(conn, "measurements", user_id, measurement_id))
    data = body.model_dump(exclude_unset=True)
    merged = {**existing, **data}
    if all(merged.get(f) is None for f in MEASUREMENT_FIELDS):
        raise HTTPException(status_code=422, detail="Enter at least one measurement")
    row = require(update_row(conn, "measurements", user_id, measurement_id, data))
    return _out(row, load_profile(conn, user_id))


@router.delete("/{measurement_id}", status_code=204)
def delete_measurement(
    measurement_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
) -> Response:
    if not delete_row(conn, "measurements", user_id, measurement_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
```

Route order matters: `/navy-preview` is declared before `/{measurement_id}` routes. It must not be swallowed by a path parameter; here it only clashes with PATCH/DELETE, but keep it first anyway.

- [ ] **Step 5: Register router in `backend/app/main.py`**

Import `measurements` alongside the other routers and add `app.include_router(measurements.router)`.

- [ ] **Step 6: Run tests**

Run: `pytest tests/test_measurements.py -v`
Expected: 8 passed

- [ ] **Step 7: Lint/type-check and commit**

Run: `ruff check . && ruff format . && mypy app && pytest -q`

```bash
git add backend
git commit -m "feat(backend): add measurements API with US Navy body fat estimate"
```

---
### Task 9: Metric registry and series endpoint

**Files:**
- Create: `backend/app/metrics.py`, `backend/app/services/__init__.py` (empty), `backend/app/services/series_service.py`, `backend/app/routers/series.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py`
- Test: `backend/tests/test_series_api.py`

**Interfaces:**
- Consumes: calculations from Tasks 2–3, `load_profile`, `navy_for` (from `app.routers.measurements`), `OPTIONAL_SCALE_FIELDS`, `MEASUREMENT_FIELDS`
- Produces:
  - `app.metrics.MetricSpec(key: str, label: str, unit: str, source: Literal["body","measurement"], alpha: float, flat_threshold: float)`
  - `app.metrics.METRICS: dict[str, MetricSpec]`, with keys `weight_kg, body_fat_pct, muscle_mass_kg, skeletal_muscle_pct, body_water_pct, bone_mass_kg, visceral_fat, protein_pct, bmr_kcal, metabolic_age, bmi, fat_mass_kg, lean_mass_kg, waist_cm, hips_cm, chest_cm, neck_cm, arm_cm, thigh_cm, navy_body_fat_pct`
  - `app.metrics.load_readings(conn, user_id, metric: str, profile: Profile | None) -> list[tuple[datetime, float]]`
  - `app.services.series_service.RangeKey = Literal["1M","3M","6M","1Y","ALL"]`
  - `SeriesResult(metric, label, unit, points: list[Point], trend: list[Point], change, weekly_rate, min, max, latest)`: `latest` is the last trend value over **all** history
  - `build_series(readings, spec, tz, range_key, today) -> SeriesResult`
  - `series_for(conn, user_id, metric, profile, range_key, today) -> SeriesResult`
  - `local_today(now: datetime, profile: Profile | None) -> date`
  - Schemas `PointOut(date: date, value: float)`, `SeriesOut`, `series_out(result: SeriesResult) -> SeriesOut` (values rounded to 2 dp)
  - Route `GET /series?metric=<key>&range=<RangeKey default 3M>` → `SeriesOut`; unknown metric → 422 `"Unknown metric"`

- [ ] **Step 1: Write failing tests `backend/tests/test_series_api.py`**

```python
from datetime import date, timedelta

import pytest

PROFILE = {"height_cm": 180, "sex": "male", "date_of_birth": "1990-05-01", "timezone": "UTC"}


def _post(client, headers, day: str, weight: float, **extra) -> dict:
    res = client.post(
        "/body-entries", json={"measured_at": f"{day}T07:00:00Z", "weight_kg": weight, **extra},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


def test_weight_series_1m(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    start = date(2026, 2, 1)
    for i in range(29):  # Feb 1 .. Mar 1, losing 0.1 kg/day
        _post(client, headers, (start + timedelta(days=i)).isoformat(), 85 - 0.1 * i)
    res = client.get("/series", params={"metric": "weight_kg", "range": "1M"}, headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["label"] == "Weight" and body["unit"] == "kg"
    assert len(body["points"]) == 29
    assert len(body["trend"]) == 29
    assert body["points"][0] == {"date": "2026-02-01", "value": 85.0}
    assert -0.75 < body["weekly_rate"] < -0.4
    assert body["change"] < 0
    assert body["min"] == pytest.approx(82.2)
    assert body["max"] == 85.0


def test_range_filters_points(client, headers) -> None:
    _post(client, headers, "2025-12-01", 90)
    _post(client, headers, "2026-02-20", 85)
    body = client.get("/series", params={"metric": "weight_kg", "range": "1M"}, headers=headers).json()
    assert [p["date"] for p in body["points"]] == ["2026-02-20"]


def test_series_orders_backfilled_entries(client, headers) -> None:
    for day in ("2026-02-20", "2026-02-10", "2026-02-15"):
        _post(client, headers, day, 80)
    body = client.get("/series", params={"metric": "weight_kg"}, headers=headers).json()
    assert [p["date"] for p in body["points"]] == ["2026-02-10", "2026-02-15", "2026-02-20"]


def test_series_reflects_deleted_entry(client, headers) -> None:
    _post(client, headers, "2026-02-10", 80)
    doomed = _post(client, headers, "2026-02-11", 99)
    client.delete(f"/body-entries/{doomed['id']}", headers=headers)
    body = client.get("/series", params={"metric": "weight_kg"}, headers=headers).json()
    assert [p["value"] for p in body["points"]] == [80.0]


def test_bmi_uses_current_height(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    _post(client, headers, "2026-02-10", 81)
    body = client.get("/series", params={"metric": "bmi"}, headers=headers).json()
    assert body["points"][0]["value"] == 25.0
    client.put("/me/profile", json={**PROFILE, "height_cm": 190}, headers=headers)
    body = client.get("/series", params={"metric": "bmi"}, headers=headers).json()
    assert body["points"][0]["value"] == 22.4


def test_bmi_without_profile_is_empty(client, headers) -> None:
    _post(client, headers, "2026-02-10", 81)
    body = client.get("/series", params={"metric": "bmi"}, headers=headers).json()
    assert body["points"] == [] and body["latest"] is None


def test_fat_and_lean_mass_derived(client, headers) -> None:
    _post(client, headers, "2026-02-10", 80, body_fat_pct=20)
    _post(client, headers, "2026-02-11", 80)  # no body fat -> ignored for fat mass
    fat = client.get("/series", params={"metric": "fat_mass_kg"}, headers=headers).json()
    lean = client.get("/series", params={"metric": "lean_mass_kg"}, headers=headers).json()
    assert [p["value"] for p in fat["points"]] == [16.0]
    assert [p["value"] for p in lean["points"]] == [64.0]


def test_navy_series(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    client.post(
        "/measurements",
        json={"measured_at": "2026-02-10T07:00:00Z", "waist_cm": 85, "neck_cm": 38},
        headers=headers,
    )
    body = client.get("/series", params={"metric": "navy_body_fat_pct"}, headers=headers).json()
    assert body["points"][0]["value"] == pytest.approx(16.1, abs=0.15)


def test_profile_timezone_buckets_days(client, headers) -> None:
    client.put("/me/profile", json={**PROFILE, "timezone": "Asia/Jerusalem"}, headers=headers)
    for ts, w in (("2026-02-27T23:30:00Z", 80), ("2026-02-28T05:00:00Z", 82)):
        client.post("/body-entries", json={"measured_at": ts, "weight_kg": w}, headers=headers)
    body = client.get("/series", params={"metric": "weight_kg"}, headers=headers).json()
    assert body["points"] == [{"date": "2026-02-28", "value": 81.0}]


def test_long_range_is_weekly(client, headers) -> None:
    _post(client, headers, "2024-12-03", 90)
    _post(client, headers, "2024-12-05", 88)
    _post(client, headers, "2026-02-26", 80)
    body = client.get("/series", params={"metric": "weight_kg", "range": "ALL"}, headers=headers).json()
    assert body["points"] == [
        {"date": "2024-12-02", "value": 89.0},
        {"date": "2026-02-23", "value": 80.0},
    ]
    assert all(date.fromisoformat(p["date"]).weekday() == 0 for p in body["trend"])


def test_unknown_metric_422(client, headers) -> None:
    res = client.get("/series", params={"metric": "shoe_size"}, headers=headers)
    assert res.status_code == 422


def test_empty_series(client, headers) -> None:
    body = client.get("/series", params={"metric": "weight_kg"}, headers=headers).json()
    assert body["points"] == [] and body["weekly_rate"] is None and body["change"] is None
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_series_api.py -v`
Expected: FAIL (404 on `/series`)

- [ ] **Step 3: Implement `backend/app/metrics.py`**

```python
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from psycopg import sql

from app.calculations.body import bmi, fat_mass_kg, lean_mass_kg
from app.db import Conn
from app.profiles import Profile
from app.routers.measurements import navy_for
from app.schemas import MEASUREMENT_FIELDS, OPTIONAL_SCALE_FIELDS

Source = Literal["body", "measurement"]
Readings = list[tuple[datetime, float]]


@dataclass(frozen=True)
class MetricSpec:
    key: str
    label: str
    unit: str
    source: Source
    alpha: float
    flat_threshold: float


def _body(key: str, label: str, unit: str, flat: float = 0.05) -> MetricSpec:
    return MetricSpec(key, label, unit, "body", 0.1, flat)


def _tape(key: str, label: str) -> MetricSpec:
    return MetricSpec(key, label, "cm", "measurement", 0.3, 0.1)


METRICS: dict[str, MetricSpec] = {
    m.key: m
    for m in (
        _body("weight_kg", "Weight", "kg"),
        _body("body_fat_pct", "Body fat", "%"),
        _body("muscle_mass_kg", "Muscle mass", "kg"),
        _body("skeletal_muscle_pct", "Skeletal muscle", "%"),
        _body("body_water_pct", "Body water", "%"),
        _body("bone_mass_kg", "Bone mass", "kg", 0.01),
        _body("visceral_fat", "Visceral fat", "", 0.1),
        _body("protein_pct", "Protein", "%"),
        _body("bmr_kcal", "BMR", "kcal", 5),
        _body("metabolic_age", "Metabolic age", "yrs", 0.1),
        _body("bmi", "BMI", "", 0.02),
        _body("fat_mass_kg", "Fat mass", "kg"),
        _body("lean_mass_kg", "Lean mass", "kg"),
        _tape("waist_cm", "Waist"),
        _tape("hips_cm", "Hips"),
        _tape("chest_cm", "Chest"),
        _tape("neck_cm", "Neck"),
        _tape("arm_cm", "Arm"),
        _tape("thigh_cm", "Thigh"),
        MetricSpec("navy_body_fat_pct", "Body fat (Navy)", "%", "measurement", 0.3, 0.05),
    )
}

_DIRECT_BODY = {"weight_kg", *OPTIONAL_SCALE_FIELDS}
_DIRECT_TAPE = set(MEASUREMENT_FIELDS)


def _column(
    conn: Conn, table: Literal["body_entries", "measurements"], col: str, user_id: UUID
) -> Readings:
    query = sql.SQL(
        "select measured_at, {c} as value from {t}"
        " where user_id = %s and {c} is not null order by measured_at"
    ).format(c=sql.Identifier(col), t=sql.Identifier(table))
    return [(r["measured_at"], float(r["value"])) for r in conn.execute(query, (user_id,))]


def load_readings(conn: Conn, user_id: UUID, metric: str, profile: Profile | None) -> Readings:
    if metric in _DIRECT_BODY:
        return _column(conn, "body_entries", metric, user_id)
    if metric in _DIRECT_TAPE:
        return _column(conn, "measurements", metric, user_id)
    if metric == "bmi":
        if profile is None:
            return []
        weights = _column(conn, "body_entries", "weight_kg", user_id)
        return [(t, bmi(w, profile.height_cm)) for t, w in weights]
    if metric in ("fat_mass_kg", "lean_mass_kg"):
        rows = conn.execute(
            "select measured_at, weight_kg, body_fat_pct from body_entries"
            " where user_id = %s and body_fat_pct is not null order by measured_at",
            (user_id,),
        ).fetchall()
        fn = fat_mass_kg if metric == "fat_mass_kg" else lean_mass_kg
        return [
            (r["measured_at"], fn(float(r["weight_kg"]), float(r["body_fat_pct"]))) for r in rows
        ]
    if metric == "navy_body_fat_pct":
        rows = conn.execute(
            "select measured_at, waist_cm, neck_cm, hips_cm from measurements"
            " where user_id = %s and waist_cm is not null and neck_cm is not null"
            " order by measured_at",
            (user_id,),
        ).fetchall()
        readings: Readings = []
        for r in rows:
            value = navy_for(r, profile)
            if value is not None:
                readings.append((r["measured_at"], value))
        return readings
    raise KeyError(metric)
```

- [ ] **Step 4: Implement `backend/app/services/series_service.py`**

```python
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from app.calculations.series import (
    Point,
    change,
    daily_means,
    ewma_trend,
    weekly_last,
    weekly_means,
    weekly_rate,
)
from app.db import Conn
from app.metrics import METRICS, MetricSpec, Readings, load_readings
from app.profiles import Profile

RangeKey = Literal["1M", "3M", "6M", "1Y", "ALL"]
RANGE_DAYS: dict[str, int | None] = {"1M": 30, "3M": 91, "6M": 182, "1Y": 365, "ALL": None}
UTC_ZONE = ZoneInfo("UTC")


@dataclass(frozen=True)
class SeriesResult:
    metric: str
    label: str
    unit: str
    points: list[Point]
    trend: list[Point]
    change: float | None
    weekly_rate: float | None
    min: float | None
    max: float | None
    latest: float | None


def local_today(now: datetime, profile: Profile | None) -> date:
    return now.astimezone(profile.tz if profile else UTC_ZONE).date()


def build_series(
    readings: Readings, spec: MetricSpec, tz: ZoneInfo, range_key: str, today: date
) -> SeriesResult:
    daily = daily_means(readings, tz)
    trend = ewma_trend(daily, spec.alpha)
    rate = weekly_rate(trend, today)
    days = RANGE_DAYS[range_key]
    start = None if days is None else today - timedelta(days=days)
    points = [p for p in daily if start is None or p.day >= start]
    trend_in_range = [p for p in trend if start is None or p.day >= start]
    values = [p.value for p in points]
    range_change = change(trend_in_range)
    if points and (points[-1].day - points[0].day).days > 366:
        points, trend_in_range = weekly_means(points), weekly_last(trend_in_range)
    return SeriesResult(
        metric=spec.key,
        label=spec.label,
        unit=spec.unit,
        points=points,
        trend=trend_in_range,
        change=range_change,
        weekly_rate=rate,
        min=min(values) if values else None,
        max=max(values) if values else None,
        latest=trend[-1].value if trend else None,
    )


def series_for(
    conn: Conn,
    user_id: UUID,
    metric: str,
    profile: Profile | None,
    range_key: str,
    today: date,
) -> SeriesResult:
    spec = METRICS[metric]
    tz = profile.tz if profile else UTC_ZONE
    return build_series(load_readings(conn, user_id, metric, profile), spec, tz, range_key, today)
```

- [ ] **Step 5: Append series schemas to `backend/app/schemas.py`**

Add the import `from app.services.series_service import SeriesResult` inside `series_out` only (a local import avoids a circular import: `metrics` imports `schemas`).

```python
class PointOut(BaseModel):
    date: date
    value: float


class SeriesOut(BaseModel):
    metric: str
    label: str
    unit: str
    points: list[PointOut]
    trend: list[PointOut]
    change: float | None
    weekly_rate: float | None
    min: float | None
    max: float | None
    latest: float | None


def _r(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def series_out(result: "SeriesResult") -> SeriesOut:
    return SeriesOut(
        metric=result.metric,
        label=result.label,
        unit=result.unit,
        points=[PointOut(date=p.day, value=round(p.value, 2)) for p in result.points],
        trend=[PointOut(date=p.day, value=round(p.value, 2)) for p in result.trend],
        change=_r(result.change),
        weekly_rate=_r(result.weekly_rate),
        min=_r(result.min),
        max=_r(result.max),
        latest=_r(result.latest),
    )
```

At the top of `schemas.py` add:

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.series_service import SeriesResult
```

- [ ] **Step 6: Implement `backend/app/routers/series.py`**

```python
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import current_user_id
from app.clock import get_now
from app.db import Conn, get_conn
from app.metrics import METRICS
from app.profiles import load_profile
from app.schemas import SeriesOut, series_out
from app.services.series_service import RangeKey, local_today, series_for

router = APIRouter(tags=["series"])


@router.get("/series", response_model=SeriesOut)
def get_series(
    metric: str,
    range_key: RangeKey = Query(default="3M", alias="range"),
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> SeriesOut:
    if metric not in METRICS:
        raise HTTPException(status_code=422, detail="Unknown metric")
    profile = load_profile(conn, user_id)
    result = series_for(conn, user_id, metric, profile, range_key, local_today(now, profile))
    return series_out(result)
```

- [ ] **Step 7: Register router in `backend/app/main.py`**, then run tests

Run: `pytest tests/test_series_api.py -v`
Expected: 12 passed. For `test_weight_series_1m`, the EWMA lags a straight line, so the fitted weekly rate is a little flatter than −0.7. The test uses a band for that reason. Don't tighten it.

- [ ] **Step 8: Lint/type-check and commit**

Run: `ruff check . && ruff format . && mypy app && pytest -q`

```bash
git add backend
git commit -m "feat(backend): add metric registry and trend series endpoint"
```

---

### Task 10: Goals API with projections

**Files:**
- Create: `backend/app/services/goal_service.py`, `backend/app/routers/goals.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py`
- Test: `backend/tests/test_goals_api.py`

**Interfaces:**
- Consumes: `series_for`, `local_today`, `METRICS`, `project_goal`, `crud.*`
- Produces:
  - Schemas: `GoalMetric` (Literal of the 7 goal metrics), `GoalStatus = Literal["active","achieved","archived"]`, `GoalIn(metric, target_value, target_date=None)`, `GoalPatch(target_value?, target_date?, status?)`, `ProjectionOut(current, progress_pct, state, projected_date)`, `GoalOut(id, metric, start_value, target_value, start_date, target_date, status, projection)`
  - `app.services.goal_service.goal_with_projection(conn, user_id, row: dict, profile, today) -> dict[str, Any]` (row + `"projection"`)
  - Routes: `GET /goals?status=`, `POST /goals` (201; 422 if no data for metric; 409 if an active goal already exists), `PATCH /goals/{id}` (409 on re-activating a duplicate), `DELETE /goals/{id}`

- [ ] **Step 1: Write failing tests `backend/tests/test_goals_api.py`**

```python
from datetime import date, timedelta

from tests.conftest import auth_for


def _seed_body_fat(client, headers, days: int = 21, start_bf: float = 20.0) -> None:
    start = date(2026, 3, 1) - timedelta(days=days - 1)
    for i in range(days):
        client.post(
            "/body-entries",
            json={
                "measured_at": f"{(start + timedelta(days=i)).isoformat()}T07:00:00Z",
                "weight_kg": 80,
                "body_fat_pct": start_bf - 0.05 * i,
            },
            headers=headers,
        )


def test_create_goal_requires_data(client, headers) -> None:
    res = client.post("/goals", json={"metric": "body_fat_pct", "target_value": 15}, headers=headers)
    assert res.status_code == 422
    assert "Log at least one Body fat reading" in res.json()["detail"]


def test_create_goal_captures_start_from_trend(client, headers) -> None:
    _seed_body_fat(client, headers)
    res = client.post("/goals", json={"metric": "body_fat_pct", "target_value": 15}, headers=headers)
    assert res.status_code == 201
    goal = res.json()
    assert goal["status"] == "active"
    assert goal["start_date"] == "2026-03-01"
    assert 19.0 < goal["start_value"] < 20.0
    assert goal["projection"]["state"] == "on_track"
    assert goal["projection"]["projected_date"] is not None
    assert 0 <= goal["projection"]["progress_pct"] <= 100


def test_duplicate_active_goal_409(client, headers) -> None:
    _seed_body_fat(client, headers)
    client.post("/goals", json={"metric": "body_fat_pct", "target_value": 15}, headers=headers)
    res = client.post("/goals", json={"metric": "body_fat_pct", "target_value": 14}, headers=headers)
    assert res.status_code == 409


def test_archive_then_create_new(client, headers) -> None:
    _seed_body_fat(client, headers)
    goal = client.post("/goals", json={"metric": "body_fat_pct", "target_value": 15}, headers=headers).json()
    res = client.patch(f"/goals/{goal['id']}", json={"status": "archived"}, headers=headers)
    assert res.json()["status"] == "archived"
    res = client.post("/goals", json={"metric": "body_fat_pct", "target_value": 14}, headers=headers)
    assert res.status_code == 201
    # re-activating the archived one now conflicts
    res = client.patch(f"/goals/{goal['id']}", json={"status": "active"}, headers=headers)
    assert res.status_code == 409


def test_list_filter_and_delete(client, headers) -> None:
    _seed_body_fat(client, headers)
    goal = client.post("/goals", json={"metric": "body_fat_pct", "target_value": 15}, headers=headers).json()
    assert len(client.get("/goals", params={"status": "active"}, headers=headers).json()) == 1
    assert client.get("/goals", params={"status": "archived"}, headers=headers).json() == []
    assert client.delete(f"/goals/{goal['id']}", headers=headers).status_code == 204
    assert client.get("/goals", headers=headers).json() == []


def test_upward_goal_moving_wrong_way_not_on_pace(client, headers) -> None:
    # muscle mass falling while the goal is to gain it
    start = date(2026, 3, 1) - timedelta(days=20)
    for i in range(21):
        client.post(
            "/body-entries",
            json={
                "measured_at": f"{(start + timedelta(days=i)).isoformat()}T07:00:00Z",
                "weight_kg": 80,
                "muscle_mass_kg": 62 - 0.05 * i,
            },
            headers=headers,
        )
    res = client.post("/goals", json={"metric": "muscle_mass_kg", "target_value": 65}, headers=headers)
    assert res.json()["projection"]["state"] == "not_on_pace"


def test_goal_isolation(client, headers, make_user) -> None:
    _seed_body_fat(client, headers)
    goal = client.post("/goals", json={"metric": "body_fat_pct", "target_value": 15}, headers=headers).json()
    other = auth_for(make_user())
    assert client.get("/goals", headers=other).json() == []
    assert client.patch(f"/goals/{goal['id']}", json={"status": "archived"}, headers=other).status_code == 404
    assert client.delete(f"/goals/{goal['id']}", headers=other).status_code == 404


def test_invalid_metric_422(client, headers) -> None:
    res = client.post("/goals", json={"metric": "bmr_kcal", "target_value": 1800}, headers=headers)
    assert res.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_goals_api.py -v`
Expected: FAIL (404 on `/goals`)

- [ ] **Step 3: Append goal schemas to `backend/app/schemas.py`**

Add `from app.calculations.goals import ProjectionState` to the imports.

```python
GoalMetric = Literal[
    "weight_kg",
    "body_fat_pct",
    "muscle_mass_kg",
    "fat_mass_kg",
    "lean_mass_kg",
    "waist_cm",
    "navy_body_fat_pct",
]
GoalStatus = Literal["active", "achieved", "archived"]


class GoalIn(BaseModel):
    metric: GoalMetric
    target_value: float = Field(gt=0, le=10000)
    target_date: date | None = None


class GoalPatch(BaseModel):
    target_value: float | None = Field(default=None, gt=0, le=10000)
    target_date: date | None = None
    status: GoalStatus | None = None

    @model_validator(mode="after")
    def _required_not_null(self) -> Self:
        for name in ("target_value", "status"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} can't be empty")
        return self


class ProjectionOut(BaseModel):
    current: float | None
    progress_pct: float | None
    state: ProjectionState
    projected_date: date | None


class GoalOut(BaseModel):
    id: UUID
    metric: GoalMetric
    start_value: float
    target_value: float
    start_date: date
    target_date: date | None
    status: GoalStatus
    projection: ProjectionOut
```

- [ ] **Step 4: Implement `backend/app/services/goal_service.py`**

```python
from datetime import date
from typing import Any
from uuid import UUID

from app.calculations.goals import project_goal
from app.db import Conn
from app.metrics import METRICS
from app.profiles import Profile
from app.services.series_service import series_for


def goal_with_projection(
    conn: Conn, user_id: UUID, row: dict[str, Any], profile: Profile | None, today: date
) -> dict[str, Any]:
    spec = METRICS[row["metric"]]
    series = series_for(conn, user_id, row["metric"], profile, "ALL", today)
    projection = project_goal(
        start=float(row["start_value"]),
        target=float(row["target_value"]),
        current=series.latest,
        rate_per_week=series.weekly_rate,
        today=today,
        flat_threshold=spec.flat_threshold,
    )
    return {
        **row,
        "projection": {
            "current": None if series.latest is None else round(series.latest, 2),
            "progress_pct": projection.progress_pct,
            "state": projection.state,
            "projected_date": projection.projected_date,
        },
    }
```

- [ ] **Step 5: Implement `backend/app/routers/goals.py`**

```python
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import current_user_id
from app.clock import get_now
from app.crud import delete_row, insert_row, list_rows, require, update_row
from app.db import Conn, get_conn
from app.metrics import METRICS
from app.profiles import load_profile
from app.schemas import GoalIn, GoalOut, GoalPatch, GoalStatus
from app.services.goal_service import goal_with_projection
from app.services.series_service import local_today, series_for

router = APIRouter(prefix="/goals", tags=["goals"])


def _conflict(metric: str) -> HTTPException:
    return HTTPException(
        status_code=409, detail=f"You already have an active {METRICS[metric].label} goal"
    )


@router.get("", response_model=list[GoalOut])
def list_goals(
    status: GoalStatus | None = None,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> list[dict[str, Any]]:
    profile = load_profile(conn, user_id)
    today = local_today(now, profile)
    filters = {"status": status} if status else None
    rows = list_rows(conn, "goals", user_id, "start_date", filters=filters)
    return [goal_with_projection(conn, user_id, r, profile, today) for r in rows]


@router.post("", response_model=GoalOut, status_code=201)
def create_goal(
    body: GoalIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    profile = load_profile(conn, user_id)
    today = local_today(now, profile)
    current = series_for(conn, user_id, body.metric, profile, "ALL", today).latest
    if current is None:
        label = METRICS[body.metric].label
        raise HTTPException(
            status_code=422, detail=f"Log at least one {label} reading before setting this goal"
        )
    data = {
        "metric": body.metric,
        "start_value": round(current, 2),
        "target_value": body.target_value,
        "start_date": today,
        "target_date": body.target_date,
        "status": "active",
    }
    try:
        row = insert_row(conn, "goals", user_id, data)
    except psycopg.errors.UniqueViolation as exc:
        raise _conflict(body.metric) from exc
    return goal_with_projection(conn, user_id, row, profile, today)


@router.patch("/{goal_id}", response_model=GoalOut)
def update_goal(
    goal_id: UUID,
    body: GoalPatch,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    profile = load_profile(conn, user_id)
    try:
        row = update_row(conn, "goals", user_id, goal_id, body.model_dump(exclude_unset=True))
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="You already have an active goal for this metric") from exc
    return goal_with_projection(conn, user_id, require(row), profile, local_today(now, profile))


@router.delete("/{goal_id}", status_code=204)
def delete_goal(
    goal_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
) -> Response:
    if not delete_row(conn, "goals", user_id, goal_id):
        raise HTTPException(status_code=404, detail="Not found")
    return Response(status_code=204)
```

- [ ] **Step 6: Register router**, then run tests

Run: `pytest tests/test_goals_api.py -v`
Expected: 8 passed

- [ ] **Step 7: Lint/type-check and commit**

Run: `ruff check . && ruff format . && mypy app && pytest -q`

```bash
git add backend
git commit -m "feat(backend): add goals API with trend-based projections"
```

---

### Task 11: Progress photos API with private storage

**Files:**
- Create: `backend/app/storage.py`, `backend/app/routers/photos.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py`, `backend/tests/conftest.py` (fake storage)
- Test: `backend/tests/test_photos_api.py`

**Interfaces:**
- Produces:
  - `app.storage.PhotoStorage` Protocol: `create_upload(path: str) -> str` (returns upload token), `signed_urls(paths: list[str], expires_in: int = 3600) -> dict[str, str]`, `exists(path: str) -> bool`, `delete(path: str) -> None`
  - `app.storage.SupabaseStorage(base_url, service_key, bucket)`, `get_storage` dependency, `photo_path(user_id: UUID, photo_id: UUID) -> str` (`"{user_id}/{photo_id}.jpg"`)
  - Schemas: `Pose = Literal["front","side","back"]`, `UploadUrlOut(photo_id, path, token)`, `PhotoIn(photo_id, taken_at, pose, note)`, `PhotoOut(id, taken_at, pose, note, url)`
  - Routes: `POST /photos/upload-url` → `UploadUrlOut`; `POST /photos` (201; 400 `"Upload not found…"` if object missing; 409 if already registered); `GET /photos?pose=`; `DELETE /photos/{id}` (204)
  - Test fixture `storage -> FakeStorage` (overrides `get_storage`; `.objects: set[str]` simulates uploaded files)
- Frontend contract (used in Task 18): upload the file with `supabase.storage.from("progress-photos").uploadToSignedUrl(path, token, blob, { contentType: "image/jpeg" })`.

- [ ] **Step 1: Add fake storage to `backend/tests/conftest.py`**

Add the import `from app.storage import get_storage`, then append:

```python
class FakeStorage:
    def __init__(self) -> None:
        self.objects: set[str] = set()
        self.deleted: list[str] = []

    def create_upload(self, path: str) -> str:
        return f"token-for-{path}"

    def signed_urls(self, paths: list[str], expires_in: int = 3600) -> dict[str, str]:
        return {p: f"https://storage.test/{p}?sig=1" for p in paths}

    def exists(self, path: str) -> bool:
        return path in self.objects

    def delete(self, path: str) -> None:
        self.objects.discard(path)
        self.deleted.append(path)


@pytest.fixture
def storage(app_under_test: Any) -> FakeStorage:
    fake = FakeStorage()
    app_under_test.dependency_overrides[get_storage] = lambda: fake
    return fake
```

- [ ] **Step 2: Write failing tests `backend/tests/test_photos_api.py`**

```python
from tests.conftest import auth_for


def _upload(client, headers, storage, pose: str = "front", taken_at: str = "2026-02-28T07:00:00Z"):
    ticket = client.post("/photos/upload-url", headers=headers).json()
    storage.objects.add(ticket["path"])  # simulate the browser uploading to the signed URL
    res = client.post(
        "/photos",
        json={"photo_id": ticket["photo_id"], "taken_at": taken_at, "pose": pose},
        headers=headers,
    )
    return ticket, res


def test_upload_url_is_under_user_folder(client, headers, user, storage) -> None:
    ticket = client.post("/photos/upload-url", headers=headers).json()
    assert ticket["path"] == f"{user}/{ticket['photo_id']}.jpg"
    assert ticket["token"] == f"token-for-{ticket['path']}"


def test_register_requires_uploaded_object(client, headers, storage) -> None:
    ticket = client.post("/photos/upload-url", headers=headers).json()
    res = client.post(
        "/photos",
        json={"photo_id": ticket["photo_id"], "taken_at": "2026-02-28T07:00:00Z", "pose": "front"},
        headers=headers,
    )
    assert res.status_code == 400
    assert client.get("/photos", headers=headers).json() == []


def test_register_list_and_filter(client, headers, storage) -> None:
    _, res = _upload(client, headers, storage, "front")
    assert res.status_code == 201
    assert res.json()["url"].startswith("https://storage.test/")
    _upload(client, headers, storage, "side", "2026-02-27T07:00:00Z")
    assert len(client.get("/photos", headers=headers).json()) == 2
    fronts = client.get("/photos", params={"pose": "front"}, headers=headers).json()
    assert [p["pose"] for p in fronts] == ["front"]


def test_register_twice_is_409(client, headers, storage) -> None:
    ticket, _ = _upload(client, headers, storage)
    res = client.post(
        "/photos",
        json={"photo_id": ticket["photo_id"], "taken_at": "2026-02-28T07:00:00Z", "pose": "front"},
        headers=headers,
    )
    assert res.status_code == 409


def test_delete_removes_object_and_row(client, headers, storage) -> None:
    ticket, res = _upload(client, headers, storage)
    photo_id = res.json()["id"]
    assert client.delete(f"/photos/{photo_id}", headers=headers).status_code == 204
    assert ticket["path"] in storage.deleted
    assert client.get("/photos", headers=headers).json() == []


def test_other_user_cannot_claim_or_delete(client, headers, storage, make_user) -> None:
    ticket, res = _upload(client, headers, storage)
    other = auth_for(make_user())
    # Other user tries to register the same photo id: their path differs, so nothing is found.
    claim = client.post(
        "/photos",
        json={"photo_id": ticket["photo_id"], "taken_at": "2026-02-28T07:00:00Z", "pose": "front"},
        headers=other,
    )
    assert claim.status_code == 400
    assert client.delete(f"/photos/{res.json()['id']}", headers=other).status_code == 404
    assert client.get("/photos", headers=other).json() == []
    assert storage.deleted == []
```

- [ ] **Step 3: Run to verify failure**

Run: `pytest tests/test_photos_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.storage'`

- [ ] **Step 4: Implement `backend/app/storage.py`**

```python
from typing import Any, Protocol
from urllib.parse import parse_qs, urlparse
from uuid import UUID

import httpx
from fastapi import Depends

from app.config import Settings, get_settings


class PhotoStorage(Protocol):
    def create_upload(self, path: str) -> str: ...
    def signed_urls(self, paths: list[str], expires_in: int = 3600) -> dict[str, str]: ...
    def exists(self, path: str) -> bool: ...
    def delete(self, path: str) -> None: ...


def photo_path(user_id: UUID, photo_id: UUID) -> str:
    return f"{user_id}/{photo_id}.jpg"


class SupabaseStorage:
    """Minimal client for Supabase Storage's REST API using the service role key."""

    def __init__(self, base_url: str, service_key: str, bucket: str) -> None:
        self._base = f"{base_url.rstrip('/')}/storage/v1"
        self._bucket = bucket
        self._client = httpx.Client(
            base_url=self._base,
            headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
            timeout=10,
        )

    def create_upload(self, path: str) -> str:
        res = self._client.post(f"/object/upload/sign/{self._bucket}/{path}")
        res.raise_for_status()
        url: str = res.json()["url"]
        return parse_qs(urlparse(url).query)["token"][0]

    def signed_urls(self, paths: list[str], expires_in: int = 3600) -> dict[str, str]:
        if not paths:
            return {}
        res = self._client.post(
            f"/object/sign/{self._bucket}", json={"expiresIn": expires_in, "paths": paths}
        )
        res.raise_for_status()
        items: list[dict[str, Any]] = res.json()
        return {i["path"]: f"{self._base}{i['signedURL']}" for i in items if i.get("signedURL")}

    def exists(self, path: str) -> bool:
        folder, name = path.rsplit("/", 1)
        res = self._client.post(
            f"/object/list/{self._bucket}",
            json={"prefix": folder, "search": name, "limit": 1, "offset": 0},
        )
        res.raise_for_status()
        return any(obj.get("name") == name for obj in res.json())

    def delete(self, path: str) -> None:
        res = self._client.request("DELETE", f"/object/{self._bucket}", json={"prefixes": [path]})
        res.raise_for_status()


def get_storage(settings: Settings = Depends(get_settings)) -> PhotoStorage:
    return SupabaseStorage(
        settings.supabase_url, settings.supabase_service_role_key, settings.photo_bucket
    )
```

- [ ] **Step 5: Append photo schemas to `backend/app/schemas.py`**

```python
Pose = Literal["front", "side", "back"]


class UploadUrlOut(BaseModel):
    photo_id: UUID
    path: str
    token: str


class PhotoIn(BaseModel):
    photo_id: UUID
    taken_at: AwareDatetime
    pose: Pose
    note: str | None = Field(default=None, max_length=500)


class PhotoOut(BaseModel):
    id: UUID
    taken_at: datetime
    pose: Pose
    note: str | None
    url: str
```

- [ ] **Step 6: Implement `backend/app/routers/photos.py`**

```python
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Response

from app.auth import current_user_id
from app.clock import get_now
from app.crud import delete_row, get_row, insert_row, list_rows, require
from app.db import Conn, get_conn
from app.routers.body_entries import check_not_future
from app.schemas import PhotoIn, PhotoOut, Pose, UploadUrlOut
from app.storage import PhotoStorage, get_storage, photo_path

router = APIRouter(prefix="/photos", tags=["photos"])


def _out(row: dict[str, Any], url: str) -> dict[str, Any]:
    return {**row, "url": url}


@router.post("/upload-url", response_model=UploadUrlOut)
def create_upload_url(
    user_id: UUID = Depends(current_user_id),
    storage: PhotoStorage = Depends(get_storage),
) -> UploadUrlOut:
    photo_id = uuid4()
    path = photo_path(user_id, photo_id)
    return UploadUrlOut(photo_id=photo_id, path=path, token=storage.create_upload(path))


@router.post("", response_model=PhotoOut, status_code=201)
def register_photo(
    body: PhotoIn,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    storage: PhotoStorage = Depends(get_storage),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    check_not_future("taken_at", body.taken_at, now)
    path = photo_path(user_id, body.photo_id)
    if not storage.exists(path):
        raise HTTPException(
            status_code=400, detail="Upload not found. Please try uploading the photo again."
        )
    data = {
        "id": body.photo_id,
        "taken_at": body.taken_at,
        "pose": body.pose,
        "note": body.note,
        "storage_path": path,
    }
    try:
        row = insert_row(conn, "progress_photos", user_id, data)
    except psycopg.errors.UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="Photo already saved") from exc
    return _out(row, storage.signed_urls([path])[path])


@router.get("", response_model=list[PhotoOut])
def list_photos(
    pose: Pose | None = None,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    storage: PhotoStorage = Depends(get_storage),
) -> list[dict[str, Any]]:
    filters = {"pose": pose} if pose else None
    rows = list_rows(conn, "progress_photos", user_id, "taken_at", filters=filters)
    urls = storage.signed_urls([r["storage_path"] for r in rows])
    return [_out(r, urls.get(r["storage_path"], "")) for r in rows]


@router.delete("/{photo_id}", status_code=204)
def delete_photo(
    photo_id: UUID,
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    storage: PhotoStorage = Depends(get_storage),
) -> Response:
    row = require(get_row(conn, "progress_photos", user_id, photo_id))
    storage.delete(row["storage_path"])  # object first: if this fails the row stays for a retry
    delete_row(conn, "progress_photos", user_id, photo_id)
    return Response(status_code=204)
```

- [ ] **Step 7: Register router**, then run tests

Run: `pytest tests/test_photos_api.py -v`
Expected: 6 passed

- [ ] **Step 8: Lint/type-check and commit**

Run: `ruff check . && ruff format . && mypy app && pytest -q`

```bash
git add backend
git commit -m "feat(backend): add progress photo API backed by private signed storage"
```

---

### Task 12: Dashboard endpoint

**Files:**
- Create: `backend/app/services/dashboard_service.py`, `backend/app/routers/dashboard.py`
- Modify: `backend/app/schemas.py` (append), `backend/app/main.py`
- Test: `backend/tests/test_dashboard_api.py`

**Interfaces:**
- Consumes: `series_for`, `local_today`, `goal_with_projection`, `list_rows`
- Produces:
  - Schemas: `MetricSummaryOut(metric, label, unit, latest, change_30d, goal_direction: Literal["up","down"] | None, sparkline: list[PointOut])`, `NudgesOut(days_since_weigh_in: int | None, days_since_photo: int | None)`, `DashboardOut(hero, cards, secondary, goals: list[GoalOut], nudges)`
  - `build_dashboard(conn, user_id, profile, now) -> dict[str, Any]`
  - Metric groups: `hero = ["fat_mass_kg", "lean_mass_kg"]`, `cards = ["body_fat_pct", "muscle_mass_kg"]`, `secondary = ["weight_kg", "bmi", "waist_cm"]`
  - Route `GET /dashboard` → `DashboardOut`

- [ ] **Step 1: Write failing tests `backend/tests/test_dashboard_api.py`**

```python
from datetime import date, timedelta

PROFILE = {"height_cm": 180, "sex": "male", "date_of_birth": "1990-05-01", "timezone": "UTC"}


def test_empty_dashboard(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    body = client.get("/dashboard", headers=headers).json()
    assert [m["metric"] for m in body["hero"]] == ["fat_mass_kg", "lean_mass_kg"]
    assert [m["metric"] for m in body["cards"]] == ["body_fat_pct", "muscle_mass_kg"]
    assert [m["metric"] for m in body["secondary"]] == ["weight_kg", "bmi", "waist_cm"]
    assert all(m["latest"] is None and m["sparkline"] == [] for m in body["hero"])
    assert body["goals"] == []
    assert body["nudges"] == {"days_since_weigh_in": None, "days_since_photo": None}


def test_populated_dashboard(client, headers) -> None:
    client.put("/me/profile", json=PROFILE, headers=headers)
    start = date(2026, 1, 20)  # 39 days before the last entry on Feb 27
    for i in range(39):
        client.post(
            "/body-entries",
            json={
                "measured_at": f"{(start + timedelta(days=i)).isoformat()}T07:00:00Z",
                "weight_kg": 80,
                "body_fat_pct": 20 - 0.05 * i,
                "muscle_mass_kg": 60 + 0.02 * i,
            },
            headers=headers,
        )
    client.post("/goals", json={"metric": "body_fat_pct", "target_value": 15}, headers=headers)
    body = client.get("/dashboard", headers=headers).json()

    fat = body["hero"][0]
    assert 14 < fat["latest"] < 16
    assert fat["change_30d"] < 0
    assert fat["sparkline"]
    bf_card = body["cards"][0]
    assert bf_card["goal_direction"] == "down"
    assert body["cards"][1]["goal_direction"] is None
    assert body["secondary"][1]["latest"] == 24.7  # BMI 80 kg / 1.80 m
    assert len(body["goals"]) == 1
    assert body["nudges"]["days_since_weigh_in"] == 2  # last entry Feb 27, today Mar 1
    assert body["nudges"]["days_since_photo"] is None
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_dashboard_api.py -v`
Expected: FAIL (404)

- [ ] **Step 3: Append dashboard schemas to `backend/app/schemas.py`**

```python
class MetricSummaryOut(BaseModel):
    metric: str
    label: str
    unit: str
    latest: float | None
    change_30d: float | None
    goal_direction: Literal["up", "down"] | None
    sparkline: list[PointOut]


class NudgesOut(BaseModel):
    days_since_weigh_in: int | None
    days_since_photo: int | None


class DashboardOut(BaseModel):
    hero: list[MetricSummaryOut]
    cards: list[MetricSummaryOut]
    secondary: list[MetricSummaryOut]
    goals: list[GoalOut]
    nudges: NudgesOut
```

- [ ] **Step 4: Implement `backend/app/services/dashboard_service.py`**

```python
from datetime import date, datetime, timedelta
from typing import Any
from uuid import UUID

from app.crud import list_rows
from app.db import Conn
from app.profiles import Profile
from app.services.goal_service import goal_with_projection
from app.services.series_service import UTC_ZONE, local_today, series_for

HERO = ["fat_mass_kg", "lean_mass_kg"]
CARDS = ["body_fat_pct", "muscle_mass_kg"]
SECONDARY = ["weight_kg", "bmi", "waist_cm"]


def _r(value: float | None) -> float | None:
    return None if value is None else round(value, 2)


def _summary(
    conn: Conn,
    user_id: UUID,
    metric: str,
    profile: Profile | None,
    today: date,
    directions: dict[str, str],
) -> dict[str, Any]:
    series = series_for(conn, user_id, metric, profile, "3M", today)
    past = [p for p in series.trend if p.day <= today - timedelta(days=30)]
    change_30d = series.latest - past[-1].value if past and series.latest is not None else None
    return {
        "metric": metric,
        "label": series.label,
        "unit": series.unit,
        "latest": _r(series.latest),
        "change_30d": _r(change_30d),
        "goal_direction": directions.get(metric),
        "sparkline": [{"date": p.day, "value": round(p.value, 2)} for p in series.trend],
    }


def _days_since(conn: Conn, sql: str, user_id: UUID, profile: Profile | None, today: date) -> int | None:
    row = conn.execute(sql, (user_id,)).fetchone()
    if row is None or row["last"] is None:
        return None
    tz = profile.tz if profile else UTC_ZONE
    last: datetime = row["last"]
    return (today - last.astimezone(tz).date()).days


def build_dashboard(
    conn: Conn, user_id: UUID, profile: Profile | None, now: datetime
) -> dict[str, Any]:
    today = local_today(now, profile)
    active = list_rows(conn, "goals", user_id, "start_date", filters={"status": "active"})
    directions = {
        g["metric"]: ("up" if g["target_value"] > g["start_value"] else "down") for g in active
    }

    def group(metrics: list[str]) -> list[dict[str, Any]]:
        return [_summary(conn, user_id, m, profile, today, directions) for m in metrics]

    return {
        "hero": group(HERO),
        "cards": group(CARDS),
        "secondary": group(SECONDARY),
        "goals": [goal_with_projection(conn, user_id, g, profile, today) for g in active],
        "nudges": {
            "days_since_weigh_in": _days_since(
                conn,
                "select max(measured_at) as last from body_entries where user_id = %s",
                user_id,
                profile,
                today,
            ),
            "days_since_photo": _days_since(
                conn,
                "select max(taken_at) as last from progress_photos where user_id = %s",
                user_id,
                profile,
                today,
            ),
        },
    }
```

- [ ] **Step 5: Implement `backend/app/routers/dashboard.py`**

```python
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth import current_user_id
from app.clock import get_now
from app.db import Conn, get_conn
from app.profiles import load_profile
from app.schemas import DashboardOut
from app.services.dashboard_service import build_dashboard

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
def get_dashboard(
    user_id: UUID = Depends(current_user_id),
    conn: Conn = Depends(get_conn),
    now: datetime = Depends(get_now),
) -> dict[str, Any]:
    return build_dashboard(conn, user_id, load_profile(conn, user_id), now)
```

- [ ] **Step 6: Register router**, then run tests

Run: `pytest tests/test_dashboard_api.py -v`
Expected: 2 passed

- [ ] **Step 7: Full backend check and commit**

Run: `ruff check . && ruff format --check . && mypy app && pytest -v`
Expected: all backend tests pass.

```bash
git add backend
git commit -m "feat(backend): add dashboard endpoint"
```

---
## Phase B — Frontend

Frontend conventions:
- The Vite `react-ts` template enables `verbatimModuleSyntax` and `erasableSyntaxOnly`. Use `import type` for types, and don't use TypeScript parameter properties or enums.
- Tests use Vitest + Testing Library. Mock modules with `vi.mock(...)`, and never hit the network in unit tests.
- Number inputs are `type="text" inputMode="decimal"` so a comma decimal ("82,4") works. The zod helpers in `lib/forms.ts` accept both "," and ".".
- **Visual design:** before writing UI in Task 13, invoke the `frontend-design:frontend-design` skill to settle the palette and type. Before Task 19, invoke the `dataviz` skill for chart colors and marks. Keep the **token names** in `src/index.css` exactly as listed (other tasks use them as Tailwind classes such as `bg-surface`, `text-muted`, `text-good`); only their values may change.

### Task 13: Frontend scaffold, theme tokens, formatting helpers, CI

**Files:**
- Create: `frontend/` (from the Vite template), `frontend/vite.config.ts`, `frontend/src/index.css`, `frontend/src/test/setup.ts`, `frontend/public/icon.svg`, `frontend/.env.example`, `frontend/src/lib/format.ts`
- Modify: `frontend/package.json` (scripts), `frontend/index.html`, `.github/workflows/ci.yml`
- Delete: `frontend/src/App.css`, `frontend/src/assets/`
- Test: `frontend/src/lib/format.test.ts`

**Interfaces:**
- Produces (`src/lib/format.ts`):
  - `formatValue(value: number | null | undefined, unit?: string, digits?: number): string` (`"—"` for null; `"%"` attaches with no space)
  - `formatChange(value, unit?, digits?): string` (signed with `+`, `−`, `±`)
  - `formatDay(isoDate: string): string` (`"2026-02-28"` → `"28 Feb"`)
  - `formatDateTime(iso: string): string`
  - `toLocalInputValue(d: Date): string` (`YYYY-MM-DDTHH:mm` for `<input type="datetime-local">`), `localInputToIso(v: string): string`
  - `type Direction = "up" | "down"`, `type Tone = "good" | "bad" | "neutral"`, `changeTone(change: number | null, direction: Direction | null): Tone`
- Tailwind tokens (as `@theme` CSS variables): `bg, surface, surface-2, border, text, muted, accent, good, bad, series-1, series-2`

- [ ] **Step 1: Create the Vite app and install dependencies**

Run from repo root:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install react-router @tanstack/react-query @supabase/supabase-js zod react-hook-form @hookform/resolvers recharts lucide-react
npm install -D tailwindcss @tailwindcss/vite vite-plugin-pwa vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test
rm -rf src/App.css src/assets
```

If `create vite` asks whether to install and start the dev server, answer **No**.

- [ ] **Step 2: Set scripts in `frontend/package.json`**

Replace the `"scripts"` block with:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "lint": "eslint .",
  "typecheck": "tsc -b",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test"
}
```

- [ ] **Step 3: Write `frontend/vite.config.ts`**

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "BodyOS",
        short_name: "BodyOS",
        description: "Track body composition, trends and progress.",
        start_url: "/",
        display: "standalone",
        background_color: "#0e1116",
        theme_color: "#0e1116",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: { navigateFallbackDenylist: [/^\/api/] },
    }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
```

- [ ] **Step 4: Write `frontend/src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

- [ ] **Step 5: Invoke `frontend-design:frontend-design`, then write `frontend/src/index.css`**

Use the skill to choose the palette, font pairing and overall tone for a data-dense, calm, "instrument panel" feel. Keep the token **names** below and adjust only the values:

```css
@import "tailwindcss";

@theme {
  --color-bg: #0e1116;
  --color-surface: #161a21;
  --color-surface-2: #1e242d;
  --color-border: #2a313c;
  --color-text: #e8ecf1;
  --color-muted: #8a94a6;
  --color-accent: #7cc4a0;
  --color-good: #4cc38a;
  --color-bad: #e5675b;
  --color-series-1: #5aa9e6;
  --color-series-2: #e9a23b;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}

html,
body,
#root {
  min-height: 100dvh;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

.tabular {
  font-variant-numeric: tabular-nums;
}
```

Update `frontend/index.html`: set `<title>BodyOS</title>`, add `<meta name="theme-color" content="#0e1116" />`, change the favicon link to `/icon.svg`, and add the Google Fonts `<link>` tags for the chosen fonts.

- [ ] **Step 6: Create `frontend/public/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0e1116"/>
  <path d="M96 340 L196 250 L276 300 L416 160" fill="none" stroke="#7cc4a0" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="416" cy="160" r="28" fill="#7cc4a0"/>
</svg>
```

- [ ] **Step 7: Create `frontend/.env.example`**

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:8000
```

- [ ] **Step 8: Write failing tests `frontend/src/lib/format.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  changeTone,
  formatChange,
  formatDay,
  formatValue,
  localInputToIso,
  toLocalInputValue,
} from "./format";

describe("formatValue", () => {
  it("formats numbers with units", () => {
    expect(formatValue(82.44, "kg")).toBe("82.4 kg");
    expect(formatValue(18.25, "%")).toBe("18.3%");
    expect(formatValue(24.7)).toBe("24.7");
    expect(formatValue(1780, "kcal", 0)).toBe("1780 kcal");
  });
  it("uses an em dash for missing values", () => {
    expect(formatValue(null, "kg")).toBe("—");
    expect(formatValue(undefined)).toBe("—");
  });
});

describe("formatChange", () => {
  it("adds a sign", () => {
    expect(formatChange(-0.42, "kg")).toBe("−0.4 kg");
    expect(formatChange(1.25, "%")).toBe("+1.3%");
    expect(formatChange(0, "kg")).toBe("±0.0 kg");
    expect(formatChange(null)).toBe("—");
  });
});

describe("dates", () => {
  it("formats a calendar day", () => {
    expect(formatDay("2026-02-28")).toBe("28 Feb");
  });
  it("round-trips datetime-local values", () => {
    const d = new Date(2026, 1, 28, 7, 5);
    expect(toLocalInputValue(d)).toBe("2026-02-28T07:05");
    expect(new Date(localInputToIso("2026-02-28T07:05")).getTime()).toBe(d.getTime());
  });
});

describe("changeTone", () => {
  it("is good when moving in the goal direction", () => {
    expect(changeTone(-0.5, "down")).toBe("good");
    expect(changeTone(0.3, "up")).toBe("good");
  });
  it("is bad when moving against it", () => {
    expect(changeTone(0.5, "down")).toBe("bad");
  });
  it("is neutral without a direction or change", () => {
    expect(changeTone(0.5, null)).toBe("neutral");
    expect(changeTone(null, "up")).toBe("neutral");
    expect(changeTone(0, "up")).toBe("neutral");
  });
});
```

- [ ] **Step 9: Run to verify failure**

Run: `npm test -- src/lib/format.test.ts`
Expected: FAIL, `Failed to resolve import "./format"`

- [ ] **Step 10: Implement `frontend/src/lib/format.ts`**

```ts
export type Direction = "up" | "down";
export type Tone = "good" | "bad" | "neutral";

export function formatValue(value: number | null | undefined, unit = "", digits = 1): string {
  if (value == null) return "—";
  const n = value.toFixed(digits);
  if (!unit) return n;
  return unit === "%" ? `${n}%` : `${n} ${unit}`;
}

export function formatChange(value: number | null | undefined, unit = "", digits = 1): string {
  if (value == null) return "—";
  const rounded = Number(value.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${formatValue(Math.abs(value), unit, digits)}`;
}

export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInputValue(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

export function changeTone(change: number | null | undefined, direction: Direction | null): Tone {
  if (change == null || direction == null || Math.abs(change) < 1e-9) return "neutral";
  return change > 0 === (direction === "up") ? "good" : "bad";
}
```

- [ ] **Step 11: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: tests pass; lint/typecheck clean; build outputs `dist/` with `manifest.webmanifest` and `sw.js`. (The template's `src/App.tsx` still exists and still builds; Task 15 replaces it. Remove its `App.css` and asset imports now so it compiles.)

- [ ] **Step 12: Add a frontend job to `.github/workflows/ci.yml`**

```yaml
  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 13: Commit**

```bash
git add frontend .github
git commit -m "feat(frontend): scaffold Vite React PWA with theme tokens and formatting helpers"
```

---

### Task 14: API client, types and query hooks

**Files:**
- Create: `frontend/src/lib/env.ts`, `frontend/src/lib/supabase.ts`, `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`, `frontend/src/lib/queries.ts`
- Test: `frontend/src/lib/api.test.ts`, `frontend/src/lib/queries.test.tsx`

**Interfaces:**
- Produces:
  - `env: { supabaseUrl: string; supabaseAnonKey: string; apiUrl: string; photoBucket: string }`
  - `supabase` (supabase-js client)
  - `class ApiError extends Error { status: number; fieldErrors: Record<string, string> }`
  - `api<T>(path: string, options?: RequestInit & { json?: unknown }): Promise<T>`: adds `Authorization`, 60 s timeout, maps 422 → `fieldErrors`, 401 → calls the unauthorized handler, 204 → `undefined`
  - `setTokenGetter(fn: () => Promise<string | null>)`, `setUnauthorizedHandler(fn: () => void)`, `onSlowRequest(fn: (slow: boolean) => void): () => void`, `SLOW_MS = 3000`, `TIMEOUT_MS = 60000`
  - Types in `types.ts` (below)
  - Query hooks in `queries.ts`: `qk`, `invalidateDerived(qc)`, `useProfile()`, `useSaveProfile()`, `bodyEntries.{useList,useCreate,useUpdate,useDelete}`, `measurements.{…same}`, `goals.{…same}`, `usePhotos(pose?)`, `useDeletePhoto()`, `useSeries(metric, range, enabled?)`, `useDashboard()`, `useNavyPreview(waist, neck, hips)`
  - Every mutation invalidates its own list **and** `["series"]`, `["dashboard"]`, `["goals"]`

- [ ] **Step 1: Write `frontend/src/lib/env.ts` and `frontend/src/lib/supabase.ts`**

```ts
// env.ts
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key",
  apiUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  photoBucket: "progress-photos",
};
```

```ts
// supabase.ts
import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
```

- [ ] **Step 2: Write `frontend/src/lib/types.ts`**

```ts
export type Sex = "male" | "female";
export type ScaleField =
  | "body_fat_pct"
  | "muscle_mass_kg"
  | "skeletal_muscle_pct"
  | "body_water_pct"
  | "bone_mass_kg"
  | "visceral_fat"
  | "protein_pct"
  | "bmr_kcal"
  | "metabolic_age";
export type TapeField = "waist_cm" | "hips_cm" | "chest_cm" | "neck_cm" | "arm_cm" | "thigh_cm";

export type Profile = {
  height_cm: number;
  sex: Sex;
  date_of_birth: string;
  timezone: string;
  hidden_metrics: ScaleField[];
};

export type BodyEntryInput = { measured_at: string; weight_kg: number; note: string | null } & Record<
  ScaleField,
  number | null
>;
export type BodyEntry = BodyEntryInput & { id: string };

export type MeasurementInput = { measured_at: string; note: string | null } & Record<TapeField, number | null>;
export type Measurement = MeasurementInput & { id: string; navy_body_fat_pct: number | null };

export type Pose = "front" | "side" | "back";
export type Photo = { id: string; taken_at: string; pose: Pose; note: string | null; url: string };
export type UploadTicket = { photo_id: string; path: string; token: string };

export type GoalMetric =
  | "weight_kg"
  | "body_fat_pct"
  | "muscle_mass_kg"
  | "fat_mass_kg"
  | "lean_mass_kg"
  | "waist_cm"
  | "navy_body_fat_pct";
export type GoalStatus = "active" | "achieved" | "archived";
export type ProjectionState = "insufficient_data" | "reached" | "not_on_pace" | "on_track";
export type GoalInput = { metric: GoalMetric; target_value: number; target_date: string | null };
export type GoalPatch = Partial<{ target_value: number; target_date: string | null; status: GoalStatus }>;
export type Goal = {
  id: string;
  metric: GoalMetric;
  start_value: number;
  target_value: number;
  start_date: string;
  target_date: string | null;
  status: GoalStatus;
  projection: {
    current: number | null;
    progress_pct: number | null;
    state: ProjectionState;
    projected_date: string | null;
  };
};

export type Point = { date: string; value: number };
export type RangeKey = "1M" | "3M" | "6M" | "1Y" | "ALL";
export type Series = {
  metric: string;
  label: string;
  unit: string;
  points: Point[];
  trend: Point[];
  change: number | null;
  weekly_rate: number | null;
  min: number | null;
  max: number | null;
  latest: number | null;
};

export type MetricSummary = {
  metric: string;
  label: string;
  unit: string;
  latest: number | null;
  change_30d: number | null;
  goal_direction: "up" | "down" | null;
  sparkline: Point[];
};
export type Dashboard = {
  hero: MetricSummary[];
  cards: MetricSummary[];
  secondary: MetricSummary[];
  goals: Goal[];
  nudges: { days_since_weigh_in: number | null; days_since_photo: number | null };
};
```

- [ ] **Step 3: Write failing tests `frontend/src/lib/api.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({ env: { apiUrl: "http://api.test" } }));

import { ApiError, SLOW_MS, api, onSlowRequest, setTokenGetter, setUnauthorizedHandler } from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    setTokenGetter(async () => "tok");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and JSON body", async () => {
    fetchMock.mockResolvedValue(json(200, { ok: true }));
    await api("/body-entries", { method: "POST", json: { weight_kg: 80 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/body-entries");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(init.body).toBe('{"weight_kg":80}');
  });

  it("maps 422 validation errors to fields", async () => {
    fetchMock.mockResolvedValue(
      json(422, { detail: [{ loc: ["body", "weight_kg"], msg: "Input should be less than or equal to 400" }] }),
    );
    const err = await api("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.fieldErrors).toEqual({ weight_kg: "Input should be less than or equal to 400" });
  });

  it("uses model-level 422 messages as the general message", async () => {
    fetchMock.mockResolvedValue(json(422, { detail: [{ loc: ["body"], msg: "Value error, Enter at least one measurement" }] }));
    const err = await api("/x").catch((e) => e);
    expect(err.message).toBe("Enter at least one measurement");
  });

  it("uses string details as the message", async () => {
    fetchMock.mockResolvedValue(json(409, { detail: "You already have an active Body fat goal" }));
    await expect(api("/x")).rejects.toThrow("You already have an active Body fat goal");
  });

  it("returns undefined for 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api("/x", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("wraps network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await api("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
  });

  it("calls the unauthorized handler on 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(json(401, { detail: "Invalid or expired token" }));
    await expect(api("/x")).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("reports slow requests while they are pending", async () => {
    vi.useFakeTimers();
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const states: boolean[] = [];
    const off = onSlowRequest((s) => states.push(s));
    const pending = api("/x");
    await vi.advanceTimersByTimeAsync(SLOW_MS + 10);
    expect(states).toEqual([true]);
    resolve(json(200, {}));
    await pending;
    expect(states).toEqual([true, false]);
    off();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm test -- src/lib/api.test.ts`
Expected: FAIL, `Failed to resolve import "./api"`

- [ ] **Step 5: Implement `frontend/src/lib/api.ts`**

```ts
import { env } from "./env";

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export const SLOW_MS = 3_000;
export const TIMEOUT_MS = 60_000;

let getToken: () => Promise<string | null> = async () => null;
let onUnauthorized: () => void = () => {};
const slowListeners = new Set<(slow: boolean) => void>();
let slowCount = 0;

export function setTokenGetter(fn: () => Promise<string | null>): void {
  getToken = fn;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export function onSlowRequest(fn: (slow: boolean) => void): () => void {
  slowListeners.add(fn);
  return () => {
    slowListeners.delete(fn);
  };
}

function bumpSlow(delta: number): void {
  slowCount += delta;
  const slow = slowCount > 0;
  slowListeners.forEach((listener) => listener(slow));
}

type ValidationItem = { loc: (string | number)[]; msg: string };

function toApiError(status: number, data: unknown): ApiError {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (status === 422 && Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    let general: string | null = null;
    for (const item of detail as ValidationItem[]) {
      const field = item.loc[item.loc.length - 1];
      const msg = item.msg.replace(/^Value error, /, "");
      if (typeof field === "string" && field !== "body") fieldErrors[field] = msg;
      else general = msg;
    }
    return new ApiError(422, general ?? "Please fix the highlighted fields.", fieldErrors);
  }
  if (typeof detail === "string") return new ApiError(status, detail);
  return new ApiError(status, status >= 500 ? "Something went wrong. Please try again." : "Request failed.");
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers: initHeaders, ...init } = options;
  const headers = new Headers(initHeaders);
  const token = await getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let markedSlow = false;
  const slowTimer = setTimeout(() => {
    markedSlow = true;
    bumpSlow(1);
  }, SLOW_MS);

  let res: Response;
  try {
    res = await fetch(`${env.apiUrl}${path}`, { ...init, headers, body, signal: controller.signal });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "AbortError";
    throw new ApiError(
      0,
      timedOut
        ? "The server took too long to respond. Please try again."
        : "Network error. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeout);
    clearTimeout(slowTimer);
    if (markedSlow) bumpSlow(-1);
  }

  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, data);
  return data as T;
}
```

- [ ] **Step 6: Run api tests**

Run: `npm test -- src/lib/api.test.ts`
Expected: 8 passed

- [ ] **Step 7: Write failing test `frontend/src/lib/queries.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./api", async (orig) => ({
  ...(await orig<typeof import("./api")>()),
  api: vi.fn().mockResolvedValue({ id: "1" }),
}));

import { api } from "./api";
import { bodyEntries, qk } from "./queries";

describe("mutations", () => {
  it("creating a body entry invalidates list, series, dashboard and goals", async () => {
    const qc = new QueryClient();
    for (const key of [qk.bodyEntries, qk.series("weight_kg", "3M"), qk.dashboard, qk.goals]) {
      qc.setQueryData(key, { cached: true });
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => bodyEntries.useCreate(), { wrapper });
    await act(() => result.current.mutateAsync({ weight_kg: 80 } as never));

    expect(api).toHaveBeenCalledWith("/body-entries", { method: "POST", json: { weight_kg: 80 } });
    for (const key of [qk.bodyEntries, qk.series("weight_kg", "3M"), qk.dashboard, qk.goals]) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });
});
```

- [ ] **Step 8: Implement `frontend/src/lib/queries.ts`**

```ts
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  BodyEntry,
  BodyEntryInput,
  Dashboard,
  Goal,
  GoalInput,
  GoalPatch,
  Measurement,
  MeasurementInput,
  Photo,
  Pose,
  Profile,
  RangeKey,
  Series,
} from "./types";

export const qk = {
  profile: ["profile"] as const,
  bodyEntries: ["body-entries"] as const,
  measurements: ["measurements"] as const,
  goals: ["goals"] as const,
  dashboard: ["dashboard"] as const,
  photos: (pose?: Pose) => ["photos", pose ?? "all"] as const,
  series: (metric: string, range: RangeKey) => ["series", metric, range] as const,
  navy: (w: number, n: number, h: number | null) => ["navy", w, n, h] as const,
};

export function invalidateDerived(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["series"] });
  void qc.invalidateQueries({ queryKey: qk.dashboard });
  void qc.invalidateQueries({ queryKey: qk.goals });
}

export function useProfile() {
  return useQuery({ queryKey: qk.profile, queryFn: () => api<Profile>("/me/profile") });
}

export function useSaveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: Profile) => api<Profile>("/me/profile", { method: "PUT", json: profile }),
    onSuccess: (saved) => {
      qc.setQueryData(qk.profile, saved);
      invalidateDerived(qc);
    },
  });
}

function crudHooks<T, TCreate, TPatch>(path: string, listKey: readonly string[]) {
  return {
    useList: () => useQuery({ queryKey: listKey, queryFn: () => api<T[]>(path) }),
    useCreate: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (body: TCreate) => api<T>(path, { method: "POST", json: body }),
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: listKey });
          invalidateDerived(qc);
        },
      });
    },
    useUpdate: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: ({ id, body }: { id: string; body: TPatch }) =>
          api<T>(`${path}/${id}`, { method: "PATCH", json: body }),
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: listKey });
          invalidateDerived(qc);
        },
      });
    },
    useDelete: () => {
      const qc = useQueryClient();
      return useMutation({
        mutationFn: (id: string) => api<void>(`${path}/${id}`, { method: "DELETE" }),
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: listKey });
          invalidateDerived(qc);
        },
      });
    },
  };
}

export const bodyEntries = crudHooks<BodyEntry, BodyEntryInput, Partial<BodyEntryInput>>(
  "/body-entries",
  qk.bodyEntries,
);
export const measurements = crudHooks<Measurement, MeasurementInput, Partial<MeasurementInput>>(
  "/measurements",
  qk.measurements,
);
export const goals = crudHooks<Goal, GoalInput, GoalPatch>("/goals", qk.goals);

export function usePhotos(pose?: Pose) {
  return useQuery({
    queryKey: qk.photos(pose),
    queryFn: () => api<Photo[]>(pose ? `/photos?pose=${pose}` : "/photos"),
    staleTime: 30 * 60_000, // signed URLs last 60 minutes
  });
}

export function useDeletePhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/photos/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["photos"] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function useSeries(metric: string, range: RangeKey, enabled = true) {
  return useQuery({
    queryKey: qk.series(metric, range),
    queryFn: () => api<Series>(`/series?metric=${encodeURIComponent(metric)}&range=${range}`),
    enabled,
  });
}

export function useDashboard() {
  return useQuery({ queryKey: qk.dashboard, queryFn: () => api<Dashboard>("/dashboard") });
}

export function useNavyPreview(waist: number | null, neck: number | null, hips: number | null) {
  return useQuery({
    queryKey: qk.navy(waist ?? 0, neck ?? 0, hips),
    queryFn: () => {
      const params = new URLSearchParams({ waist_cm: String(waist), neck_cm: String(neck) });
      if (hips != null) params.set("hips_cm", String(hips));
      return api<{ navy_body_fat_pct: number | null }>(`/measurements/navy-preview?${params}`);
    },
    enabled: waist != null && neck != null,
    staleTime: Infinity,
  });
}
```

- [ ] **Step 9: Run tests, lint, typecheck**

Run: `npm test && npm run lint && npm run typecheck`
Expected: all pass

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib
git commit -m "feat(frontend): add API client, shared types and query hooks"
```

---

### Task 15: Auth, route guards and app shell

**Files:**
- Create: `frontend/src/auth/AuthProvider.tsx`, `frontend/src/auth/RequireAuth.tsx`, `frontend/src/auth/RequireProfile.tsx`, `frontend/src/components/EmptyState.tsx`, `frontend/src/components/WakingBanner.tsx`, `frontend/src/components/AppLayout.tsx`, `frontend/src/pages/SignIn.tsx`, `frontend/src/pages/Home.tsx` (temporary heading; replaced in Task 20)
- Modify: `frontend/src/App.tsx` (replace), `frontend/src/main.tsx` (replace)
- Test: `frontend/src/auth/RequireAuth.test.tsx`, `frontend/src/pages/SignIn.test.tsx`, `frontend/src/components/WakingBanner.test.tsx`

**Interfaces:**
- Produces:
  - `AuthProvider`, `useAuth(): { session: Session | null; loading: boolean }`
  - `RequireAuth` (layout route: redirects to `/sign-in?next=<path+search>` when signed out)
  - `RequireProfile({ children })` (redirects to `/onboarding` on 404)
  - `safeNext(value: string | null): string` exported from `pages/SignIn.tsx` (only same-origin paths; default `/`)
  - `EmptyState({ title, body?, action? })`, `ErrorState({ message, onRetry? })`, `Spinner()`
  - `WakingBanner` (visible while `onSlowRequest` reports `true`)
  - `AppLayout` (sidebar ≥ md, bottom nav < md, `<Outlet/>`, warm-up ping). Exports `LogTab = "weigh-in" | "measurements" | "photo"` and `useLogSheet(): { open: (tab?: LogTab) => void }`
  - `App` routes: `/sign-in`, then (auth → profile → layout) `/`. Later tasks add routes inside the layout route.

- [ ] **Step 1: Write failing tests**

`frontend/src/auth/RequireAuth.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

const auth = { session: null as unknown, loading: false };
vi.mock("./AuthProvider", () => ({ useAuth: () => auth }));

import { RequireAuth } from "./RequireAuth";

function SignInProbe() {
  const location = useLocation();
  return <p>sign-in {location.search}</p>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in" element={<SignInProbe />} />
        <Route element={<RequireAuth />}>
          <Route path="/trends" element={<p>trends page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireAuth", () => {
  it("redirects signed-out users to sign-in and remembers where they were", () => {
    auth.session = null;
    renderAt("/trends?metric=weight_kg");
    expect(screen.getByText(`sign-in ?next=${encodeURIComponent("/trends?metric=weight_kg")}`)).toBeInTheDocument();
  });

  it("renders the page for signed-in users", () => {
    auth.session = { access_token: "t" };
    renderAt("/trends");
    expect(screen.getByText("trends page")).toBeInTheDocument();
  });
});
```

`frontend/src/pages/SignIn.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { signInWithPassword: (...a: unknown[]) => signInWithPassword(...a), signUp: vi.fn(), signInWithOAuth: vi.fn() } },
}));
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ session: null, loading: false }) }));

import { SignIn, safeNext } from "./SignIn";

describe("safeNext", () => {
  it("only allows same-origin paths", () => {
    expect(safeNext("/trends?x=1")).toBe("/trends?x=1");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("SignIn", () => {
  it("signs in and returns to the next path", async () => {
    signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    render(
      <MemoryRouter initialEntries={["/sign-in?next=%2Ftrends"]}>
        <Routes>
          <Route path="/sign-in" element={<SignIn />} />
          <Route path="/trends" element={<p>trends page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter22");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "me@example.com", password: "hunter22" });
    expect(await screen.findByText("trends page")).toBeInTheDocument();
  });

  it("shows the auth error", async () => {
    signInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: "Invalid login credentials" } });
    render(
      <MemoryRouter initialEntries={["/sign-in"]}>
        <SignIn />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
  });
});
```

`frontend/src/components/WakingBanner.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let emit: (slow: boolean) => void = () => {};
vi.mock("../lib/api", () => ({
  onSlowRequest: (fn: (slow: boolean) => void) => {
    emit = fn;
    return () => {};
  },
}));

import { WakingBanner } from "./WakingBanner";

describe("WakingBanner", () => {
  it("appears while a request is slow", () => {
    render(<WakingBanner />);
    expect(screen.queryByText(/Waking up server/)).not.toBeInTheDocument();
    act(() => emit(true));
    expect(screen.getByText(/Waking up server/)).toBeInTheDocument();
    act(() => emit(false));
    expect(screen.queryByText(/Waking up server/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/auth src/pages src/components`
Expected: FAIL, unresolved imports

- [ ] **Step 3: Implement `frontend/src/auth/AuthProvider.tsx`**

```tsx
import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type AuthState = { session: Session | null; loading: boolean };
const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
```

- [ ] **Step 4: Implement `frontend/src/components/EmptyState.tsx`**

```tsx
import type { ReactNode } from "react";

export function Spinner() {
  return (
    <div className="flex min-h-40 items-center justify-center" role="status" aria-label="Loading">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-6 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-4 text-sm">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-surface-2 px-3 py-1.5">
          Retry
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Implement `frontend/src/auth/RequireAuth.tsx` and `frontend/src/auth/RequireProfile.tsx`**

```tsx
// RequireAuth.tsx
import { Navigate, Outlet, useLocation } from "react-router";
import { Spinner } from "../components/EmptyState";
import { useAuth } from "./AuthProvider";

export function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?next=${next}`} replace />;
  }
  return <Outlet />;
}
```

```tsx
// RequireProfile.tsx
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { ErrorState, Spinner } from "../components/EmptyState";
import { ApiError } from "../lib/api";
import { useProfile } from "../lib/queries";

export function RequireProfile({ children }: { children: ReactNode }) {
  const profile = useProfile();
  if (profile.isPending) return <Spinner />;
  if (profile.error instanceof ApiError && profile.error.status === 404) {
    return <Navigate to="/onboarding" replace />;
  }
  if (profile.isError) return <ErrorState message={profile.error.message} onRetry={() => void profile.refetch()} />;
  return <>{children}</>;
}
```

- [ ] **Step 6: Implement `frontend/src/pages/SignIn.tsx`**

```tsx
import { type FormEvent, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";

export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function SignIn() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const { session } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to={next} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (mode === "sign-in") {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (authError) return setError(authError.message);
      navigate(next, { replace: true });
    } else {
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      setBusy(false);
      if (authError) return setError(authError.message);
      if (!data.session) return setNotice("Check your email to confirm your account, then sign in.");
      navigate(next, { replace: true });
    }
  }

  async function google() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${next}` },
    });
  }

  const input = "w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none focus:border-accent";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="text-3xl font-semibold tracking-tight">BodyOS</h1>
      <p className="mt-1 text-muted">Your body, as data.</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Email</span>
          <input className={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Password</span>
          <input
            className={input}
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        {notice && <p className="text-sm text-good">{notice}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60">
          {mode === "sign-in" ? "Sign in" : "Create account"}
        </button>
      </form>
      <button type="button" onClick={() => void google()} className="mt-3 w-full rounded-xl border border-border py-2.5">
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
        className="mt-6 text-sm text-muted underline"
      >
        {mode === "sign-in" ? "New here? Create an account" : "Have an account? Sign in"}
      </button>
    </main>
  );
}
```

- [ ] **Step 7: Implement `frontend/src/components/WakingBanner.tsx`**

```tsx
import { useEffect, useState } from "react";
import { onSlowRequest } from "../lib/api";

export function WakingBanner() {
  const [slow, setSlow] = useState(false);
  useEffect(() => onSlowRequest(setSlow), []);
  if (!slow) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-3 z-50 mx-auto w-fit rounded-full bg-surface-2 px-4 py-2 text-sm shadow-lg">
      Waking up server… this can take up to a minute.
    </div>
  );
}
```

- [ ] **Step 8: Implement `frontend/src/components/AppLayout.tsx`**

```tsx
import { ChartLine, Ellipsis, House, Images, Plus } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { env } from "../lib/env";
import { WakingBanner } from "./WakingBanner";

export type LogTab = "weigh-in" | "measurements" | "photo";
type LogSheetApi = { open: (tab?: LogTab) => void };
const LogSheetContext = createContext<LogSheetApi>({ open: () => {} });

export function useLogSheet(): LogSheetApi {
  return useContext(LogSheetContext);
}

const NAV = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/trends", label: "Trends", icon: ChartLine, end: false },
  { to: "/photos", label: "Photos", icon: Images, end: false },
  { to: "/more", label: "More", icon: Ellipsis, end: false },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-2 ${isActive ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`;

export function AppLayout() {
  const [sheetTab, setSheetTab] = useState<LogTab | null>(null);
  const logSheet = useMemo<LogSheetApi>(() => ({ open: (tab = "weigh-in") => setSheetTab(tab) }), []);

  useEffect(() => {
    // Warm up the Render instance while the user looks around.
    void fetch(`${env.apiUrl}/health`).catch(() => {});
  }, []);

  return (
    <LogSheetContext.Provider value={logSheet}>
      <WakingBanner />
      <div className="md:flex">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-1 border-r border-border p-4 md:flex">
          <p className="mb-4 px-3 text-lg font-semibold">BodyOS</p>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
          <button type="button" onClick={() => logSheet.open()} className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-accent py-2 font-medium text-bg">
            <Plus size={18} /> Log
          </button>
        </aside>
        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:pb-10">
          <Outlet />
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.slice(0, 2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? "text-text" : "text-muted"}`}>
            <Icon size={20} /> {label}
          </NavLink>
        ))}
        <button type="button" aria-label="Log" onClick={() => logSheet.open()} className="mx-auto -mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-bg shadow-lg">
          <Plus size={26} />
        </button>
        {NAV.slice(2).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-xs ${isActive ? "text-text" : "text-muted"}`}>
            <Icon size={20} /> {label}
          </NavLink>
        ))}
      </nav>
      {sheetTab && <p className="sr-only">Log sheet: {sheetTab}</p>}
    </LogSheetContext.Provider>
  );
}
```

(The `sr-only` line stands in for the sheet so `sheetTab` is used. Task 16 replaces it with `<LogSheet …/>`.)

If the installed `lucide-react` version lacks `ChartLine` or `House`, use `LineChart` / `Home` (older names).

- [ ] **Step 9: Create `frontend/src/pages/Home.tsx`** (temporary; Task 20 replaces it)

```tsx
export function Home() {
  return <h1 className="text-2xl font-semibold">Home</h1>;
}
```

- [ ] **Step 10: Replace `frontend/src/App.tsx` and `frontend/src/main.tsx`**

```tsx
// App.tsx
import { Navigate, Route, Routes } from "react-router";
import { RequireAuth } from "./auth/RequireAuth";
import { RequireProfile } from "./auth/RequireProfile";
import { AppLayout } from "./components/AppLayout";
import { Home } from "./pages/Home";
import { SignIn } from "./pages/SignIn";

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route element={<RequireAuth />}>
        <Route
          element={
            <RequireProfile>
              <AppLayout />
            </RequireProfile>
          }
        >
          <Route index element={<Home />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

```tsx
// main.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import "./index.css";
import { ApiError, setTokenGetter, setUnauthorizedHandler } from "./lib/api";
import { supabase } from "./lib/supabase";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

setTokenGetter(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null);
setUnauthorizedHandler(() => {
  if (window.location.pathname.startsWith("/sign-in")) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  void supabase.auth.signOut().finally(() => window.location.assign(`/sign-in?next=${next}`));
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 11: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass

- [ ] **Step 12: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add auth, route guards, sign-in and responsive app shell"
```

---
### Task 16: Metric catalogue, weigh-in and measurement forms, log sheet

**Files:**
- Create: `frontend/src/lib/metrics.ts`, `frontend/src/lib/forms.ts`, `frontend/src/components/Field.tsx`, `frontend/src/forms/WeighInForm.tsx`, `frontend/src/forms/MeasurementForm.tsx`, `frontend/src/components/LogSheet.tsx`
- Modify: `frontend/src/components/AppLayout.tsx` (render `LogSheet`)
- Test: `frontend/src/lib/forms.test.ts`, `frontend/src/forms/WeighInForm.test.tsx`, `frontend/src/forms/MeasurementForm.test.tsx`

**Interfaces:**
- Consumes: `bodyEntries`, `measurements`, `useProfile`, `useNavyPreview`, `ApiError`, `toLocalInputValue`, `localInputToIso`, `useLogSheet`/`LogTab`
- Produces:
  - `lib/metrics.ts`: `type FieldSpec = { key: string; label: string; unit: string; min: number; max: number; step: number }`; `WEIGHT: FieldSpec`; `SCALE_FIELDS: (FieldSpec & { key: ScaleField })[]`; `TAPE_FIELDS: (FieldSpec & { key: TapeField })[]`; `SERIES_METRICS: { key: string; label: string; unit: string; group: "Composition" | "Scale" | "Tape" }[]`; `GOAL_METRICS: { key: GoalMetric; label: string; unit: string }[]`; `metricInfo(key: string): { label: string; unit: string }`
  - `lib/forms.ts`: `requiredNumber(min, max)`, `optionalNumber(min, max)` (zod string → number schemas; accept `,` decimals), `applyServerErrors(error: unknown, setError, knownFields: string[]): string` (sets field errors and returns a general message)
  - `Field` component: `{ label, unit?, error?, hint?, ref?, ...input props }`
  - `WeighInForm({ hiddenMetrics, lastValues?, initial?, submitLabel?, onSubmit })`: `lastValues` is any record (only numeric values are used as placeholders); `onSubmit(payload: BodyEntryInput) => Promise<void>`
  - `MeasurementForm({ sex, lastValues?, initial?, submitLabel?, onSubmit })`: `onSubmit(payload: MeasurementInput) => Promise<void>`
  - `LogSheet({ initialTab: LogTab; onClose: () => void })`

- [ ] **Step 1: Write `frontend/src/lib/metrics.ts`**

```ts
import type { GoalMetric, ScaleField, TapeField } from "./types";

export type FieldSpec = { key: string; label: string; unit: string; min: number; max: number; step: number };

export const WEIGHT: FieldSpec = { key: "weight_kg", label: "Weight", unit: "kg", min: 20, max: 400, step: 0.1 };

export const SCALE_FIELDS: (FieldSpec & { key: ScaleField })[] = [
  { key: "body_fat_pct", label: "Body fat", unit: "%", min: 2, max: 70, step: 0.1 },
  { key: "muscle_mass_kg", label: "Muscle mass", unit: "kg", min: 5, max: 200, step: 0.1 },
  { key: "skeletal_muscle_pct", label: "Skeletal muscle", unit: "%", min: 5, max: 80, step: 0.1 },
  { key: "body_water_pct", label: "Body water", unit: "%", min: 20, max: 80, step: 0.1 },
  { key: "bone_mass_kg", label: "Bone mass", unit: "kg", min: 0.5, max: 10, step: 0.1 },
  { key: "visceral_fat", label: "Visceral fat", unit: "", min: 1, max: 60, step: 0.5 },
  { key: "protein_pct", label: "Protein", unit: "%", min: 5, max: 30, step: 0.1 },
  { key: "bmr_kcal", label: "BMR", unit: "kcal", min: 500, max: 5000, step: 1 },
  { key: "metabolic_age", label: "Metabolic age", unit: "yrs", min: 10, max: 100, step: 1 },
];

export const TAPE_FIELDS: (FieldSpec & { key: TapeField })[] = [
  { key: "waist_cm", label: "Waist", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "hips_cm", label: "Hips", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "chest_cm", label: "Chest", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "neck_cm", label: "Neck", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "arm_cm", label: "Arm", unit: "cm", min: 10, max: 250, step: 0.1 },
  { key: "thigh_cm", label: "Thigh", unit: "cm", min: 10, max: 250, step: 0.1 },
];

type Group = "Composition" | "Scale" | "Tape";
export const SERIES_METRICS: { key: string; label: string; unit: string; group: Group }[] = [
  { key: "fat_mass_kg", label: "Fat mass", unit: "kg", group: "Composition" },
  { key: "lean_mass_kg", label: "Lean mass", unit: "kg", group: "Composition" },
  { key: "body_fat_pct", label: "Body fat", unit: "%", group: "Composition" },
  { key: "muscle_mass_kg", label: "Muscle mass", unit: "kg", group: "Composition" },
  { key: "navy_body_fat_pct", label: "Body fat (Navy)", unit: "%", group: "Composition" },
  { key: "weight_kg", label: "Weight", unit: "kg", group: "Scale" },
  { key: "bmi", label: "BMI", unit: "", group: "Scale" },
  ...SCALE_FIELDS.filter((f) => !["body_fat_pct", "muscle_mass_kg"].includes(f.key)).map((f) => ({
    key: f.key,
    label: f.label,
    unit: f.unit,
    group: "Scale" as const,
  })),
  ...TAPE_FIELDS.map((f) => ({ key: f.key, label: f.label, unit: f.unit, group: "Tape" as const })),
];

export const GOAL_METRICS: { key: GoalMetric; label: string; unit: string }[] = [
  { key: "body_fat_pct", label: "Body fat", unit: "%" },
  { key: "muscle_mass_kg", label: "Muscle mass", unit: "kg" },
  { key: "fat_mass_kg", label: "Fat mass", unit: "kg" },
  { key: "lean_mass_kg", label: "Lean mass", unit: "kg" },
  { key: "weight_kg", label: "Weight", unit: "kg" },
  { key: "waist_cm", label: "Waist", unit: "cm" },
  { key: "navy_body_fat_pct", label: "Body fat (Navy)", unit: "%" },
];

export function metricInfo(key: string): { label: string; unit: string } {
  const found = SERIES_METRICS.find((m) => m.key === key);
  return found ? { label: found.label, unit: found.unit } : { label: key, unit: "" };
}
```

- [ ] **Step 2: Write failing tests `frontend/src/lib/forms.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { applyServerErrors, optionalNumber, requiredNumber } from "./forms";

describe("number schemas", () => {
  it("parses dot and comma decimals", () => {
    expect(requiredNumber(20, 400).parse("82.4")).toBe(82.4);
    expect(requiredNumber(20, 400).parse(" 82,4 ")).toBe(82.4);
  });
  it("rejects empty required values and out-of-range values", () => {
    expect(requiredNumber(20, 400).safeParse("").success).toBe(false);
    const res = requiredNumber(20, 400).safeParse("805");
    expect(res.success).toBe(false);
    expect(res.error?.issues[0].message).toBe("Must be between 20 and 400");
    expect(requiredNumber(20, 400).safeParse("abc").error?.issues[0].message).toBe("Enter a number");
  });
  it("treats empty optional values as undefined", () => {
    expect(optionalNumber(2, 70).parse("")).toBeUndefined();
    expect(optionalNumber(2, 70).parse("18.5")).toBe(18.5);
    expect(optionalNumber(2, 70).safeParse("95").success).toBe(false);
  });
});

describe("applyServerErrors", () => {
  it("maps known fields and returns the general message", () => {
    const setError = vi.fn();
    const msg = applyServerErrors(
      new ApiError(422, "Please fix the highlighted fields.", { weight_kg: "too big", other: "x" }),
      setError,
      ["weight_kg"],
    );
    expect(setError).toHaveBeenCalledWith("weight_kg", { message: "too big" });
    expect(setError).toHaveBeenCalledTimes(1);
    expect(msg).toBe("Please fix the highlighted fields.");
  });
  it("returns a friendly message for unknown errors", () => {
    expect(applyServerErrors(new Error("boom"), vi.fn(), [])).toBe(
      "Couldn't save. Your entry is still here, so try again.",
    );
  });
});
```

- [ ] **Step 3: Implement `frontend/src/lib/forms.ts`**

```ts
import { z } from "zod";
import { ApiError } from "./api";

function parseNumber(raw: string, min: number, max: number, ctx: z.RefinementCtx): number {
  const n = Number(raw.replace(",", "."));
  if (Number.isNaN(n)) {
    ctx.addIssue({ code: "custom", message: "Enter a number" });
    return z.NEVER;
  }
  if (n < min || n > max) {
    ctx.addIssue({ code: "custom", message: `Must be between ${min} and ${max}` });
    return z.NEVER;
  }
  return n;
}

export const requiredNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, "Required")
    .transform((v, ctx) => parseNumber(v, min, max, ctx));

export const optionalNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => (v === "" ? undefined : parseNumber(v, min, max, ctx)));

type SetError = (name: never, error: { message: string }) => void;

export function applyServerErrors(error: unknown, setError: SetError, knownFields: string[]): string {
  if (error instanceof ApiError) {
    for (const [field, message] of Object.entries(error.fieldErrors)) {
      if (knownFields.includes(field)) setError(field as never, { message });
    }
    if (error.status === 0 || error.status >= 500) {
      return `${error.message} Your entry is still here.`;
    }
    return error.message;
  }
  return "Couldn't save. Your entry is still here, so try again.";
}
```

- [ ] **Step 4: Run forms tests**

Run: `npm test -- src/lib/forms.test.ts`
Expected: 5 passed

- [ ] **Step 5: Implement `frontend/src/components/Field.tsx`**

```tsx
import { type InputHTMLAttributes, type Ref, useId } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  unit?: string;
  error?: string;
  hint?: string;
  ref?: Ref<HTMLInputElement>;
};

export function Field({ label, unit, error, hint, id, className, ref, ...input }: Props) {
  const generated = useId();
  const inputId = id ?? generated;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1 block text-sm text-muted">
        {label}
      </label>
      <div className={`flex items-center rounded-xl border bg-surface-2 px-3 ${error ? "border-bad" : "border-border focus-within:border-accent"}`}>
        <input
          id={inputId}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="tabular w-full bg-transparent py-2.5 outline-none placeholder:text-muted/60"
          {...input}
        />
        {unit && <span className="ml-2 text-sm text-muted">{unit}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-bad">{error}</p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Write failing tests `frontend/src/forms/WeighInForm.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { WeighInForm } from "./WeighInForm";

describe("WeighInForm", () => {
  it("requires weight", async () => {
    const onSubmit = vi.fn();
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects out-of-range weight", async () => {
    const onSubmit = vi.fn();
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "805");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(await screen.findByText("Must be between 20 and 400")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits comma decimals, optional fields and an ISO date", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "82,4");
    await userEvent.click(screen.getByRole("button", { name: /More fields/ }));
    await userEvent.type(screen.getByLabelText("Body fat"), "18.3");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.weight_kg).toBe(82.4);
    expect(payload.body_fat_pct).toBe(18.3);
    expect(payload.muscle_mass_kg).toBeNull();
    expect(payload.measured_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  });

  it("hides hidden metrics and shows last values as placeholders", async () => {
    render(
      <WeighInForm hiddenMetrics={["protein_pct"]} lastValues={{ weight_kg: 82.1, body_fat_pct: 18.4 }} onSubmit={vi.fn()} />,
    );
    expect(screen.getByLabelText("Weight")).toHaveAttribute("placeholder", "82.1");
    await userEvent.click(screen.getByRole("button", { name: /More fields/ }));
    expect(screen.getByLabelText("Body fat")).toHaveAttribute("placeholder", "18.4");
    expect(screen.queryByLabelText("Protein")).not.toBeInTheDocument();
  });

  it("shows server errors and keeps the input", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError(422, "Please fix the highlighted fields.", { weight_kg: "Too heavy" }));
    render(<WeighInForm hiddenMetrics={[]} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Weight"), "80");
    await userEvent.click(screen.getByRole("button", { name: "Save weigh-in" }));
    expect(await screen.findByText("Too heavy")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please fix the highlighted fields.");
    expect(screen.getByLabelText("Weight")).toHaveValue("80");
  });

  it("prefills when editing", () => {
    render(
      <WeighInForm
        hiddenMetrics={[]}
        initial={{ id: "1", measured_at: "2026-02-28T05:00:00Z", weight_kg: 81.5, body_fat_pct: 18, note: null } as never}
        submitLabel="Save changes"
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Weight")).toHaveValue("81.5");
    expect(screen.getByLabelText("Body fat")).toHaveValue("18");
  });
});
```

- [ ] **Step 7: Implement `frontend/src/forms/WeighInForm.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Field } from "../components/Field";
import { localInputToIso, toLocalInputValue } from "../lib/format";
import { applyServerErrors, optionalNumber, requiredNumber } from "../lib/forms";
import { SCALE_FIELDS, WEIGHT } from "../lib/metrics";
import type { BodyEntry, BodyEntryInput, ScaleField } from "../lib/types";

const schema = z.object({
  measured_at: z.string().min(1, "Required"),
  weight_kg: requiredNumber(WEIGHT.min, WEIGHT.max),
  body_fat_pct: optionalNumber(2, 70),
  muscle_mass_kg: optionalNumber(5, 200),
  skeletal_muscle_pct: optionalNumber(5, 80),
  body_water_pct: optionalNumber(20, 80),
  bone_mass_kg: optionalNumber(0.5, 10),
  visceral_fat: optionalNumber(1, 60),
  protein_pct: optionalNumber(5, 30),
  bmr_kcal: optionalNumber(500, 5000),
  metabolic_age: optionalNumber(10, 100),
  note: z.string().max(500, "Keep notes under 500 characters"),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;
const KNOWN = Object.keys(schema.shape);

type Props = {
  hiddenMetrics: ScaleField[];
  lastValues?: Partial<Record<string, unknown>>;
  initial?: BodyEntry;
  submitLabel?: string;
  onSubmit: (payload: BodyEntryInput) => Promise<void>;
};

const str = (v: unknown) => (typeof v === "number" ? String(v) : "");

export function WeighInForm({ hiddenMetrics, lastValues = {}, initial, submitLabel = "Save weigh-in", onSubmit }: Props) {
  const visible = SCALE_FIELDS.filter((f) => !hiddenMetrics.includes(f.key));
  const [expanded, setExpanded] = useState(() => visible.some((f) => initial?.[f.key] != null));
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      measured_at: toLocalInputValue(initial ? new Date(initial.measured_at) : new Date()),
      weight_kg: str(initial?.weight_kg),
      ...Object.fromEntries(SCALE_FIELDS.map((f) => [f.key, str(initial?.[f.key])])),
      note: initial?.note ?? "",
    },
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    const payload = {
      measured_at: localInputToIso(values.measured_at),
      weight_kg: values.weight_kg,
      ...Object.fromEntries(SCALE_FIELDS.map((f) => [f.key, values[f.key] ?? null])),
      note: values.note.trim() || null,
    } as BodyEntryInput;
    try {
      await onSubmit(payload);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, KNOWN));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field
        label="Weight"
        unit="kg"
        inputMode="decimal"
        autoFocus
        placeholder={str(lastValues.weight_kg)}
        error={errors.weight_kg?.message}
        className="[&_input]:text-2xl"
        {...register("weight_kg")}
      />
      <Field label="Date & time" type="datetime-local" error={errors.measured_at?.message} {...register("measured_at")} />

      <button type="button" onClick={() => setExpanded((e) => !e)} className="flex items-center gap-1 text-sm text-muted" aria-expanded={expanded}>
        More fields <ChevronDown size={16} className={expanded ? "rotate-180" : ""} />
      </button>
      {expanded && (
        <div className="grid grid-cols-2 gap-3">
          {visible.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              unit={f.unit}
              inputMode="decimal"
              placeholder={str(lastValues[f.key])}
              error={errors[f.key]?.message}
              {...register(f.key)}
            />
          ))}
          <Field className="col-span-2" label="Note" error={errors.note?.message} {...register("note")} />
        </div>
      )}

      {formError && <p role="alert" className="text-sm text-bad">{formError}</p>}
      <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-accent py-3 font-medium text-bg disabled:opacity-60">
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Run WeighInForm tests**

Run: `npm test -- src/forms/WeighInForm.test.tsx`
Expected: 6 passed

- [ ] **Step 9: Write failing tests `frontend/src/forms/MeasurementForm.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const navy = vi.fn();
vi.mock("../lib/queries", () => ({
  useNavyPreview: (w: number | null, n: number | null, h: number | null) => navy(w, n, h),
}));

import { MeasurementForm } from "./MeasurementForm";

describe("MeasurementForm", () => {
  it("needs at least one measurement", async () => {
    navy.mockReturnValue({ data: undefined });
    const onSubmit = vi.fn();
    render(<MeasurementForm sex="male" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Save measurements" }));
    expect(await screen.findByText("Enter at least one measurement")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("previews Navy body fat once waist and neck are entered", async () => {
    navy.mockImplementation((w, n) => ({ data: w && n ? { navy_body_fat_pct: 16.1 } : undefined }));
    render(<MeasurementForm sex="male" onSubmit={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Waist"), "85");
    await userEvent.type(screen.getByLabelText("Neck"), "38");
    expect(await screen.findByText("16.1%")).toBeInTheDocument();
    expect(navy).toHaveBeenLastCalledWith(85, 38, null);
  });

  it("submits only filled values plus nulls", async () => {
    navy.mockReturnValue({ data: undefined });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MeasurementForm sex="female" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Arm"), "31,5");
    await userEvent.click(screen.getByRole("button", { name: "Save measurements" }));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.arm_cm).toBe(31.5);
    expect(payload.waist_cm).toBeNull();
  });
});
```

- [ ] **Step 10: Implement `frontend/src/forms/MeasurementForm.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Field } from "../components/Field";
import { formatValue, localInputToIso, toLocalInputValue } from "../lib/format";
import { applyServerErrors, optionalNumber } from "../lib/forms";
import { TAPE_FIELDS } from "../lib/metrics";
import { useNavyPreview } from "../lib/queries";
import type { Measurement, MeasurementInput, Sex } from "../lib/types";

const tape = optionalNumber(10, 250);
const schema = z
  .object({
    measured_at: z.string().min(1, "Required"),
    waist_cm: tape,
    hips_cm: tape,
    chest_cm: tape,
    neck_cm: tape,
    arm_cm: tape,
    thigh_cm: tape,
    note: z.string().max(500, "Keep notes under 500 characters"),
  })
  .superRefine((v, ctx) => {
    if (TAPE_FIELDS.every((f) => v[f.key] === undefined)) {
      ctx.addIssue({ code: "custom", path: ["waist_cm"], message: "Enter at least one measurement" });
    }
  });
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;
const KNOWN = ["measured_at", "note", ...TAPE_FIELDS.map((f) => f.key)];

const toNum = (v: string | undefined) => {
  if (!v) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n >= 10 && n <= 250 ? n : null;
};
const str = (v: unknown) => (typeof v === "number" ? String(v) : "");

type Props = {
  sex: Sex;
  lastValues?: Partial<Record<string, unknown>>;
  initial?: Measurement;
  submitLabel?: string;
  onSubmit: (payload: MeasurementInput) => Promise<void>;
};

export function MeasurementForm({ sex, lastValues = {}, initial, submitLabel = "Save measurements", onSubmit }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      measured_at: toLocalInputValue(initial ? new Date(initial.measured_at) : new Date()),
      ...Object.fromEntries(TAPE_FIELDS.map((f) => [f.key, str(initial?.[f.key])])),
      note: initial?.note ?? "",
    },
  });
  const [waist, neck, hips] = useWatch({ control, name: ["waist_cm", "neck_cm", "hips_cm"] });
  const preview = useNavyPreview(toNum(waist), toNum(neck), sex === "female" ? toNum(hips) : null);
  const navy = preview.data?.navy_body_fat_pct;

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    const payload = {
      measured_at: localInputToIso(values.measured_at),
      ...Object.fromEntries(TAPE_FIELDS.map((f) => [f.key, values[f.key] ?? null])),
      note: values.note.trim() || null,
    } as MeasurementInput;
    try {
      await onSubmit(payload);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, KNOWN));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {TAPE_FIELDS.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            unit={f.unit}
            inputMode="decimal"
            placeholder={str(lastValues[f.key])}
            error={errors[f.key]?.message}
            {...register(f.key)}
          />
        ))}
      </div>
      <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm">
        <span className="text-muted">US Navy body fat estimate: </span>
        {navy != null ? (
          <span className="tabular font-medium">{formatValue(navy, "%")}</span>
        ) : (
          <span className="text-muted">enter waist and neck{sex === "female" ? " and hips" : ""}</span>
        )}
      </div>
      <Field label="Date & time" type="datetime-local" error={errors.measured_at?.message} {...register("measured_at")} />
      <Field label="Note" error={errors.note?.message} {...register("note")} />
      {formError && <p role="alert" className="text-sm text-bad">{formError}</p>}
      <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-accent py-3 font-medium text-bg disabled:opacity-60">
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
```

- [ ] **Step 11: Implement `frontend/src/components/LogSheet.tsx`**

```tsx
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { MeasurementForm } from "../forms/MeasurementForm";
import { WeighInForm } from "../forms/WeighInForm";
import { bodyEntries, measurements, useProfile } from "../lib/queries";
import type { LogTab } from "./AppLayout";

const TABS: { key: LogTab; label: string }[] = [
  { key: "weigh-in", label: "Weigh-in" },
  { key: "measurements", label: "Measurements" },
];

export function LogSheet({ initialTab, onClose }: { initialTab: LogTab; onClose: () => void }) {
  const [tab, setTab] = useState<LogTab>(initialTab);
  const profile = useProfile();
  const entries = bodyEntries.useList();
  const tapes = measurements.useList();
  const createEntry = bodyEntries.useCreate();
  const createMeasurement = measurements.useCreate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5 md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-sm ${tab === t.key ? "bg-bg text-text" : "text-muted"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-2 text-muted">
            <X size={20} />
          </button>
        </div>

        {tab === "weigh-in" && (
          <WeighInForm
            hiddenMetrics={profile.data?.hidden_metrics ?? []}
            lastValues={entries.data?.[0]}
            onSubmit={async (payload) => {
              await createEntry.mutateAsync(payload);
              onClose();
            }}
          />
        )}
        {tab === "measurements" && (
          <MeasurementForm
            sex={profile.data?.sex ?? "male"}
            lastValues={tapes.data?.[0]}
            onSubmit={async (payload) => {
              await createMeasurement.mutateAsync(payload);
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Render the sheet in `frontend/src/components/AppLayout.tsx`**

Import `LogSheet` from `./LogSheet` and replace the `sr-only` placeholder line with:

```tsx
      {sheetTab && <LogSheet initialTab={sheetTab} onClose={() => setSheetTab(null)} />}
```

- [ ] **Step 13: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass

- [ ] **Step 14: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add weigh-in and measurement forms in a log sheet"
```

---

### Task 17: Onboarding, settings and More page

**Files:**
- Create: `frontend/src/forms/ProfileForm.tsx`, `frontend/src/pages/Onboarding.tsx`, `frontend/src/pages/Settings.tsx`, `frontend/src/pages/More.tsx`
- Modify: `frontend/src/App.tsx` (routes `/onboarding`, `/settings`, `/more`)
- Test: `frontend/src/forms/ProfileForm.test.tsx`, `frontend/src/pages/Onboarding.test.tsx`

**Interfaces:**
- Consumes: `useProfile`, `useSaveProfile`, `bodyEntries.useCreate`, `WeighInForm`, `SCALE_FIELDS`, `Field`, `supabase`
- Produces:
  - `ProfileForm({ initial?, showHiddenMetrics?, submitLabel, onSubmit(profile: Profile) => Promise<void> })`; timezone defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`
  - `Onboarding` page: step 1 profile → step 2 first weigh-in (skippable) → `/`
  - `Settings` page: profile + hidden metrics + sign out
  - `More` page: links to History, Goals, Settings

Spec deviation, recorded here: spec §5 lists "optional initial goals" in onboarding. A goal's start value comes from the current trend, so a goal can't exist before the first reading. Onboarding therefore asks for the **first weigh-in** as step 2. Goals are then set from the Goals page, and Home prompts for one when none is active (Task 20).

- [ ] **Step 1: Write failing tests `frontend/src/forms/ProfileForm.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProfileForm } from "./ProfileForm";

describe("ProfileForm", () => {
  it("validates height and submits a profile", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProfileForm submitLabel="Continue" onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText("Height"), "300");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Must be between 100 and 250")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Height"));
    await userEvent.type(screen.getByLabelText("Height"), "180");
    await userEvent.click(screen.getByLabelText("Male"));
    await userEvent.type(screen.getByLabelText("Date of birth"), "1990-05-01");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith({
      height_cm: 180,
      sex: "male",
      date_of_birth: "1990-05-01",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hidden_metrics: [],
    });
  });

  it("lets settings hide scale fields", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfileForm
        showHiddenMetrics
        initial={{ height_cm: 180, sex: "male", date_of_birth: "1990-05-01", timezone: "UTC", hidden_metrics: [] }}
        submitLabel="Save"
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByLabelText("Protein"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit.mock.calls[0][0].hidden_metrics).toEqual(["protein_pct"]);
  });
});
```

`frontend/src/pages/Onboarding.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

const saveProfile = vi.fn().mockResolvedValue({});
vi.mock("../lib/queries", () => ({
  useSaveProfile: () => ({ mutateAsync: saveProfile }),
  bodyEntries: { useCreate: () => ({ mutateAsync: vi.fn() }) },
}));

import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("saves the profile, then offers a first weigh-in that can be skipped", async () => {
    render(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Height"), "180");
    await userEvent.click(screen.getByLabelText("Male"));
    await userEvent.type(screen.getByLabelText("Date of birth"), "1990-05-01");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(saveProfile).toHaveBeenCalled();
    expect(await screen.findByText("Log your first weigh-in")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/forms/ProfileForm.test.tsx src/pages/Onboarding.test.tsx`
Expected: FAIL, unresolved imports

- [ ] **Step 3: Implement `frontend/src/forms/ProfileForm.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Field } from "../components/Field";
import { applyServerErrors, requiredNumber } from "../lib/forms";
import { SCALE_FIELDS } from "../lib/metrics";
import type { Profile, ScaleField } from "../lib/types";

const today = () => new Date().toISOString().slice(0, 10);
const schema = z.object({
  height_cm: requiredNumber(100, 250),
  sex: z.enum(["male", "female"], { message: "Choose one" }),
  date_of_birth: z
    .string()
    .min(1, "Required")
    .refine((v) => v < today(), "Must be in the past"),
  timezone: z.string().min(1, "Required"),
  hidden_metrics: z.array(z.string()),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

type Props = {
  initial?: Profile;
  showHiddenMetrics?: boolean;
  submitLabel: string;
  onSubmit: (profile: Profile) => Promise<void>;
};

const TIMEZONES: string[] =
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

export function ProfileForm({ initial, showHiddenMetrics = false, submitLabel, onSubmit }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: {
      height_cm: initial ? String(initial.height_cm) : "",
      sex: initial?.sex,
      date_of_birth: initial?.date_of_birth ?? "",
      timezone: initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      hidden_metrics: initial?.hidden_metrics ?? [],
    },
  });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit({ ...values, hidden_metrics: values.hidden_metrics as ScaleField[] });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, Object.keys(schema.shape)));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Height" unit="cm" inputMode="decimal" error={errors.height_cm?.message} {...register("height_cm")} />
      <fieldset>
        <legend className="mb-1 text-sm text-muted">Sex (used by the US Navy body-fat formula)</legend>
        <div className="flex gap-4">
          {(["male", "female"] as const).map((s) => (
            <label key={s} className="flex items-center gap-2">
              <input type="radio" value={s} {...register("sex")} /> {s === "male" ? "Male" : "Female"}
            </label>
          ))}
        </div>
        {errors.sex && <p className="mt-1 text-xs text-bad">{errors.sex.message}</p>}
      </fieldset>
      <Field label="Date of birth" type="date" error={errors.date_of_birth?.message} {...register("date_of_birth")} />
      <Field label="Timezone" list="bodyos-timezones" error={errors.timezone?.message} {...register("timezone")} />
      <datalist id="bodyos-timezones">
        {TIMEZONES.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>

      {showHiddenMetrics && (
        <fieldset>
          <legend className="mb-2 text-sm text-muted">Hide scale fields you don't have</legend>
          <div className="grid grid-cols-2 gap-2">
            {SCALE_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" value={f.key} {...register("hidden_metrics")} /> {f.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {formError && <p role="alert" className="text-sm text-bad">{formError}</p>}
      <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-accent py-3 font-medium text-bg disabled:opacity-60">
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/pages/Onboarding.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router";
import { ProfileForm } from "../forms/ProfileForm";
import { WeighInForm } from "../forms/WeighInForm";
import { bodyEntries, useSaveProfile } from "../lib/queries";

export function Onboarding() {
  const [step, setStep] = useState<"profile" | "weigh-in">("profile");
  const saveProfile = useSaveProfile();
  const createEntry = bodyEntries.useCreate();
  const navigate = useNavigate();

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <p className="text-sm text-muted">Step {step === "profile" ? 1 : 2} of 2</p>
      {step === "profile" ? (
        <>
          <h1 className="mb-6 mt-1 text-2xl font-semibold">A few basics</h1>
          <ProfileForm
            submitLabel="Continue"
            onSubmit={async (profile) => {
              await saveProfile.mutateAsync(profile);
              setStep("weigh-in");
            }}
          />
        </>
      ) : (
        <>
          <h1 className="mb-6 mt-1 text-2xl font-semibold">Log your first weigh-in</h1>
          <WeighInForm
            hiddenMetrics={[]}
            onSubmit={async (payload) => {
              await createEntry.mutateAsync(payload);
              navigate("/", { replace: true });
            }}
          />
          <button type="button" onClick={() => navigate("/", { replace: true })} className="mt-4 w-full text-sm text-muted underline">
            Skip for now
          </button>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Implement `frontend/src/pages/Settings.tsx` and `frontend/src/pages/More.tsx`**

```tsx
// Settings.tsx
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ProfileForm } from "../forms/ProfileForm";
import { useProfile, useSaveProfile } from "../lib/queries";
import { supabase } from "../lib/supabase";

export function Settings() {
  const profile = useProfile();
  const save = useSaveProfile();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  if (!profile.data) return null;
  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <ProfileForm
        initial={profile.data}
        showHiddenMetrics
        submitLabel="Save"
        onSubmit={async (p) => {
          setSaved(false);
          await save.mutateAsync(p);
          setSaved(true);
        }}
      />
      {saved && <p className="text-sm text-good">Saved.</p>}
      <button
        type="button"
        onClick={() => void supabase.auth.signOut().then(() => qc.clear())}
        className="w-full rounded-xl border border-border py-3"
      >
        Sign out
      </button>
    </section>
  );
}
```

```tsx
// More.tsx
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

const LINKS = [
  { to: "/history", label: "History", body: "Every entry, edit or delete" },
  { to: "/goals", label: "Goals", body: "Targets and projections" },
  { to: "/settings", label: "Settings", body: "Profile, hidden fields, sign out" },
];

export function More() {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">More</h1>
      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
        {LINKS.map((l) => (
          <li key={l.to}>
            <Link to={l.to} className="flex items-center justify-between px-4 py-3">
              <span>
                <span className="block">{l.label}</span>
                <span className="block text-sm text-muted">{l.body}</span>
              </span>
              <ChevronRight size={18} className="text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Add routes to `frontend/src/App.tsx`**

Inside `<Route element={<RequireAuth />}>`, before the layout route, add `<Route path="/onboarding" element={<Onboarding />} />`. Inside the layout route, after the index route, add:

```tsx
          <Route path="more" element={<More />} />
          <Route path="settings" element={<Settings />} />
```

Import `Onboarding`, `More` and `Settings`.

- [ ] **Step 7: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add onboarding, settings and More page"
```

---
### Task 18: Progress photos: capture, upload, timeline, compare

**Files:**
- Create: `frontend/src/lib/image.ts`, `frontend/src/lib/photos.ts`, `frontend/src/forms/PhotoForm.tsx`, `frontend/src/components/CompareSlider.tsx`, `frontend/src/pages/Photos.tsx`, `frontend/src/pages/PhotoCompare.tsx`
- Modify: `frontend/src/components/LogSheet.tsx` (Photo tab), `frontend/src/App.tsx` (routes `photos`, `photos/compare`)
- Test: `frontend/src/lib/image.test.ts`, `frontend/src/lib/photos.test.ts`, `frontend/src/forms/PhotoForm.test.tsx`, `frontend/src/components/CompareSlider.test.tsx`, `frontend/src/pages/Photos.test.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError`, `supabase`, `env.photoBucket`, `usePhotos`, `useDeletePhoto`, `qk`, `useLogSheet`
- Produces:
  - `fitWithin(width, height, maxEdge = 1600): { width; height }`, `resizeImage(file: Blob, maxEdge = 1600, quality = 0.85): Promise<Blob>`
  - `type NewPhoto = { file: Blob; pose: Pose; takenAt: string; note: string | null }`, `uploadPhoto(p: NewPhoto, resize = resizeImage): Promise<Photo>`, `useUploadPhoto()`
  - `PhotoForm({ lastByPose: Partial<Record<Pose, Photo>>, onSubmit(p: NewPhoto) => Promise<void> })`
  - `CompareSlider({ beforeUrl, afterUrl, beforeLabel, afterLabel })`
  - `groupByDay(photos: Photo[]): { day: string; photos: Photo[] }[]` (exported from `pages/Photos.tsx`; newest day first; `day` = local `YYYY-MM-DD`)
  - `latestByPose(photos: Photo[]): Partial<Record<Pose, Photo>>` (exported from `lib/photos.ts`)

- [ ] **Step 1: Write failing tests**

`frontend/src/lib/image.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fitWithin } from "./image";

describe("fitWithin", () => {
  it("scales the long edge down to the max", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });
  it("never upscales", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
```

`frontend/src/lib/photos.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
const uploadToSignedUrl = vi.fn();
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), api: (...a: unknown[]) => api(...a) }));
vi.mock("./supabase", () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(...a) }) } },
}));

import { latestByPose, uploadPhoto } from "./photos";

const resize = vi.fn(async () => new Blob(["small"], { type: "image/jpeg" }));
const photo = { file: new Blob(["big"]), pose: "front" as const, takenAt: "2026-02-28T07:00:00.000Z", note: null };

describe("uploadPhoto", () => {
  beforeEach(() => {
    api.mockReset();
    uploadToSignedUrl.mockReset();
  });

  it("resizes, uploads to the signed URL, then registers the photo", async () => {
    api
      .mockResolvedValueOnce({ photo_id: "p1", path: "u/p1.jpg", token: "tok" })
      .mockResolvedValueOnce({ id: "p1" });
    uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });
    await uploadPhoto(photo, resize);
    expect(resize).toHaveBeenCalledWith(photo.file);
    expect(uploadToSignedUrl).toHaveBeenCalledWith("u/p1.jpg", "tok", expect.any(Blob), { contentType: "image/jpeg" });
    expect(api).toHaveBeenLastCalledWith("/photos", {
      method: "POST",
      json: { photo_id: "p1", taken_at: photo.takenAt, pose: "front", note: null },
    });
  });

  it("does not register the photo when the upload fails", async () => {
    api.mockResolvedValueOnce({ photo_id: "p1", path: "u/p1.jpg", token: "tok" });
    uploadToSignedUrl.mockResolvedValue({ data: null, error: { message: "network" } });
    await expect(uploadPhoto(photo, resize)).rejects.toThrow("Photo upload failed");
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe("latestByPose", () => {
  it("keeps the newest photo for each pose", () => {
    const photos = [
      { id: "b", pose: "front", taken_at: "2026-02-20T07:00:00Z" },
      { id: "a", pose: "front", taken_at: "2026-02-27T07:00:00Z" },
      { id: "c", pose: "side", taken_at: "2026-02-10T07:00:00Z" },
    ] as never;
    const latest = latestByPose(photos);
    expect(latest.front?.id).toBe("a");
    expect(latest.side?.id).toBe("c");
    expect(latest.back).toBeUndefined();
  });
});
```

`frontend/src/forms/PhotoForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PhotoForm } from "./PhotoForm";

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("PhotoForm", () => {
  it("requires a photo, then submits pose, file and date", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PhotoForm lastByPose={{}} onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Save photo" })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Side" }));
    const file = new File(["img"], "me.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Choose from gallery"), file);
    await userEvent.click(screen.getByRole("button", { name: "Save photo" }));
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.pose).toBe("side");
    expect(arg.file).toBe(file);
    expect(arg.takenAt).toMatch(/Z$/);
  });

  it("shows the last photo of the same pose as an alignment guide", async () => {
    render(
      <PhotoForm
        lastByPose={{ front: { id: "1", pose: "front", taken_at: "2026-02-01T07:00:00Z", note: null, url: "https://x/front.jpg" } }}
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.upload(screen.getByLabelText("Choose from gallery"), new File(["i"], "a.jpg", { type: "image/jpeg" }));
    expect(screen.getByAltText("Previous front photo")).toHaveAttribute("src", "https://x/front.jpg");
  });
});
```

`frontend/src/components/CompareSlider.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CompareSlider } from "./CompareSlider";

describe("CompareSlider", () => {
  it("reveals the before photo up to the slider position", () => {
    render(<CompareSlider beforeUrl="b.jpg" afterUrl="a.jpg" beforeLabel="1 Feb" afterLabel="28 Feb" />);
    const before = screen.getByAltText("Before: 1 Feb");
    expect(before.style.clipPath).toBe("inset(0 50% 0 0)");
    fireEvent.change(screen.getByLabelText("Compare position"), { target: { value: "30" } });
    expect(before.style.clipPath).toBe("inset(0 70% 0 0)");
  });
});
```

`frontend/src/pages/Photos.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { groupByDay } from "./Photos";

describe("groupByDay", () => {
  it("groups by local day, newest first", () => {
    const photos = [
      { id: "1", taken_at: new Date(2026, 1, 20, 7).toISOString() },
      { id: "2", taken_at: new Date(2026, 1, 27, 7).toISOString() },
      { id: "3", taken_at: new Date(2026, 1, 27, 8).toISOString() },
    ] as never;
    const groups = groupByDay(photos);
    expect(groups.map((g) => g.day)).toEqual(["2026-02-27", "2026-02-20"]);
    expect(groups[0].photos.map((p) => p.id).sort()).toEqual(["2", "3"]);
  });
});
```

(These tests need the jest-dom file APIs from jsdom; `userEvent.upload` works on `<input type="file">`.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/image.test.ts src/lib/photos.test.ts src/forms/PhotoForm.test.tsx src/components/CompareSlider.test.tsx src/pages/Photos.test.tsx`
Expected: FAIL, unresolved imports

- [ ] **Step 3: Implement `frontend/src/lib/image.ts`**

```ts
export function fitWithin(width: number, height: number, maxEdge = 1600): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function resizeImage(file: Blob, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process images.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process the image."))), "image/jpeg", quality),
  );
}
```

- [ ] **Step 4: Implement `frontend/src/lib/photos.ts`**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "./api";
import { env } from "./env";
import { resizeImage } from "./image";
import { qk } from "./queries";
import { supabase } from "./supabase";
import type { Photo, Pose, UploadTicket } from "./types";

export type NewPhoto = { file: Blob; pose: Pose; takenAt: string; note: string | null };

export async function uploadPhoto(p: NewPhoto, resize: (f: Blob) => Promise<Blob> = resizeImage): Promise<Photo> {
  const blob = await resize(p.file);
  const ticket = await api<UploadTicket>("/photos/upload-url", { method: "POST" });
  const { error } = await supabase.storage
    .from(env.photoBucket)
    .uploadToSignedUrl(ticket.path, ticket.token, blob, { contentType: "image/jpeg" });
  if (error) throw new ApiError(0, "Photo upload failed. Please try again.");
  return api<Photo>("/photos", {
    method: "POST",
    json: { photo_id: ticket.photo_id, taken_at: p.takenAt, pose: p.pose, note: p.note },
  });
}

export function useUploadPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: NewPhoto) => uploadPhoto(p),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["photos"] });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
    },
  });
}

export function latestByPose(photos: Photo[]): Partial<Record<Pose, Photo>> {
  const out: Partial<Record<Pose, Photo>> = {};
  for (const photo of photos) {
    const current = out[photo.pose];
    if (!current || photo.taken_at > current.taken_at) out[photo.pose] = photo;
  }
  return out;
}
```

- [ ] **Step 5: Implement `frontend/src/forms/PhotoForm.tsx`**

```tsx
import { Camera, ImagePlus } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { Field } from "../components/Field";
import { localInputToIso, toLocalInputValue } from "../lib/format";
import type { NewPhoto } from "../lib/photos";
import type { Photo, Pose } from "../lib/types";

const POSES: { key: Pose; label: string }[] = [
  { key: "front", label: "Front" },
  { key: "side", label: "Side" },
  { key: "back", label: "Back" },
];

type Props = { lastByPose: Partial<Record<Pose, Photo>>; onSubmit: (p: NewPhoto) => Promise<void> };

export function PhotoForm({ lastByPose, onSubmit }: Props) {
  const [pose, setPose] = useState<Pose>("front");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [takenAt, setTakenAt] = useState(() => toLocalInputValue(new Date()));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guide = lastByPose[pose];

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ file, pose, takenAt: localInputToIso(takenAt), note: note.trim() || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div role="radiogroup" aria-label="Pose" className="flex gap-1 rounded-xl bg-surface-2 p-1">
        {POSES.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={pose === p.key}
            onClick={() => setPose(p.key)}
            className={`flex-1 rounded-lg py-1.5 text-sm ${pose === p.key ? "bg-bg text-text" : "text-muted"}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-surface-2">
        {preview && <img src={preview} alt="New photo preview" className="absolute inset-0 h-full w-full object-cover" />}
        {preview && guide && (
          <img src={guide.url} alt={`Previous ${pose} photo`} className="absolute inset-0 h-full w-full object-cover opacity-30 mix-blend-screen" />
        )}
        {!preview && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">No photo selected</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm">
          <Camera size={18} /> Take photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
        </label>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm">
          <ImagePlus size={18} /> Choose from gallery
          <input type="file" accept="image/*" className="sr-only" onChange={pick} />
        </label>
      </div>

      <Field label="Date & time" type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} />
      <Field label="Note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <button type="submit" disabled={!file || busy} className="w-full rounded-xl bg-accent py-3 font-medium text-bg disabled:opacity-60">
        {busy ? "Uploading…" : "Save photo"}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Implement `frontend/src/components/CompareSlider.tsx`**

```tsx
import { useState } from "react";

type Props = { beforeUrl: string; afterUrl: string; beforeLabel: string; afterLabel: string };

export function CompareSlider({ beforeUrl, afterUrl, beforeLabel, afterLabel }: Props) {
  const [pos, setPos] = useState(50);
  return (
    <div>
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-surface-2 select-none">
        <img src={afterUrl} alt={`After: ${afterLabel}`} className="absolute inset-0 h-full w-full object-cover" />
        <img
          src={beforeUrl}
          alt={`Before: ${beforeLabel}`}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${pos}%` }} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">{beforeLabel}</span>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">{afterLabel}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        aria-label="Compare position"
        onChange={(e) => setPos(Number(e.target.value))}
        className="mt-3 w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}
```

- [ ] **Step 7: Implement `frontend/src/pages/Photos.tsx`**

```tsx
import { useState } from "react";
import { Link } from "react-router";
import { useLogSheet } from "../components/AppLayout";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { formatDay } from "../lib/format";
import { useDeletePhoto, usePhotos } from "../lib/queries";
import type { Photo, Pose } from "../lib/types";

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function groupByDay(photos: Photo[]): { day: string; photos: Photo[] }[] {
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    const day = localDay(p.taken_at);
    map.set(day, [...(map.get(day) ?? []), p]);
  }
  return [...map.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, list]) => ({ day, photos: list }));
}

const FILTERS: { key: Pose | undefined; label: string }[] = [
  { key: undefined, label: "All" },
  { key: "front", label: "Front" },
  { key: "side", label: "Side" },
  { key: "back", label: "Back" },
];

export function Photos() {
  const [pose, setPose] = useState<Pose | undefined>(undefined);
  const [open, setOpen] = useState<Photo | null>(null);
  const photos = usePhotos(pose);
  const remove = useDeletePhoto();
  const logSheet = useLogSheet();

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Photos</h1>
        <Link to="/photos/compare" className="rounded-xl bg-surface-2 px-3 py-1.5 text-sm">Compare</Link>
      </div>
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            aria-pressed={pose === f.key}
            onClick={() => setPose(f.key)}
            className={`rounded-full px-3 py-1 text-sm ${pose === f.key ? "bg-text text-bg" : "bg-surface-2 text-muted"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {photos.isPending && <Spinner />}
      {photos.isError && <ErrorState message={photos.error.message} onRetry={() => void photos.refetch()} />}
      {photos.data?.length === 0 && (
        <EmptyState
          title="No photos yet"
          body="Front, side and back photos every few weeks make progress visible."
          action={<button type="button" onClick={() => logSheet.open("photo")} className="rounded-xl bg-accent px-4 py-2 text-bg">Add a photo</button>}
        />
      )}
      {photos.data &&
        groupByDay(photos.data).map((group) => (
          <div key={group.day}>
            <h2 className="mb-2 text-sm text-muted">{formatDay(group.day)}</h2>
            <div className="grid grid-cols-3 gap-2">
              {group.photos.map((p) => (
                <button key={p.id} type="button" onClick={() => setOpen(p)} className="aspect-[3/4] overflow-hidden rounded-xl bg-surface-2">
                  <img src={p.url} alt={`${p.pose} photo`} loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        ))}

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/90 p-4" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <img src={open.url} alt={`${open.pose} photo`} className="max-h-[80dvh] rounded-xl object-contain" />
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setOpen(null)} className="rounded-xl bg-surface-2 px-4 py-2">Close</button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete this photo? This can't be undone.")) {
                  remove.mutate(open.id, { onSuccess: () => setOpen(null) });
                }
              }}
              className="rounded-xl bg-bad px-4 py-2 text-bg"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Implement `frontend/src/pages/PhotoCompare.tsx`**

```tsx
import { useMemo, useState } from "react";
import { CompareSlider } from "../components/CompareSlider";
import { EmptyState, Spinner } from "../components/EmptyState";
import { formatDay } from "../lib/format";
import { usePhotos } from "../lib/queries";
import type { Pose } from "../lib/types";

export function PhotoCompare() {
  const [pose, setPose] = useState<Pose>("front");
  const photos = usePhotos(pose);
  const sorted = useMemo(
    () => [...(photos.data ?? [])].sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1)),
    [photos.data],
  );
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const before = sorted.find((p) => p.id === beforeId) ?? sorted[0];
  const after = sorted.find((p) => p.id === afterId) ?? sorted[sorted.length - 1];
  const label = (iso: string) => formatDay(iso.slice(0, 10));
  const select = "w-full rounded-xl border border-border bg-surface-2 px-3 py-2";

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Compare</h1>
      <select aria-label="Pose" className={select} value={pose} onChange={(e) => { setPose(e.target.value as Pose); setBeforeId(null); setAfterId(null); }}>
        <option value="front">Front</option>
        <option value="side">Side</option>
        <option value="back">Back</option>
      </select>
      {photos.isPending && <Spinner />}
      {sorted.length < 2 && !photos.isPending && (
        <EmptyState title="Need two photos of this pose" body="Add another photo to compare progress." />
      )}
      {sorted.length >= 2 && before && after && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <select aria-label="Before" className={select} value={before.id} onChange={(e) => setBeforeId(e.target.value)}>
              {sorted.map((p) => <option key={p.id} value={p.id}>{label(p.taken_at)}</option>)}
            </select>
            <select aria-label="After" className={select} value={after.id} onChange={(e) => setAfterId(e.target.value)}>
              {sorted.map((p) => <option key={p.id} value={p.id}>{label(p.taken_at)}</option>)}
            </select>
          </div>
          <CompareSlider beforeUrl={before.url} afterUrl={after.url} beforeLabel={label(before.taken_at)} afterLabel={label(after.taken_at)} />
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 9: Add the Photo tab to `frontend/src/components/LogSheet.tsx`**

Add `{ key: "photo", label: "Photo" }` to `TABS`. Import `PhotoForm`, `latestByPose` and `useUploadPhoto` from `../lib/photos`, and `usePhotos` from `../lib/queries`. Inside the component add:

```tsx
  const photos = usePhotos();
  const upload = useUploadPhoto();
```

and render:

```tsx
        {tab === "photo" && (
          <PhotoForm
            lastByPose={latestByPose(photos.data ?? [])}
            onSubmit={async (p) => {
              await upload.mutateAsync(p);
              onClose();
            }}
          />
        )}
```

- [ ] **Step 10: Add routes in `frontend/src/App.tsx`**

```tsx
          <Route path="photos" element={<Photos />} />
          <Route path="photos/compare" element={<PhotoCompare />} />
```

- [ ] **Step 11: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass

- [ ] **Step 12: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add progress photo upload, timeline and before/after compare"
```

---

### Task 19: Trends page and charts

**Files:**
- Create: `frontend/src/lib/chart.ts`, `frontend/src/components/charts/TrendChart.tsx`, `frontend/src/pages/Trends.tsx`
- Modify: `frontend/src/App.tsx` (route `trends`)
- Test: `frontend/src/lib/chart.test.ts`, `frontend/src/pages/Trends.test.tsx`

**Before starting:** invoke the `dataviz` skill and apply its guidance to the marks below: faint raw dots, a bold trend line, a dashed goal line, and two axes labelled in their series colour. Keep the component props unchanged.

**Interfaces:**
- Consumes: `useSeries`, `goals.useList`, `SERIES_METRICS`, `metricInfo`, `formatValue`, `formatChange`, `formatDay`
- Produces:
  - `type ChartRow = { date: string; raw?: number; trend?: number; raw2?: number; trend2?: number }`
  - `mergeSeries(primary: Series, secondary?: Series): ChartRow[]` (sorted by date; one row per date)
  - `TrendChart({ primary: Series; secondary?: Series; goalValue?: number | null })`
  - `Trends` page: reads/writes `?metric=&range=&vs=` search params; defaults `metric=fat_mass_kg`, `range=3M`

- [ ] **Step 1: Write failing tests**

`frontend/src/lib/chart.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Series } from "./types";
import { mergeSeries } from "./chart";

const series = (points: [string, number][], trend: [string, number][]): Series => ({
  metric: "m",
  label: "M",
  unit: "kg",
  points: points.map(([date, value]) => ({ date, value })),
  trend: trend.map(([date, value]) => ({ date, value })),
  change: null,
  weekly_rate: null,
  min: null,
  max: null,
  latest: null,
});

describe("mergeSeries", () => {
  it("joins raw and trend by date", () => {
    const rows = mergeSeries(series([["2026-02-01", 80], ["2026-02-03", 79]], [["2026-02-01", 80], ["2026-02-03", 79.9]]));
    expect(rows).toEqual([
      { date: "2026-02-01", raw: 80, trend: 80 },
      { date: "2026-02-03", raw: 79, trend: 79.9 },
    ]);
  });

  it("adds a secondary series on shared or new dates", () => {
    const rows = mergeSeries(
      series([["2026-02-01", 16]], [["2026-02-01", 16]]),
      series([["2026-02-01", 64], ["2026-02-02", 64.2]], [["2026-02-01", 64], ["2026-02-02", 64.02]]),
    );
    expect(rows).toEqual([
      { date: "2026-02-01", raw: 16, trend: 16, raw2: 64, trend2: 64 },
      { date: "2026-02-02", raw2: 64.2, trend2: 64.02 },
    ]);
  });
});
```

`frontend/src/pages/Trends.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

const useSeries = vi.fn();
vi.mock("../lib/queries", () => ({
  useSeries: (...a: unknown[]) => useSeries(...a),
  goals: { useList: () => ({ data: [] }) },
}));
vi.mock("../components/charts/TrendChart", () => ({ TrendChart: () => <div data-testid="chart" /> }));

import { Trends } from "./Trends";

const full = {
  metric: "fat_mass_kg",
  label: "Fat mass",
  unit: "kg",
  points: [
    { date: "2026-02-01", value: 16 },
    { date: "2026-02-20", value: 15.2 },
  ],
  trend: [
    { date: "2026-02-01", value: 16 },
    { date: "2026-02-20", value: 15.5 },
  ],
  change: -0.5,
  weekly_rate: -0.21,
  min: 15.2,
  max: 16,
  latest: 15.5,
};

describe("Trends", () => {
  it("shows stats for the selected metric and range", async () => {
    useSeries.mockReturnValue({ data: full, isPending: false });
    render(
      <MemoryRouter>
        <Trends />
      </MemoryRouter>,
    );
    expect(useSeries).toHaveBeenCalledWith("fat_mass_kg", "3M", true);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
    expect(screen.getByText("−0.5 kg")).toBeInTheDocument();
    expect(screen.getByText("−0.2 kg/wk")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "1Y" }));
    expect(useSeries).toHaveBeenLastCalledWith(expect.any(String), "1Y", expect.any(Boolean));
  });

  it("shows an empty state with fewer than two readings", () => {
    useSeries.mockReturnValue({ data: { ...full, points: [full.points[0]] }, isPending: false });
    render(
      <MemoryRouter>
        <Trends />
      </MemoryRouter>,
    );
    expect(screen.getByText("Not enough data yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/lib/chart.test.ts src/pages/Trends.test.tsx`
Expected: FAIL, unresolved imports

- [ ] **Step 3: Implement `frontend/src/lib/chart.ts`**

```ts
import type { Series } from "./types";

export type ChartRow = { date: string; raw?: number; trend?: number; raw2?: number; trend2?: number };

export function mergeSeries(primary: Series, secondary?: Series): ChartRow[] {
  const rows = new Map<string, ChartRow>();
  const put = (date: string, key: keyof Omit<ChartRow, "date">, value: number) => {
    const row = rows.get(date) ?? { date };
    row[key] = value;
    rows.set(date, row);
  };
  primary.points.forEach((p) => put(p.date, "raw", p.value));
  primary.trend.forEach((p) => put(p.date, "trend", p.value));
  secondary?.points.forEach((p) => put(p.date, "raw2", p.value));
  secondary?.trend.forEach((p) => put(p.date, "trend2", p.value));
  return [...rows.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
```

- [ ] **Step 4: Implement `frontend/src/components/charts/TrendChart.tsx`**

```tsx
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { mergeSeries } from "../../lib/chart";
import { formatDay, formatValue } from "../../lib/format";
import type { Series } from "../../lib/types";

const C1 = "var(--color-series-1)";
const C2 = "var(--color-series-2)";

type Props = { primary: Series; secondary?: Series; goalValue?: number | null };

export function TrendChart({ primary, secondary, goalValue }: Props) {
  const rows = mergeSeries(primary, secondary);
  return (
    <div className="h-72 w-full md:h-96">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: secondary ? 0 : 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} stroke="var(--color-muted)" fontSize={12} minTickGap={24} />
          <YAxis yAxisId="left" domain={["auto", "auto"]} stroke={C1} fontSize={12} width={44} />
          {secondary && <YAxis yAxisId="right" orientation="right" domain={["auto", "auto"]} stroke={C2} fontSize={12} width={44} />}
          <Tooltip
            contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 12 }}
            labelFormatter={(d) => formatDay(String(d))}
            formatter={(value, name) => {
              const isSecond = String(name).endsWith("2");
              const unit = isSecond ? secondary?.unit : primary.unit;
              const label = String(name).startsWith("trend") ? "Trend" : "Reading";
              return [formatValue(Number(value), unit, 2), `${isSecond ? secondary?.label : primary.label} · ${label}`];
            }}
          />
          <Scatter yAxisId="left" dataKey="raw" fill={C1} fillOpacity={0.35} isAnimationActive={false} />
          <Line yAxisId="left" dataKey="trend" stroke={C1} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          {goalValue != null && (
            <ReferenceLine yAxisId="left" y={goalValue} stroke={C1} strokeDasharray="5 5" label={{ value: "Goal", fill: "var(--color-muted)", fontSize: 12, position: "insideTopRight" }} />
          )}
          {secondary && <Scatter yAxisId="right" dataKey="raw2" fill={C2} fillOpacity={0.35} isAnimationActive={false} />}
          {secondary && <Line yAxisId="right" dataKey="trend2" stroke={C2} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 5: Implement `frontend/src/pages/Trends.tsx`**

```tsx
import { useSearchParams } from "react-router";
import { TrendChart } from "../components/charts/TrendChart";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { formatChange, formatValue } from "../lib/format";
import { SERIES_METRICS } from "../lib/metrics";
import { goals, useSeries } from "../lib/queries";
import type { RangeKey } from "../lib/types";

const RANGES: RangeKey[] = ["1M", "3M", "6M", "1Y", "ALL"];
const GROUPS = ["Composition", "Scale", "Tape"] as const;

function MetricSelect({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-border bg-surface-2 px-3 py-2">
      {GROUPS.map((g) => (
        <optgroup key={g} label={g}>
          {SERIES_METRICS.filter((m) => m.group === g).map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function Trends() {
  const [params, setParams] = useSearchParams();
  const metric = params.get("metric") ?? "fat_mass_kg";
  const range = (params.get("range") as RangeKey | null) ?? "3M";
  const vs = params.get("vs");
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const primary = useSeries(metric, range, true);
  const secondary = useSeries(vs ?? metric, range, vs !== null);
  const goalList = goals.useList();
  const goalValue = goalList.data?.find((g) => g.metric === metric && g.status === "active")?.target_value ?? null;
  const s = primary.data;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Trends</h1>
      <div className="flex flex-wrap items-center gap-2">
        <MetricSelect label="Metric" value={metric} onChange={(v) => update({ metric: v })} />
        {vs !== null ? (
          <>
            <span className="text-sm text-muted">vs</span>
            <MetricSelect label="Compare with" value={vs} onChange={(v) => update({ vs: v })} />
            <button type="button" onClick={() => update({ vs: null })} className="text-sm text-muted underline">Remove</button>
          </>
        ) : (
          <button type="button" onClick={() => update({ vs: metric === "fat_mass_kg" ? "lean_mass_kg" : "fat_mass_kg" })} className="text-sm text-muted underline">
            + Overlay
          </button>
        )}
      </div>
      <div className="flex gap-1 rounded-xl bg-surface p-1">
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={r === range} onClick={() => update({ range: r })} className={`flex-1 rounded-lg py-1.5 text-sm ${r === range ? "bg-surface-2 text-text" : "text-muted"}`}>
            {r}
          </button>
        ))}
      </div>

      {primary.isPending && <Spinner />}
      {primary.isError && <ErrorState message={primary.error.message} onRetry={() => void primary.refetch()} />}
      {s && s.points.length < 2 && (
        <EmptyState title="Not enough data yet" body={`Log at least 2 ${s.label.toLowerCase()} readings in this range to see a trend.`} />
      )}
      {s && s.points.length >= 2 && (
        <>
          <div className="rounded-2xl bg-surface p-3">
            <TrendChart primary={s} secondary={vs !== null ? secondary.data : undefined} goalValue={goalValue} />
          </div>
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ["Change", formatChange(s.change, s.unit)],
              ["Weekly rate", s.weekly_rate == null ? "—" : `${formatChange(s.weekly_rate, s.unit)}/wk`],
              ["Low", formatValue(s.min, s.unit)],
              ["High", formatValue(s.max, s.unit)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-surface p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="tabular mt-1 text-lg">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Add route** `<Route path="trends" element={<Trends />} />` in `frontend/src/App.tsx`

- [ ] **Step 7: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add trends page with smoothed trend chart and overlay"
```

---
### Task 20: Home dashboard

**Files:**
- Create: `frontend/src/components/charts/Sparkline.tsx`, `frontend/src/components/StatCard.tsx`, `frontend/src/components/GoalProgress.tsx`
- Modify: `frontend/src/pages/Home.tsx` (replace the temporary version)
- Test: `frontend/src/components/GoalProgress.test.tsx`, `frontend/src/pages/Home.test.tsx`

**Interfaces:**
- Consumes: `useDashboard`, `useLogSheet`, `changeTone`, `formatValue`, `formatChange`, `formatDay`, `metricInfo`
- Produces:
  - `Sparkline({ points: Point[] })`
  - `StatCard({ summary: MetricSummary; fallbackDirection?: Direction | null; size?: "hero" | "card" | "mini"; showSparkline?: boolean })`: links to `/trends?metric=<key>`; change element has `data-tone`
  - `goalStatusText(goal: Goal): string`, `GoalProgress({ goal: Goal })`
  - `nudgeMessages(n: Dashboard["nudges"]): { text: string; tab: LogTab }[]` (exported from `pages/Home.tsx`)
  - `DEFAULT_DIRECTION` (recomposition defaults: fat mass and body fat down, lean mass and muscle mass up)

- [ ] **Step 1: Write failing tests**

`frontend/src/components/GoalProgress.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import type { Goal } from "../lib/types";
import { goalStatusText } from "./GoalProgress";

const goal = (state: Goal["projection"]["state"], projected_date: string | null = null): Goal => ({
  id: "g",
  metric: "body_fat_pct",
  start_value: 20,
  target_value: 15,
  start_date: "2026-02-01",
  target_date: null,
  status: "active",
  projection: { current: 18, progress_pct: 40, state, projected_date },
});

describe("goalStatusText", () => {
  it("describes each projection state", () => {
    expect(goalStatusText(goal("on_track", "2026-04-12"))).toBe("On track for 12 Apr");
    expect(goalStatusText(goal("reached"))).toBe("Goal reached");
    expect(goalStatusText(goal("not_on_pace"))).toBe("Not on pace at current rate");
    expect(goalStatusText(goal("insufficient_data"))).toBe("Need more data");
  });
});
```

`frontend/src/pages/Home.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Dashboard, MetricSummary } from "../lib/types";

const useDashboard = vi.fn();
vi.mock("../lib/queries", () => ({ useDashboard: () => useDashboard() }));
vi.mock("../components/AppLayout", () => ({ useLogSheet: () => ({ open: vi.fn() }) }));
vi.mock("../components/charts/Sparkline", () => ({ Sparkline: () => null }));

import { Home, nudgeMessages } from "./Home";

const m = (metric: string, label: string, unit: string, latest: number | null, change: number | null = null): MetricSummary => ({
  metric,
  label,
  unit,
  latest,
  change_30d: change,
  goal_direction: null,
  sparkline: [],
});

const empty: Dashboard = {
  hero: [m("fat_mass_kg", "Fat mass", "kg", null), m("lean_mass_kg", "Lean mass", "kg", null)],
  cards: [m("body_fat_pct", "Body fat", "%", null), m("muscle_mass_kg", "Muscle mass", "kg", null)],
  secondary: [m("weight_kg", "Weight", "kg", null), m("bmi", "BMI", "", null), m("waist_cm", "Waist", "cm", null)],
  goals: [],
  nudges: { days_since_weigh_in: null, days_since_photo: null },
};

const renderHome = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );

describe("Home", () => {
  it("welcomes a new user", () => {
    useDashboard.mockReturnValue({ data: empty, isPending: false });
    renderHome();
    expect(screen.getByText("Welcome to BodyOS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log weigh-in" })).toBeInTheDocument();
  });

  it("shows recomposition stats with tone and a goal prompt", () => {
    useDashboard.mockReturnValue({
      isPending: false,
      data: {
        ...empty,
        hero: [m("fat_mass_kg", "Fat mass", "kg", 14.8, -0.6), m("lean_mass_kg", "Lean mass", "kg", 65.2, 0.3)],
        secondary: [m("weight_kg", "Weight", "kg", 80), m("bmi", "BMI", "", 24.7), m("waist_cm", "Waist", "cm", null)],
        nudges: { days_since_weigh_in: 3, days_since_photo: 35 },
      },
    });
    renderHome();
    expect(screen.getByText("14.8 kg")).toBeInTheDocument();
    expect(screen.getByText("−0.6 kg")).toHaveAttribute("data-tone", "good");
    expect(screen.getByText("+0.3 kg")).toHaveAttribute("data-tone", "good");
    expect(screen.getByText("Last weigh-in: 3 days ago")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Set a goal/ })).toHaveAttribute("href", "/goals");
  });
});

describe("nudgeMessages", () => {
  it("nudges for stale weigh-ins and photos", () => {
    expect(nudgeMessages({ days_since_weigh_in: 0, days_since_photo: 3 })).toEqual([]);
    expect(nudgeMessages({ days_since_weigh_in: 2, days_since_photo: null }).map((n) => n.text)).toEqual([
      "Last weigh-in: 2 days ago",
      "No progress photos yet. Add your first?",
    ]);
    expect(nudgeMessages({ days_since_weigh_in: 1, days_since_photo: 30 })[0].text).toBe(
      "No photos in 4 weeks. Time for a check-in?",
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/components/GoalProgress.test.tsx src/pages/Home.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `frontend/src/components/charts/Sparkline.tsx`**

```tsx
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import type { Point } from "../../lib/types";

export function Sparkline({ points }: { points: Point[] }) {
  return (
    <div className="mt-2 h-10" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line dataKey="value" stroke="var(--color-series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/components/StatCard.tsx`**

```tsx
import { Link } from "react-router";
import { changeTone, type Direction, formatChange, formatValue } from "../lib/format";
import type { MetricSummary } from "../lib/types";
import { Sparkline } from "./charts/Sparkline";

const TONE_CLASS = { good: "text-good", bad: "text-bad", neutral: "text-muted" } as const;
const SIZE_CLASS = { hero: "text-3xl", card: "text-2xl", mini: "text-lg" } as const;

type Props = {
  summary: MetricSummary;
  fallbackDirection?: Direction | null;
  size?: "hero" | "card" | "mini";
  showSparkline?: boolean;
};

export function StatCard({ summary, fallbackDirection = null, size = "card", showSparkline = false }: Props) {
  const tone = changeTone(summary.change_30d, summary.goal_direction ?? fallbackDirection);
  return (
    <Link to={`/trends?metric=${summary.metric}`} className="block rounded-2xl bg-surface p-4 transition hover:bg-surface-2">
      <p className="text-sm text-muted">{summary.label}</p>
      <p className={`tabular mt-1 font-semibold ${SIZE_CLASS[size]}`}>{formatValue(summary.latest, summary.unit)}</p>
      {size !== "mini" && summary.change_30d != null && (
        <p className="tabular text-sm">
          <span className={TONE_CLASS[tone]} data-tone={tone}>
            {formatChange(summary.change_30d, summary.unit)}
          </span>{" "}
          <span className="text-muted">30 days</span>
        </p>
      )}
      {showSparkline && summary.sparkline.length > 1 && <Sparkline points={summary.sparkline} />}
    </Link>
  );
}
```

- [ ] **Step 5: Implement `frontend/src/components/GoalProgress.tsx`**

```tsx
import { formatDay, formatValue } from "../lib/format";
import { metricInfo } from "../lib/metrics";
import type { Goal } from "../lib/types";

export function goalStatusText(goal: Goal): string {
  const p = goal.projection;
  switch (p.state) {
    case "on_track":
      return p.projected_date ? `On track for ${formatDay(p.projected_date)}` : "On track";
    case "reached":
      return "Goal reached";
    case "not_on_pace":
      return "Not on pace at current rate";
    default:
      return "Need more data";
  }
}

export function GoalProgress({ goal }: { goal: Goal }) {
  const { label, unit } = metricInfo(goal.metric);
  const pct = goal.projection.progress_pct ?? 0;
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{label}</p>
        <p className="tabular text-sm text-muted">
          {formatValue(goal.projection.current, unit)} → {formatValue(goal.target_value, unit)}
        </p>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} goal progress`}>
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {Math.round(pct)}% · {goalStatusText(goal)}
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Replace `frontend/src/pages/Home.tsx`**

```tsx
import { Link } from "react-router";
import { type LogTab, useLogSheet } from "../components/AppLayout";
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { GoalProgress } from "../components/GoalProgress";
import { StatCard } from "../components/StatCard";
import type { Direction } from "../lib/format";
import { useDashboard } from "../lib/queries";
import type { Dashboard } from "../lib/types";

export const DEFAULT_DIRECTION: Record<string, Direction> = {
  fat_mass_kg: "down",
  lean_mass_kg: "up",
  body_fat_pct: "down",
  muscle_mass_kg: "up",
};

export function nudgeMessages(n: Dashboard["nudges"]): { text: string; tab: LogTab }[] {
  const out: { text: string; tab: LogTab }[] = [];
  if (n.days_since_weigh_in != null && n.days_since_weigh_in >= 2) {
    out.push({ text: `Last weigh-in: ${n.days_since_weigh_in} days ago`, tab: "weigh-in" });
  }
  if (n.days_since_photo == null) {
    out.push({ text: "No progress photos yet. Add your first?", tab: "photo" });
  } else if (n.days_since_photo >= 28) {
    out.push({ text: `No photos in ${Math.floor(n.days_since_photo / 7)} weeks. Time for a check-in?`, tab: "photo" });
  }
  return out;
}

export function Home() {
  const dashboard = useDashboard();
  const logSheet = useLogSheet();
  if (dashboard.isPending) return <Spinner />;
  if (dashboard.isError) return <ErrorState message={dashboard.error.message} onRetry={() => void dashboard.refetch()} />;
  const d = dashboard.data;
  const hasData = [...d.hero, ...d.cards, ...d.secondary].some((s) => s.latest != null);

  if (!hasData) {
    return (
      <EmptyState
        title="Welcome to BodyOS"
        body="Log your first weigh-in to start seeing trends."
        action={
          <button type="button" onClick={() => logSheet.open("weigh-in")} className="rounded-xl bg-accent px-4 py-2 font-medium text-bg">
            Log weigh-in
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {nudgeMessages(d.nudges).map((n) => (
        <button key={n.text} type="button" onClick={() => logSheet.open(n.tab)} className="block w-full rounded-2xl bg-surface-2 px-4 py-3 text-left text-sm">
          {n.text}
        </button>
      ))}

      <section className="grid grid-cols-2 gap-3">
        {d.hero.map((s) => (
          <StatCard key={s.metric} summary={s} size="hero" fallbackDirection={DEFAULT_DIRECTION[s.metric]} />
        ))}
      </section>

      <section className="grid grid-cols-2 gap-3">
        {d.cards.map((s) => (
          <StatCard key={s.metric} summary={s} showSparkline fallbackDirection={DEFAULT_DIRECTION[s.metric]} />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Goals</h2>
        {d.goals.length === 0 ? (
          <Link to="/goals" className="block rounded-2xl border border-dashed border-border p-4 text-sm">
            Set a goal for body fat or muscle mass →
          </Link>
        ) : (
          d.goals.map((g) => <GoalProgress key={g.id} goal={g} />)
        )}
      </section>

      <section className="grid grid-cols-3 gap-3">
        {d.secondary.map((s) => (
          <StatCard key={s.metric} summary={s} size="mini" />
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 7: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add recomposition-focused home dashboard"
```

---

### Task 21: History and Goals pages

**Files:**
- Create: `frontend/src/components/Modal.tsx`, `frontend/src/forms/GoalForm.tsx`, `frontend/src/pages/History.tsx`, `frontend/src/pages/Goals.tsx`
- Modify: `frontend/src/App.tsx` (routes `history`, `goals`)
- Test: `frontend/src/forms/GoalForm.test.tsx`, `frontend/src/pages/History.test.tsx`

**Interfaces:**
- Consumes: `bodyEntries`, `measurements`, `goals`, `useProfile`, `WeighInForm`, `MeasurementForm`, `GoalProgress`, `GOAL_METRICS`, `applyServerErrors`, `requiredNumber`
- Produces:
  - `Modal({ title, onClose, children })`
  - `GoalForm({ availableMetrics: { key: GoalMetric; label: string; unit: string }[]; onSubmit(input: GoalInput) => Promise<void> })`
  - `History` page (weigh-ins / measurements tabs, edit in modal, delete with confirm)
  - `Goals` page (create; active goals with Mark achieved / Archive / Delete; past goals)

- [ ] **Step 1: Write failing tests**

`frontend/src/forms/GoalForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import { GOAL_METRICS } from "../lib/metrics";
import { GoalForm } from "./GoalForm";

describe("GoalForm", () => {
  it("submits a goal", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<GoalForm availableMetrics={GOAL_METRICS} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Metric"), "body_fat_pct");
    await userEvent.type(screen.getByLabelText("Target"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(onSubmit).toHaveBeenCalledWith({ metric: "body_fat_pct", target_value: 15, target_date: null });
  });

  it("shows why the server refused", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new ApiError(422, "Log at least one Body fat reading before setting this goal"));
    render(<GoalForm availableMetrics={GOAL_METRICS} onSubmit={onSubmit} />);
    await userEvent.selectOptions(screen.getByLabelText("Metric"), "body_fat_pct");
    await userEvent.type(screen.getByLabelText("Target"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Log at least one Body fat reading");
  });
});
```

`frontend/src/pages/History.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const del = vi.fn();
const update = vi.fn().mockResolvedValue({});
const entry = {
  id: "e1",
  measured_at: "2026-02-28T05:00:00Z",
  weight_kg: 81.5,
  body_fat_pct: 18,
  muscle_mass_kg: null,
  note: null,
};
vi.mock("../lib/queries", () => ({
  useProfile: () => ({ data: { hidden_metrics: [], sex: "male" } }),
  bodyEntries: {
    useList: () => ({ data: [entry], isPending: false }),
    useUpdate: () => ({ mutateAsync: update }),
    useDelete: () => ({ mutate: del }),
  },
  measurements: {
    useList: () => ({ data: [], isPending: false }),
    useUpdate: () => ({ mutateAsync: vi.fn() }),
    useDelete: () => ({ mutate: vi.fn() }),
  },
  useNavyPreview: () => ({ data: undefined }),
}));

import { History } from "./History";

describe("History", () => {
  it("deletes an entry after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<History />);
    await userEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(del).toHaveBeenCalledWith("e1");
  });

  it("edits an entry in a modal", async () => {
    render(<History />);
    await userEvent.click(screen.getByRole("button", { name: /Edit/ }));
    const weight = screen.getByLabelText("Weight");
    await userEvent.clear(weight);
    await userEvent.type(weight, "81");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(update).toHaveBeenCalledWith({ id: "e1", body: expect.objectContaining({ weight_kg: 81 }) });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/forms/GoalForm.test.tsx src/pages/History.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `frontend/src/components/Modal.tsx`**

```tsx
import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5 md:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-2 text-muted">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/forms/GoalForm.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Field } from "../components/Field";
import { applyServerErrors, requiredNumber } from "../lib/forms";
import type { GoalInput, GoalMetric } from "../lib/types";

const schema = z.object({
  metric: z.string().min(1, "Choose a metric"),
  target_value: requiredNumber(0.1, 10000),
  target_date: z.string(),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

type Props = {
  availableMetrics: { key: GoalMetric; label: string; unit: string }[];
  onSubmit: (input: GoalInput) => Promise<void>;
};

export function GoalForm({ availableMetrics, onSubmit }: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    defaultValues: { metric: "", target_value: "", target_date: "" },
  });
  const unit = availableMetrics.find((m) => m.key === watch("metric"))?.unit;

  if (availableMetrics.length === 0) {
    return <p className="text-sm text-muted">Every goal metric already has an active goal.</p>;
  }

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await onSubmit({ metric: v.metric as GoalMetric, target_value: v.target_value, target_date: v.target_date || null });
      reset();
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ["metric", "target_value", "target_date"]));
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-2xl bg-surface p-4">
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Metric</span>
        <select className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5" {...register("metric")}>
          <option value="">Choose…</option>
          {availableMetrics.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        {errors.metric && <span className="mt-1 block text-xs text-bad">{errors.metric.message}</span>}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target" unit={unit} inputMode="decimal" error={errors.target_value?.message} {...register("target_value")} />
        <Field label="By (optional)" type="date" error={errors.target_date?.message} {...register("target_date")} />
      </div>
      {formError && <p role="alert" className="text-sm text-bad">{formError}</p>}
      <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-accent py-2.5 font-medium text-bg disabled:opacity-60">
        Add goal
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Implement `frontend/src/pages/History.tsx`**

```tsx
import { useState } from "react";
import { EmptyState, Spinner } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { MeasurementForm } from "../forms/MeasurementForm";
import { WeighInForm } from "../forms/WeighInForm";
import { formatDateTime, formatValue } from "../lib/format";
import { TAPE_FIELDS } from "../lib/metrics";
import { bodyEntries, measurements, useProfile } from "../lib/queries";
import type { BodyEntry, Measurement } from "../lib/types";

type Editing = { kind: "entry"; item: BodyEntry } | { kind: "measurement"; item: Measurement } | null;

export function History() {
  const [tab, setTab] = useState<"weigh-ins" | "measurements">("weigh-ins");
  const [editing, setEditing] = useState<Editing>(null);
  const profile = useProfile();
  const entries = bodyEntries.useList();
  const tapes = measurements.useList();
  const updateEntry = bodyEntries.useUpdate();
  const deleteEntry = bodyEntries.useDelete();
  const updateTape = measurements.useUpdate();
  const deleteTape = measurements.useDelete();

  const confirmDelete = (fn: () => void) => {
    if (window.confirm("Delete this entry? This can't be undone.")) fn();
  };
  const row = "flex items-center justify-between gap-3 px-4 py-3";
  const action = "rounded-lg bg-surface-2 px-2.5 py-1 text-xs";

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">History</h1>
      <div role="tablist" className="flex gap-1 rounded-xl bg-surface p-1">
        {(["weigh-ins", "measurements"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`flex-1 rounded-lg py-1.5 text-sm capitalize ${tab === t ? "bg-surface-2" : "text-muted"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "weigh-ins" && (
        <>
          {entries.isPending && <Spinner />}
          {entries.data?.length === 0 && <EmptyState title="No weigh-ins yet" />}
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {entries.data?.map((e) => (
              <li key={e.id} className={row}>
                <div>
                  <p className="tabular">
                    {formatValue(e.weight_kg, "kg")}
                    {e.body_fat_pct != null && <span className="text-muted"> · {formatValue(e.body_fat_pct, "%")}</span>}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(e.measured_at)}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={action} aria-label={`Edit weigh-in from ${formatDateTime(e.measured_at)}`} onClick={() => setEditing({ kind: "entry", item: e })}>Edit</button>
                  <button type="button" className={action} aria-label={`Delete weigh-in from ${formatDateTime(e.measured_at)}`} onClick={() => confirmDelete(() => deleteEntry.mutate(e.id))}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "measurements" && (
        <>
          {tapes.isPending && <Spinner />}
          {tapes.data?.length === 0 && <EmptyState title="No measurements yet" />}
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {tapes.data?.map((m) => (
              <li key={m.id} className={row}>
                <div>
                  <p className="tabular text-sm">
                    {TAPE_FIELDS.filter((f) => m[f.key] != null)
                      .map((f) => `${f.label} ${formatValue(m[f.key], "cm")}`)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-muted">{formatDateTime(m.measured_at)}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={action} aria-label={`Edit measurements from ${formatDateTime(m.measured_at)}`} onClick={() => setEditing({ kind: "measurement", item: m })}>Edit</button>
                  <button type="button" className={action} aria-label={`Delete measurements from ${formatDateTime(m.measured_at)}`} onClick={() => confirmDelete(() => deleteTape.mutate(m.id))}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing?.kind === "entry" && (
        <Modal title="Edit weigh-in" onClose={() => setEditing(null)}>
          <WeighInForm
            hiddenMetrics={profile.data?.hidden_metrics ?? []}
            initial={editing.item}
            submitLabel="Save changes"
            onSubmit={async (body) => {
              await updateEntry.mutateAsync({ id: editing.item.id, body });
              setEditing(null);
            }}
          />
        </Modal>
      )}
      {editing?.kind === "measurement" && (
        <Modal title="Edit measurements" onClose={() => setEditing(null)}>
          <MeasurementForm
            sex={profile.data?.sex ?? "male"}
            initial={editing.item}
            submitLabel="Save changes"
            onSubmit={async (body) => {
              await updateTape.mutateAsync({ id: editing.item.id, body });
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Implement `frontend/src/pages/Goals.tsx`**

```tsx
import { EmptyState, ErrorState, Spinner } from "../components/EmptyState";
import { GoalProgress } from "../components/GoalProgress";
import { GoalForm } from "../forms/GoalForm";
import { formatValue } from "../lib/format";
import { GOAL_METRICS, metricInfo } from "../lib/metrics";
import { goals } from "../lib/queries";

export function Goals() {
  const list = goals.useList();
  const create = goals.useCreate();
  const update = goals.useUpdate();
  const remove = goals.useDelete();
  if (list.isPending) return <Spinner />;
  if (list.isError) return <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />;

  const active = list.data.filter((g) => g.status === "active");
  const past = list.data.filter((g) => g.status !== "active");
  const taken = new Set(active.map((g) => g.metric));
  const btn = "rounded-lg bg-surface-2 px-2.5 py-1 text-xs";

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Goals</h1>
      <GoalForm
        availableMetrics={GOAL_METRICS.filter((m) => !taken.has(m.key))}
        onSubmit={async (input) => {
          await create.mutateAsync(input);
        }}
      />

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Active</h2>
        {active.length === 0 && <EmptyState title="No active goals" body="Pick a metric above to set a target." />}
        {active.map((g) => (
          <div key={g.id} className="space-y-2">
            <GoalProgress goal={g} />
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={() => update.mutate({ id: g.id, body: { status: "achieved" } })}>Mark achieved</button>
              <button type="button" className={btn} onClick={() => update.mutate({ id: g.id, body: { status: "archived" } })}>Archive</button>
              <button type="button" className={btn} onClick={() => window.confirm("Delete this goal?") && remove.mutate(g.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      {past.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted">Past</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-surface">
            {past.map((g) => {
              const info = metricInfo(g.metric);
              return (
                <li key={g.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>
                    {info.label} → {formatValue(g.target_value, info.unit)} <span className="text-muted">({g.status})</span>
                  </span>
                  <button type="button" className={btn} onClick={() => window.confirm("Delete this goal?") && remove.mutate(g.id)}>Delete</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 7: Add routes** in `frontend/src/App.tsx`:

```tsx
          <Route path="history" element={<History />} />
          <Route path="goals" element={<Goals />} />
```

- [ ] **Step 8: Run tests, lint, typecheck, build**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all pass

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "feat(frontend): add history editing and goals management"
```

---

## Phase C — End-to-end, deployment

### Task 22: End-to-end tests against a local Supabase stack

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/global-setup.ts`, `frontend/e2e/flows.spec.ts`
- Modify: `.github/workflows/ci.yml` (e2e job), `.gitignore` (`frontend/e2e/.user.json`)

**Interfaces:**
- Consumes: the whole app; Supabase CLI local stack (`supabase start` applies `supabase/migrations`)
- Environment expected when running (set from `supabase status -o env`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL=http://localhost:8000`

- [ ] **Step 1: Write `frontend/playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "python -m uvicorn app.main:app --port 8000",
      cwd: "../backend",
      url: "http://localhost:8000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
```

- [ ] **Step 2: Write `frontend/e2e/global-setup.ts`**

```ts
import { writeFileSync } from "node:fs";

export default async function globalSetup() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for e2e");
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
```

- [ ] **Step 3: Write `frontend/e2e/flows.spec.ts`**

```ts
import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const user = JSON.parse(readFileSync(new URL("./.user.json", import.meta.url), "utf8")) as { email: string; password: string };
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
  await page.getByLabel("Male").check();
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
  await expect(page.getByText("Low")).toBeVisible();
});

test("upload progress photos and compare them", async ({ page }) => {
  await signIn(page);
  for (const daysAgo of [10, 1]) {
    await page.getByRole("button", { name: "Log" }).click();
    await page.getByRole("tab", { name: "Photo" }).click();
    await page.getByLabel("Choose from gallery").setInputFiles({ name: "front.png", mimeType: "image/png", buffer: PNG });
    await page.getByLabel("Date & time").fill(localInput(daysAgo));
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  }
  await page.goto("/photos");
  await expect(page.getByAltText("front photo")).toHaveCount(2);
  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page.getByLabel("Compare position")).toBeVisible();
});
```

- [ ] **Step 4: Ignore the generated credentials file**

Append `frontend/e2e/.user.json` to `.gitignore`.

- [ ] **Step 5: Run locally**

```bash
npx --yes supabase@latest start          # from repo root; applies migrations
eval "$(npx --yes supabase@latest status -o env | sed 's/^/export /')"
export DATABASE_URL="$DB_URL" SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" SUPABASE_JWT_SECRET="$JWT_SECRET"
export VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" VITE_API_URL="http://localhost:8000"
cd frontend && npx playwright test
```

(Activate the backend virtualenv first so `python -m uvicorn` resolves. If your Supabase CLI prints the keys as `PUBLISHABLE_KEY`/`SECRET_KEY` instead of `ANON_KEY`/`SERVICE_ROLE_KEY`, map those instead. If it prints no `JWT_SECRET`, leave `SUPABASE_JWT_SECRET` empty: the backend then verifies tokens with JWKS.)
Expected: 2 passed. The photo test is the first real exercise of `SupabaseStorage` (signed upload, existence check, batch signing). If it fails, fix `backend/app/storage.py` against the actual responses before moving on.

- [ ] **Step 6: Add the e2e job to `.github/workflows/ci.yml`**

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: [backend, frontend]
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase start
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install ./backend
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
        working-directory: frontend
      - run: npx playwright install --with-deps chromium
        working-directory: frontend
      - name: Playwright
        run: |
          eval "$(supabase status -o env | sed 's/^/export /')"
          export DATABASE_URL="$DB_URL" SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" SUPABASE_JWT_SECRET="${JWT_SECRET:-}"
          export VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_ANON_KEY="$ANON_KEY" VITE_API_URL="http://localhost:8000"
          cd frontend && npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: frontend/test-results
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore frontend/playwright.config.ts frontend/e2e .github
git commit -m "test(e2e): cover onboarding, logging, trends and photo compare against local Supabase"
```

---

### Task 23: Deployment configuration and README

**Files:**
- Create: `render.yaml`, `frontend/vercel.json`, `frontend/public/_redirects`, `README.md`

**Interfaces:**
- Produces: a Render blueprint for the API, SPA fallbacks for Vercel/Netlify/Cloudflare Pages, and setup docs.

- [ ] **Step 1: Write `render.yaml`**

```yaml
services:
  - type: web
    name: bodyos-api
    runtime: python
    plan: free
    rootDir: backend
    buildCommand: pip install .
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /health
    envVars:
      - key: PYTHON_VERSION
        value: "3.12.7"
      - key: DATABASE_URL
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: SUPABASE_JWT_SECRET
        sync: false
      - key: CORS_ORIGINS
        sync: false
```

- [ ] **Step 2: Write SPA fallbacks**

`frontend/vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

`frontend/public/_redirects` (Netlify / Cloudflare Pages):

```
/*    /index.html   200
```

- [ ] **Step 3: Write `README.md`**

````markdown
# BodyOS

A personal, mobile-first web app for tracking body composition, measurements and progress photos, with smoothed trends and goal projections.

- `frontend/`: React + Vite PWA (installable on your phone)
- `backend/`: FastAPI (Python): API, calculations, signed photo URLs
- `supabase/`: database migrations (Postgres, auth, private photo bucket)

## Local development

Requirements: Python 3.11+, Node 22, Docker.

```bash
# 1. Supabase (Postgres, auth and storage in Docker; applies migrations)
npx supabase start
npx supabase status          # note API URL, anon key, service role key, JWT secret, DB URL

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
# Backend unit + API tests (needs a throwaway Postgres)
docker run -d --name bodyos-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=bodyos_test -p 5432:5432 postgres:15
cd backend && pytest

# Frontend
cd frontend && npm test

# End-to-end (needs `supabase start`; see Task 22 in the plan for env vars)
cd frontend && npx playwright test
```

## Deploying (all free tiers)

### 1. Supabase
1. Create a project at supabase.com.
2. Link and push migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. **Authentication → URL configuration:** set *Site URL* to your frontend URL and add it to *Redirect URLs*.
4. Optional: **Authentication → Providers → Google** to enable Google sign-in.
5. From **Project settings → API**, copy the project URL, the anon (publishable) key, the service role (secret) key, and, if shown, the legacy JWT secret.
6. From **Connect**, copy the **Session pooler** connection string (IPv4-compatible; Render can't reach the direct IPv6 host).

Free projects pause after about a week without activity. Open the dashboard to resume one.

### 2. Backend on Render
1. New → Blueprint → select this repo (uses `render.yaml`).
2. Set env vars: `DATABASE_URL` (session pooler), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (leave empty if your project uses asymmetric JWT keys), `CORS_ORIGINS` (e.g. `["https://bodyos.vercel.app"]`).
3. The free instance sleeps after 15 minutes idle; the app pings `/health` on load and shows "Waking up server…" while it starts.

### 3. Frontend on Vercel (or Netlify / Cloudflare Pages)
1. Import the repo, root directory `frontend`, framework Vite.
2. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL` (the Render URL).
3. Deploy, open it on your phone, and use "Add to Home Screen".
````

- [ ] **Step 4: Verify the build output once more**

Run: `cd frontend && npm run build && ls dist`
Expected: `index.html`, `manifest.webmanifest`, `sw.js`, `_redirects`.

- [ ] **Step 5: Commit**

```bash
git add render.yaml frontend/vercel.json frontend/public/_redirects README.md
git commit -m "docs: add deployment config and README"
```

- [ ] **Step 6: Manual smoke test after first deploy** (record results in the PR description)

1. Sign up on the deployed site. The profile 404 routes you to onboarding.
2. Complete onboarding and log a weigh-in with body fat. Home shows fat and lean mass.
3. Add a front photo, reload Photos, and confirm the image loads (signed URL works in production).
4. Change height in Settings. BMI in Trends updates.
5. Leave the app idle for more than 15 minutes, reopen it, and confirm "Waking up server…" appears and then clears.
