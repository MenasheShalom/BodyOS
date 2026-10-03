# BodyOS Nutrition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user log what they eat quickly (search, barcode, custom foods, recipes, saved meals, quick-add), see daily macros and key micronutrients against targets, and get an adaptive TDEE with weekly suggested targets that they approve.

**Architecture:** Same shape as sub-project 1. The React PWA calls FastAPI with the Supabase JWT, and FastAPI is the only component that touches Postgres. The additions:
- FastAPI proxies and normalises Open Food Facts (OFF) and USDA FoodData Central (FDC), and caches opened foods in a shared `foods` table.
- Log entries store a nutrient snapshot.
- All maths (scaling, totals, coverage, BMR, TDEE, targets) lives in pure-Python `app/calculations/nutrition.py`.

**Tech Stack:** Unchanged from sub-project 1, plus `zxing-wasm` (frontend barcode fallback, Phase 2).

**Spec:** `docs/superpowers/specs/2026-09-30-bodyos-nutrition-design.md`

**Delivery:** three phases, one PR each (spec §10).
- **Phase 1** is specified task-by-task below.
- **Phases 2 and 3** are outlined at task level. Each gets expanded into full steps in this file just before it starts. Phase 1 records real OFF and FDC payloads and settles the food/log API shapes, and the later tasks depend on both.

## Global Constraints

- Every rule from the sub-project 1 plan still holds:
  - Every query is scoped to the JWT user.
  - Metric units only.
  - Derived values are computed, not stored.
  - Text + check instead of enums.
  - Secrets are never committed.
  - Free tiers only.
- **Unknown ≠ zero.** A nutrient key missing from a `nutrients` object means "not reported". Totals sum only known values and report per-nutrient **coverage** (the share of kcal from entries that report the nutrient). Never default a missing value to 0.
- **Snapshots.** `food_log.nutrients` holds the totals for that entry at log time. Changing the amount scales the snapshot (`new = old × new_g / old_g`). It never re-reads the food.
- **Shared vs own foods.**
  - `foods.user_id is null` ⇔ `source in ('off','usda')`. Only the backend writes shared rows, via `/foods/import`.
  - A user may log a food only if `user_id is null or user_id = me`.
- **Nutrient keys** (spec §4.1), identical in backend `app/nutrients.py` and frontend `src/lib/nutrients.ts`: `energy_kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sat_fat_g, sodium_mg, potassium_mg, calcium_mg, iron_mg, magnesium_mg, zinc_mg, vit_d_mcg, vit_b12_mcg, vit_c_mg, vit_a_mcg, folate_mcg`.
- **Plausibility per 100 g:** kcal ≤ 900; protein, carbs, fat, fibre, sugar and saturated fat each ≤ 100 g; protein + carbs + fat ≤ 105 g. An external food that fails is dropped from results. A custom food that fails gets a 422.
- **Days** are bucketed in the profile timezone, and `day` query params are local dates.
- **External sources:**
  - 8 s timeout, no retries on the request path.
  - A failure goes into `sources_failed`, never a 5xx.
  - One OFF call per submitted search, with a 10-minute in-memory TTL cache for OFF search and barcode responses.
  - OFF needs the `User-Agent` from `OFF_USER_AGENT`.
- **Settings defaults** (spec §11):
  - mode `recomp`.
  - `deficit_pct` null (use the mode default: recomp 10, cut 20, maintain 0, lean_bulk −7).
  - `protein_g_per_kg` 2.0 (body weight).
  - `check_in_weekday` 6 (Sunday, Python `weekday()`).
  - `food_country` `en:israel`.
- **Target rounding:** kcal to 10, grams to 5.
- **Hebrew text:** every food name element gets `dir="auto"`.

## Review Focus

1. **Late-night meals.** A snack at 23:40 local on the 3rd is on the 3rd, even though it's the 3rd at 21:40 UTC in Israel (UTC+2/+3). Pinned in Task 2 (`test_day_bounds_israel_dst`) and Task 6 (`test_day_view_uses_profile_timezone`).
2. **Snapshot stability.** Editing a custom food after logging it leaves yesterday's totals unchanged, and editing an entry's grams scales its own snapshot. Pinned in Task 6 (`test_editing_food_does_not_change_logged_entry`, `test_patch_grams_scales_snapshot`).
3. **Cross-user food access.** User B cannot log, read or edit user A's custom food by id. Shared cached foods are readable by both and writable by neither. Pinned in Task 1 (RLS) and Tasks 5–6 (API isolation tests).
4. **External source failure.** OFF timing out still returns local results and `sources_failed: ["off"]` with status 200. Pinned in Task 5 (`test_search_survives_failing_source`).
5. **Missing micros look like zero.** A day of packaged foods with no vitamin D data must show "unknown/low coverage", not "0 µg". Pinned in Task 2 (`test_totals_track_coverage`) and Task 11 (`NutritionSummary` test).

---

## File Structure (Phase 1)

```
supabase/migrations/
  20260930000001_nutrition_core.sql          foods, food_log, nutrition_settings, nutrition_targets + RLS
backend/
  .env.example                                + USDA_API_KEY, OFF_USER_AGENT, FOOD_SOURCES
  app/
    config.py                                 + usda_api_key, off_user_agent, food_sources
    crud.py                                   Table literal + new tables
    nutrients.py                              nutrient registry (key, label, unit, USDA ids, OFF field, scale, max)
    calculations/nutrition.py                 scale, scale_snapshot, day_totals, day_bounds, age, bmr, targets_from_tdee
    food_sources/
      __init__.py                             FoodDraft, FoodSource protocol, get_food_sources()
      normalise.py                            from_off(), from_fdc_search(), from_fdc_detail(), plausible()
      off.py                                  OffSource (httpx, TTL cache)
      fdc.py                                  FdcSource (httpx)
      fake.py                                 FakeFoodSource (fixtures; tests + e2e)
      ttl_cache.py                            tiny TTL dict
    services/food_service.py                  search_foods(), import_food(), visible_food()
    routers/foods.py  routers/food_log.py  routers/nutrition.py
    schemas.py                                + nutrition schemas
  scripts/record_food_fixtures.py             one-off: records live OFF/FDC responses to tests/fixtures
  tests/
    fixtures/food_sources/*.json
    test_migrations_nutrition.py  test_calc_nutrition.py  test_food_normalise.py
    test_food_sources.py  test_foods_api.py  test_food_log_api.py  test_nutrition_api.py
frontend/src/
  lib/nutrients.ts  lib/serving.ts  lib/meals.ts  lib/types.ts (+)  lib/queries.ts (+)
  components/AppLayout.tsx (nav)  components/LogSheet.tsx (+ Food tab)
  components/nutrition/DateStrip.tsx  NutritionSummary.tsx  MealSection.tsx  EntrySheet.tsx
  components/nutrition/AddFood.tsx  FoodDetail.tsx  ServingPicker.tsx  QuickAddForm.tsx  FoodName.tsx
  forms/CustomFoodForm.tsx  forms/TargetsForm.tsx
  pages/Food.tsx  pages/MyFoods.tsx  pages/NutritionSetup.tsx  pages/Targets.tsx  pages/More.tsx (+ links)
  pages/Home.tsx (+ Photos shortcut)
frontend/e2e/nutrition-1-core.spec.ts
render.yaml  README.md                        + env vars
```

Conventions are unchanged from sub-project 1. Commit after every task with the message shown.

---

## Phase 1 — Core logging

### Task 1: Nutrition core migration

**Files:**
- Create: `supabase/migrations/20260930000001_nutrition_core.sql`, `backend/tests/test_migrations_nutrition.py`
- Modify: `backend/tests/conftest.py` (`TABLES`), `backend/app/crud.py` (`Table`)

**Interfaces:**
- Produces: tables `foods`, `food_log`, `nutrition_settings`, `nutrition_targets`.
- `crud.Table` gains `"foods" | "food_log" | "nutrition_targets"`. `nutrition_settings` is keyed by `user_id`, like `profiles`, so it doesn't use the generic crud helpers.

- [ ] **Step 1: Write failing tests `backend/tests/test_migrations_nutrition.py`**

Use the same approach as `test_migrations.py`: connect as superuser, then `set role authenticated` plus `set request.jwt.claim.sub` to exercise RLS. Tests:
  - `test_shared_food_readable_by_any_user_not_writable`: insert a shared `off` food as superuser. As user A, `select` sees it. `update` affects 0 rows.
  - `test_custom_food_visible_only_to_owner`
  - `test_shared_food_must_be_external`: `user_id null` with `source 'custom'` violates `foods_shared_are_external`.
  - `test_external_ref_unique_for_shared_rows`
  - `test_food_log_quick_add_needs_no_grams_but_food_entry_does`: `food_log_amount` check.
  - `test_food_log_nutrients_require_energy`
  - `test_food_delete_sets_log_food_null`: the snapshot survives.
  - `test_targets_unique_per_day`
  - `test_settings_ranges` (deficit −10..25, protein 1.4..3.0, weekday 0..6)

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && pytest tests/test_migrations_nutrition.py -v`
Expected: FAIL, `relation "public.foods" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- BodyOS sub-project 2, phase 1: food cache, food log, nutrition settings and targets

create table public.foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  source text not null check (source in ('off', 'usda', 'custom', 'recipe')),
  source_ref text,
  barcode text check (barcode ~ '^[0-9]{6,14}$'),
  name text not null check (char_length(name) between 1 and 200),
  brand text check (char_length(brand) <= 200),
  nutrients_per_100g jsonb not null check (jsonb_typeof(nutrients_per_100g) = 'object'),
  servings jsonb not null default '[]' check (jsonb_typeof(servings) = 'array'),
  is_liquid boolean not null default false,
  recipe_id uuid,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint foods_shared_are_external
    check ((user_id is null) = (source in ('off', 'usda'))),
  constraint foods_external_have_ref
    check (source not in ('off', 'usda') or source_ref is not null)
);
create unique index foods_external_ref on public.foods (source, source_ref) where user_id is null;
create index foods_barcode on public.foods (barcode) where barcode is not null;
create index foods_owner on public.foods (user_id) where user_id is not null;

create table public.food_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  eaten_at timestamptz not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  food_id uuid references public.foods (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  grams numeric(7,1) check (grams between 0.1 and 5000),
  serving_label text check (char_length(serving_label) <= 100),
  serving_count numeric(6,2) check (serving_count > 0 and serving_count <= 100),
  nutrients jsonb not null
    check (jsonb_typeof(nutrients) = 'object' and nutrients ? 'energy_kcal'),
  meal_ref uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- entries logged from a food carry an amount; quick-add entries (no food) don't need one
  constraint food_log_amount check (food_id is null or grams is not null)
);
create index food_log_user_time on public.food_log (user_id, eaten_at);

create table public.nutrition_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  mode text not null default 'recomp' check (mode in ('recomp', 'cut', 'maintain', 'lean_bulk')),
  deficit_pct numeric(4,1) check (deficit_pct between -10 and 25),
  protein_g_per_kg numeric(3,1) not null default 2.0 check (protein_g_per_kg between 1.4 and 3.0),
  activity_level text not null default 'light'
    check (activity_level in ('sedentary', 'light', 'moderate', 'very')),
  check_in_weekday smallint not null default 6 check (check_in_weekday between 0 and 6),
  food_country text not null default 'en:israel' check (food_country ~ '^[a-z]{2}:[a-z-]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.nutrition_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  effective_from date not null,
  energy_kcal integer not null check (energy_kcal between 800 and 6000),
  protein_g integer not null check (protein_g between 0 and 500),
  carbs_g integer not null check (carbs_g between 0 and 1000),
  fat_g integer not null check (fat_g between 0 and 400),
  fiber_g integer not null check (fiber_g between 0 and 150),
  origin text not null check (origin in ('manual', 'suggested')),
  tdee_at_creation integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, effective_from)
);

do $$
declare
  t text;
begin
  foreach t in array array['foods', 'food_log', 'nutrition_settings', 'nutrition_targets']
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t
    );
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['food_log', 'nutrition_settings', 'nutrition_targets']
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated'
      ' using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own_rows', t
    );
  end loop;
end $$;

-- foods: shared cache rows are readable by everyone signed in; only owners write their own rows.
create policy foods_read on public.foods for select to authenticated
  using (user_id is null or user_id = auth.uid());
create policy foods_insert_own on public.foods for insert to authenticated
  with check (user_id = auth.uid());
create policy foods_update_own on public.foods for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy foods_delete_own on public.foods for delete to authenticated
  using (user_id = auth.uid());
```

- [ ] **Step 4: Update the harness**

In `conftest.py`, put `TABLES` in dependency order for truncation: `["food_log", "nutrition_targets", "nutrition_settings", "foods", "goals", "progress_photos", "measurements", "body_entries", "profiles"]`. Shared `foods` rows have `user_id null`, so `truncate … auth.users cascade` alone would miss them. Truncating `foods` explicitly covers that. Add the three crud tables to `Table`.

- [ ] **Step 5: Run the tests, then the full backend suite**

Run: `pytest tests/test_migrations_nutrition.py -v && pytest -q`
Expected: PASS, with no regressions.

- [ ] **Step 6: Run the Supabase advisor check locally**

Run: `npx supabase db lint`. There should be no new warnings. The policies use `auth.uid()` directly, matching sub-project 1.

- [ ] **Step 7: Commit** `feat(db): add foods cache, food log, nutrition settings and targets`

---

### Task 2: Nutrient registry and nutrition calculations

**Files:**
- Create: `backend/app/nutrients.py`, `backend/app/calculations/nutrition.py`, `backend/tests/test_calc_nutrition.py`

**Interfaces:**
- Produces:
  - `Nutrients = dict[str, float]`
  - `NUTRIENTS: dict[str, Nutrient]` (ordered)
  - `MACRO_KEYS`
  - `validate_nutrients(n: Mapping[str, float], *, per_100g: bool) -> Nutrients` (raises `ValueError`)
  - `scale(per_100g, grams) -> Nutrients`
  - `scale_snapshot(snapshot, old_g, new_g) -> Nutrients`
  - `DayTotals(totals, coverage)`
  - `day_totals(entries: Iterable[Nutrients]) -> DayTotals`
  - `day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]`
  - `age_on(dob, today) -> int`
  - `bmr(sex, age, weight_kg, height_cm, lean_mass_kg=None) -> float`
  - `ACTIVITY_FACTORS`
  - `MODE_DEFICIT`
  - `Targets` dataclass
  - `targets_from_tdee(...) -> Targets`

- [ ] **Step 1: Write failing tests `backend/tests/test_calc_nutrition.py`**

```python
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from app.calculations.nutrition import (
    Targets, age_on, bmr, day_bounds, day_totals, scale, scale_snapshot, targets_from_tdee,
)
from app.nutrients import validate_nutrients


def test_scale_keeps_unknown_keys_absent() -> None:
    assert scale({"energy_kcal": 250, "protein_g": 10}, 40) == {"energy_kcal": 100, "protein_g": 4}


def test_scale_snapshot_is_proportional() -> None:
    assert scale_snapshot({"energy_kcal": 100, "fat_g": 2}, 40, 60) == {"energy_kcal": 150, "fat_g": 3}


def test_totals_track_coverage() -> None:
    t = day_totals([
        {"energy_kcal": 300, "vit_d_mcg": 2.0},
        {"energy_kcal": 700},  # packaged food: no vitamin D reported
    ])
    assert t.totals["energy_kcal"] == 1000
    assert t.totals["vit_d_mcg"] == 2.0
    assert t.coverage["vit_d_mcg"] == pytest.approx(0.3)
    assert "zinc_mg" not in t.totals and t.coverage["zinc_mg"] == 0


def test_totals_empty_day() -> None:
    t = day_totals([])
    assert t.totals == {} and t.coverage["energy_kcal"] == 0


def test_day_bounds_israel_dst() -> None:
    start, end = day_bounds(date(2026, 3, 27), ZoneInfo("Asia/Jerusalem"))  # DST starts that night
    assert start == datetime(2026, 3, 26, 22, 0, tzinfo=ZoneInfo("UTC"))
    assert end == datetime(2026, 3, 27, 21, 0, tzinfo=ZoneInfo("UTC"))  # 23-hour day


def test_bmr_katch_when_lean_mass_known() -> None:
    assert bmr("male", 38, 85, 180, lean_mass_kg=68) == pytest.approx(370 + 21.6 * 68)


def test_bmr_mifflin_otherwise() -> None:
    assert bmr("male", 38, 85, 180) == pytest.approx(10 * 85 + 6.25 * 180 - 5 * 38 + 5)
    assert bmr("female", 38, 65, 165) == pytest.approx(10 * 65 + 6.25 * 165 - 5 * 38 - 161)


def test_age_on_birthday_boundary() -> None:
    assert age_on(date(1988, 10, 1), date(2026, 9, 30)) == 37
    assert age_on(date(1988, 10, 1), date(2026, 10, 1)) == 38


def test_recomp_targets() -> None:
    t = targets_from_tdee(2600, mode="recomp", deficit_pct=None, protein_g_per_kg=2.0,
                          weight_kg=85, bmr_kcal=1800, sex="male")
    assert t == Targets(energy_kcal=2340, protein_g=170, carbs_g=270, fat_g=65, fiber_g=35)


def test_targets_respect_calorie_floor() -> None:
    t = targets_from_tdee(1500, mode="cut", deficit_pct=25, protein_g_per_kg=2.0,
                          weight_kg=60, bmr_kcal=1350, sex="female")
    assert t.energy_kcal == 1350


def test_targets_lower_protein_before_negative_carbs() -> None:
    t = targets_from_tdee(1900, mode="cut", deficit_pct=25, protein_g_per_kg=3.0,
                          weight_kg=110, bmr_kcal=1500, sex="male")
    assert t.carbs_g >= 0 and t.protein_g == 175  # 1.6 g/kg × 110 rounded to 5


def test_validate_rejects_implausible_and_unknown_keys() -> None:
    with pytest.raises(ValueError):
        validate_nutrients({"energy_kcal": 950}, per_100g=True)
    with pytest.raises(ValueError):
        validate_nutrients({"energy_kcal": 100, "protein_g": 60, "fat_g": 50}, per_100g=True)
    with pytest.raises(ValueError):
        validate_nutrients({"energy_kcal": 100, "caffeine_mg": 5}, per_100g=False)
    with pytest.raises(ValueError):
        validate_nutrients({"energy_kcal": -1}, per_100g=False)
```

Check the last targets test by hand. kcal = 1900 × 0.75 = 1425, floored to max(1500, 1500) = 1500. Protein 330 g → 1320 kcal. Fat max(41.7, 66) = 66 g → 594 kcal. Carbs go negative, so protein drops to 1.6 × 110 = 176 → 704 kcal, leaving carbs (1500 − 704 − 594)/4 = 50.5 ≥ 0. Rounded: protein 175, carbs 50.

- [ ] **Step 2: Run to verify failure** (`ModuleNotFoundError`)

- [ ] **Step 3: Implement `backend/app/nutrients.py`**

```python
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

Nutrients = dict[str, float]


@dataclass(frozen=True)
class Nutrient:
    key: str
    label: str
    unit: str
    kind: Literal["macro", "micro"]
    usda_ids: tuple[int, ...]  # first match wins
    off_field: str
    off_scale: float  # OFF stores grams per 100 g; multiply into our unit
    max_per_100g: float


def _n(key: str, label: str, unit: str, kind: Literal["macro", "micro"],
       usda: tuple[int, ...], off: str, scale: float, cap: float) -> Nutrient:
    return Nutrient(key, label, unit, kind, usda, off, scale, cap)


NUTRIENTS: dict[str, Nutrient] = {n.key: n for n in (
    _n("energy_kcal", "Calories", "kcal", "macro", (1008, 2047, 2048), "energy-kcal_100g", 1, 900),
    _n("protein_g", "Protein", "g", "macro", (1003,), "proteins_100g", 1, 100),
    _n("carbs_g", "Carbs", "g", "macro", (1005,), "carbohydrates_100g", 1, 100),
    _n("fat_g", "Fat", "g", "macro", (1004,), "fat_100g", 1, 100),
    _n("fiber_g", "Fibre", "g", "macro", (1079,), "fiber_100g", 1, 100),
    _n("sugar_g", "Sugar", "g", "macro", (2000,), "sugars_100g", 1, 100),
    _n("sat_fat_g", "Saturated fat", "g", "macro", (1258,), "saturated-fat_100g", 1, 100),
    _n("sodium_mg", "Sodium", "mg", "micro", (1093,), "sodium_100g", 1e3, 40_000),
    _n("potassium_mg", "Potassium", "mg", "micro", (1092,), "potassium_100g", 1e3, 20_000),
    _n("calcium_mg", "Calcium", "mg", "micro", (1087,), "calcium_100g", 1e3, 10_000),
    _n("iron_mg", "Iron", "mg", "micro", (1089,), "iron_100g", 1e3, 500),
    _n("magnesium_mg", "Magnesium", "mg", "micro", (1090,), "magnesium_100g", 1e3, 5_000),
    _n("zinc_mg", "Zinc", "mg", "micro", (1095,), "zinc_100g", 1e3, 500),
    _n("vit_d_mcg", "Vitamin D", "µg", "micro", (1114,), "vitamin-d_100g", 1e6, 1_000),
    _n("vit_b12_mcg", "Vitamin B12", "µg", "micro", (1178,), "vitamin-b12_100g", 1e6, 1_000),
    _n("vit_c_mg", "Vitamin C", "mg", "micro", (1162,), "vitamin-c_100g", 1e3, 5_000),
    _n("vit_a_mcg", "Vitamin A", "µg", "micro", (1106,), "vitamin-a_100g", 1e6, 50_000),
    _n("folate_mcg", "Folate", "µg", "micro", (1190,), "folates_100g", 1e6, 10_000),
)}
MACRO_KEYS = ("protein_g", "carbs_g", "fat_g")


def validate_nutrients(n: Mapping[str, float], *, per_100g: bool) -> Nutrients:
    unknown = set(n) - NUTRIENTS.keys()
    if unknown:
        raise ValueError(f"Unknown nutrients: {', '.join(sorted(unknown))}")
    if "energy_kcal" not in n:
        raise ValueError("Calories are required")
    out: Nutrients = {}
    for key, value in n.items():
        if value < 0:
            raise ValueError(f"{NUTRIENTS[key].label} can't be negative")
        if per_100g and value > NUTRIENTS[key].max_per_100g:
            raise ValueError(f"{NUTRIENTS[key].label} is too high per 100 g")
        out[key] = float(value)
    if per_100g and sum(out.get(k, 0) for k in MACRO_KEYS) > 105:
        raise ValueError("Protein, carbs and fat add up to more than 100 g per 100 g")
    return out
```

The USDA ids and OFF field names are checked against the recorded fixtures in Task 3. If a field differs, fix it here and note it in the commit.

- [ ] **Step 4: Implement `backend/app/calculations/nutrition.py`**

```python
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.calculations.body import Sex
from app.nutrients import NUTRIENTS, Nutrients

ACTIVITY_FACTORS = {"sedentary": 1.2, "light": 1.375, "moderate": 1.55, "very": 1.725}
MODE_DEFICIT = {"recomp": 10.0, "cut": 20.0, "maintain": 0.0, "lean_bulk": -7.0}
KCAL_FLOOR = {"male": 1500, "female": 1200}


def scale(per_100g: Nutrients, grams: float) -> Nutrients:
    return {k: v * grams / 100 for k, v in per_100g.items()}


def scale_snapshot(snapshot: Nutrients, old_grams: float, new_grams: float) -> Nutrients:
    return {k: v * new_grams / old_grams for k, v in snapshot.items()}


@dataclass(frozen=True)
class DayTotals:
    totals: Nutrients
    coverage: dict[str, float]  # 0..1 share of kcal from entries reporting the nutrient


def day_totals(entries: Iterable[Nutrients]) -> DayTotals:
    items = list(entries)
    kcal = sum(e.get("energy_kcal", 0.0) for e in items)
    totals: Nutrients = {}
    coverage: dict[str, float] = {}
    for key in NUTRIENTS:
        known = [e for e in items if key in e]
        if known:
            totals[key] = sum(e[key] for e in known)
        covered = sum(e.get("energy_kcal", 0.0) for e in known)
        coverage[key] = covered / kcal if kcal > 0 else (1.0 if known else 0.0)
    return DayTotals(totals, coverage)


def day_bounds(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(UTC)
    return start, end  # half-open [start, end)


def age_on(dob: date, today: date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def bmr(sex: Sex, age: int, weight_kg: float, height_cm: float,
        lean_mass_kg: float | None = None) -> float:
    if lean_mass_kg is not None:
        return 370 + 21.6 * lean_mass_kg  # Katch-McArdle
    base = 10 * weight_kg + 6.25 * height_cm - 5 * age  # Mifflin-St Jeor
    return base + 5 if sex == "male" else base - 161


@dataclass(frozen=True)
class Targets:
    energy_kcal: int
    protein_g: int
    carbs_g: int
    fat_g: int
    fiber_g: int


def _round(value: float, step: int) -> int:
    return int(step * round(value / step))


def targets_from_tdee(tdee: float, *, mode: str, deficit_pct: float | None,
                      protein_g_per_kg: float, weight_kg: float, bmr_kcal: float,
                      sex: Sex) -> Targets:
    deficit = MODE_DEFICIT[mode] if deficit_pct is None else deficit_pct
    kcal = max(tdee * (1 - deficit / 100), bmr_kcal, KCAL_FLOOR[sex])
    protein = protein_g_per_kg * weight_kg
    fat = max(0.25 * kcal / 9, 0.6 * weight_kg)
    carbs = (kcal - 4 * protein - 9 * fat) / 4
    if carbs < 0:
        protein = 1.6 * weight_kg
        carbs = (kcal - 4 * protein - 9 * fat) / 4
    if carbs < 0:  # cap the deficit: raise calories to cover protein and fat
        kcal, carbs = 4 * protein + 9 * fat, 0.0
    return Targets(_round(kcal, 10), _round(protein, 5), _round(carbs, 5), _round(fat, 5),
                   _round(14 * kcal / 1000, 5))
```

- [ ] **Step 5: Run the tests, `ruff check`, `ruff format`, `mypy app`.** Expected: PASS.

- [ ] **Step 6: Commit** `feat(backend): add nutrient registry and nutrition calculations`

---

### Task 3: Record OFF and FDC fixtures, and build the normalisers

**Files:**
- Create: `backend/scripts/record_food_fixtures.py`, `backend/tests/fixtures/food_sources/*.json`, `backend/app/food_sources/__init__.py`, `backend/app/food_sources/normalise.py`, `backend/tests/test_food_normalise.py`

**Interfaces:**
- Produces:
  - `FoodDraft` (frozen dataclass): `source: Literal["off","usda"]`, `source_ref: str`, `name: str`, `brand: str | None`, `barcode: str | None`, `nutrients_per_100g: Nutrients`, `servings: list[Serving]`, `is_liquid: bool`, `countries: tuple[str, ...]`.
  - `Serving = TypedDict(label: str, grams: float)`
  - `from_off(product: dict) -> FoodDraft | None`
  - `from_fdc_search(item: dict) -> FoodDraft | None`
  - `from_fdc_detail(food: dict) -> FoodDraft | None`
  - `None` means the food is unusable (no name, no energy and no macros, or implausible).

- [ ] **Step 1: Check the current API docs and limits**

Read the current OFF API docs (v2 product endpoint, search endpoint, rate limits, required `User-Agent`) and the FDC API guide (`/foods/search`, `/food/{fdcId}`, `api_key`, rate limits).
- If OFF now recommends the `search.openfoodfacts.org` (search-a-licious) endpoint for text search, use it and record that choice in `off.py`'s docstring.
- Write down the limits you find in the PR description.

- [ ] **Step 2: Write `backend/scripts/record_food_fixtures.py`**

This is a small httpx script (not part of `app`). It saves pretty-printed JSON to `tests/fixtures/food_sources/`:
- `off_product_hebrew.json`: an Israeli product with a Hebrew-only `product_name`. Find one by searching OFF for "במבה".
- `off_product_kj_only.json`: has `energy-kj_100g` but no `energy-kcal_100g`. Pick any from a search, and hand-strip the kcal field if none can be found.
- `off_product_liquid.json`: a drink with `nutrition_data_per: "100ml"` (or whatever field actually marks per-100 ml; verify it).
- `off_search_milk.json`: a search for "milk" with `fields=` limited to what `from_off` reads, plus `countries_tags`.
- `off_not_found.json`
- `fdc_search_chicken.json`: dataType Foundation, SR Legacy, Survey (FNDDS).
- `fdc_detail_foundation.json`: a Foundation food without nutrient 1008, so it exercises the Atwater fallback.
- `fdc_detail_sr_legacy.json`: has `foodPortions`.

Run it once locally with `USDA_API_KEY=DEMO_KEY`, and commit the fixtures. CI never calls the network.

- [ ] **Step 3: Write failing tests `backend/tests/test_food_normalise.py`** (fixture-driven)

  - `test_off_hebrew_name_and_barcode`: the name is the Hebrew string, barcode = code, `source_ref` = code, and `countries` includes `en:israel`.
  - `test_off_kj_only_converts_to_kcal`: kcal = kJ / 4.184, ±0.5.
  - `test_off_liquid_flagged`
  - `test_off_micros_scaled_to_units`: sodium in mg (`sodium_100g` × 1000). Take expected values from the fixture.
  - `test_off_serving_from_serving_quantity`: `serving_size` label and `serving_quantity` grams. It is omitted when `serving_quantity` is missing or ≤ 0.
  - `test_off_missing_kcal_derived_from_macros`: hand-built dict, 4/4/9.
  - `test_off_implausible_returns_none`: hand-built dict, kcal 2000.
  - `test_off_nameless_returns_none`
  - `test_fdc_search_item_maps_by_nutrient_id`
  - `test_fdc_detail_atwater_fallback`: the Foundation fixture.
  - `test_fdc_detail_portions_become_servings`: label from `portionDescription`, else `f"{amount} {modifier}"`, else `measureUnit.name`. Grams from `gramWeight`. Deduplicated by label.
  - `test_name_prefers_english_then_default_then_hebrew`: `product_name_en` → `product_name` → `product_name_he`.
  - `test_names_trimmed_to_200`

- [ ] **Step 4: Implement `normalise.py`**

Key rules:
- Only numeric values are accepted (`isinstance(v, (int, float))`, not bool).
- kcal fallback order: `energy-kcal_100g` → `energy-kj_100g / 4.184` → `energy_100g / 4.184` (OFF's `energy_100g` is in kJ) → 4·P + 4·C + 9·F when all three macros are known. With no kcal and no macros, return `None`.
- FDC: search items use `foodNutrients[].nutrientId` / `value`, and details use `foodNutrients[].nutrient.id` / `amount`. Walk `Nutrient.usda_ids` in order and take the first present.
- Finish with `validate_nutrients(..., per_100g=True)`. On `ValueError`, return `None`.
- Brand: OFF `brands`, taking the first comma part. FDC `brandOwner`, which is usually absent for generic foods.
- `is_liquid`: OFF per-100 ml marker (verified in Step 1). FDC is always `False`.

- [ ] **Step 5: Run the tests, ruff and mypy.** Expected: PASS.

- [ ] **Step 6: Commit** `feat(backend): normalise Open Food Facts and USDA foods`

---

### Task 4: Food source clients, fake source and config

**Files:**
- Create: `backend/app/food_sources/off.py`, `fdc.py`, `fake.py`, `ttl_cache.py`, `backend/tests/test_food_sources.py`
- Modify: `backend/app/food_sources/__init__.py`, `backend/app/config.py`, `backend/.env.example`

**Interfaces:**
- `class FoodSource(Protocol)`: `name: str`, `search(query: str, country: str) -> list[FoodDraft]`, `by_barcode(code: str) -> FoodDraft | None`, `detail(source_ref: str) -> FoodDraft | None`.
- `get_food_sources(settings) -> dict[str, FoodSource]`, a FastAPI dependency.
  - With `settings.food_sources == "fake"` it returns fixture-backed fakes, which e2e uses.
  - Otherwise it returns `{"off": OffSource, "usda": FdcSource}` as module-level singletons, so the TTL cache lives across requests.
- `Settings` adds:
  - `usda_api_key: str = "DEMO_KEY"`
  - `off_user_agent: str = "BodyOS/0.2 (personal nutrition tracker)"`
  - `food_sources: Literal["live", "fake"] = "live"`

- [ ] **Step 1: Write failing tests `test_food_sources.py` with `httpx.MockTransport`** (no network)

  - `test_off_search_sends_user_agent_and_ranks_country_first`: the transport asserts the `User-Agent` header and a single request. Of the returned products, the one with `countries_tags` containing `en:israel` comes first, and otherwise the order is preserved.
  - `test_off_search_cached_for_ten_minutes`: two identical searches make one HTTP call. With the clock advanced 601 s, two calls. Inject `now: Callable[[], float]`.
  - `test_off_barcode_not_found_returns_none` (`status: 0`)
  - `test_off_http_error_raises`: the service layer turns this into `sources_failed`.
  - `test_fdc_search_posts_datatypes_and_key`: `api_key` is a query param, and the body has `dataType` `["Foundation", "SR Legacy", "Survey (FNDDS)"]` and `pageSize` 15.
  - `test_fdc_barcode_uses_branded_gtin`: search with `dataType ["Branded"]`, keeping only exact `gtinUpc` matches (with leading zeros stripped).
  - `test_detail_fetches_single_food`

- [ ] **Step 2: Implement**

- `ttl_cache.TTLCache[K, V]` (a dict, `ttl_s`, an injectable `now`, and `max_items=256` with oldest-first eviction).
- `OffSource(client: httpx.Client, cache)`: `client` has `timeout=8`, `headers={"User-Agent": ...}` and base `https://world.openfoodfacts.org`. `search` requests `page_size=20` and the minimal `fields`.
- `FdcSource(client, api_key)`: base `https://api.nal.usda.gov/fdc/v1`.
- `FakeFoodSource(name, drafts: list[FoodDraft])`: substring search on name, barcode lookup, `fail: bool` flag.
  - `fake.default_sources()` builds a fake OFF and a fake USDA from the Task 3 fixtures, plus a fixed demo product with barcode `7290000000017`, named "Demo hummus" with a Hebrew brand, for e2e.

- [ ] **Step 3: Update `.env.example`**

```dotenv
# USDA FoodData Central key (free: https://fdc.nal.usda.gov/api-key-signup). DEMO_KEY works for development.
USDA_API_KEY=DEMO_KEY
# Open Food Facts asks every app to identify itself.
OFF_USER_AGENT=BodyOS/0.2 (personal nutrition tracker)
# live | fake (fake = recorded fixtures, used by e2e)
FOOD_SOURCES=live
```

- [ ] **Step 4: Run the tests, ruff and mypy. Commit** `feat(backend): add Open Food Facts and USDA clients with caching`

---

### Task 5: Foods API (search, barcode, import, custom foods)

**Files:**
- Create: `backend/app/services/food_service.py`, `backend/app/routers/foods.py`, `backend/tests/test_foods_api.py`
- Modify: `backend/app/schemas.py`, `backend/app/main.py`

**Interfaces:**
- `FoodOut`: `id: UUID | None` (null for external results not yet cached), `source`, `source_ref`, `barcode`, `name`, `brand`, `nutrients_per_100g`, `servings`, `is_liquid`, `is_own: bool`.
- `FoodSearchOut`: `local: list[FoodOut]`, `external: list[FoodOut]`, `sources_failed: list[str]`.
- `CustomFoodIn`: name, brand?, barcode?, `servings: list[ServingIn]` (≤ 10, grams 0.1–5000, label 1–100 chars), `is_liquid`, **one of** `nutrients_per_100g` or `nutrients_per_serving` + `serving_grams`. It is converted to per 100 g and then validated with `validate_nutrients(per_100g=True)`.
- `CustomFoodPatch`: all fields optional.
- `food_service.visible_food(conn, user_id, food_id) -> dict | None`: `where id = %s and (user_id is null or user_id = %s)`. **Every endpoint that reads a food by id goes through this.**

| Route | Behaviour |
|---|---|
| `GET /foods/search?q=&external=true` | `q` 3–100 chars. `external=false` skips the sources, which the UI uses to show local results instantly. **Local:** own non-archived foods + shared cached foods, matched `name ilike` / `brand ilike` / `barcode =`, own first, limit 20. **External:** all sources in parallel (`ThreadPoolExecutor`, `shutdown(wait=False, cancel_futures=True)`), with OFF given `food_country` from settings (default `en:israel`). External results whose `(source, source_ref)` or barcode already appear locally are dropped. Failures are added to `sources_failed`. |
| `GET /foods/barcode/{code}` | `code` matches `^[0-9]{6,14}$`, else 422. Cached/own food by barcode → OFF → USDA. Found externally → **imported** (upserted), returning a `FoodOut` with an id. Otherwise 404 `{"detail": "Not found"}`. If sources failed and nothing was found, 503 `"Food database unavailable"`, so the UI can offer Retry. |
| `POST /foods/import` `{source, source_ref}` | `detail()` from that source → upsert into `foods` (`on conflict (source, source_ref) where user_id is null do update set name…, nutrients_per_100g…, servings…`) → `FoodOut`. 404 if the source returns `None`. |
| `GET /foods/{id}` | `visible_food`, else 404 |
| `GET /foods/mine` | Own custom foods (non-archived), ordered by name |
| `POST /foods` · `PATCH /foods/{id}` · `DELETE /foods/{id}` | Own `custom` foods only (PATCH/DELETE of a shared or other user's food → 404). **DELETE archives when `food_log` references the food, and deletes otherwise.** |

- [ ] **Step 1: Write failing tests `test_foods_api.py`**

Override `get_food_sources` with fakes in a fixture `sources`.
  - `test_search_returns_local_and_external`
  - `test_search_survives_failing_source`: the fake OFF has `fail=True` → 200, USDA results present, `sources_failed == ["off"]`.
  - `test_search_dedupes_cached_external`: import an item, search again, and it appears only in `local`.
  - `test_search_requires_three_chars`: 422.
  - `test_search_local_only`: `external=false` makes no source calls.
  - `test_search_hebrew_query`: the fake has a Hebrew-named product, and `q="במבה"` finds it locally after import and externally before.
  - `test_barcode_imports_then_hits_cache`: the second call makes no source call (count calls on the fake).
  - `test_barcode_not_found_404` · `test_barcode_sources_down_503` · `test_barcode_invalid_422`
  - `test_import_is_idempotent`: the same id twice, and one shared row.
  - `test_custom_food_per_serving_converted`: 30 g serving with 120 kcal → 400 kcal/100 g.
  - `test_custom_food_implausible_422`
  - `test_custom_food_isolation`: B cannot GET, PATCH or DELETE A's food (404), and it doesn't appear in B's search.
  - `test_cannot_patch_shared_food`: 404.
  - `test_delete_archives_when_logged`: insert a log row referencing the food directly via SQL, DELETE → 204, the row still exists with `archived=true`, and it's hidden from `/foods/mine` and search.

- [ ] **Step 2: Implement the service and router.** Register the router in `main.py`.

- [ ] **Step 3: Run the tests, the full suite, ruff and mypy. Commit** `feat(backend): add food search, barcode lookup, import and custom foods`

---

### Task 6: Food log API

**Files:**
- Create: `backend/app/routers/food_log.py`, `backend/tests/test_food_log_api.py`
- Modify: `backend/app/schemas.py`, `backend/app/main.py`

**Interfaces:**
- `Meal = Literal["breakfast","lunch","dinner","snack"]`
- `FoodLogIn`: `food_id: UUID`, `grams: float (0.1–5000)`, `serving_label: str | None`, `serving_count: float | None (0 < x ≤ 100)`, `meal`, `eaten_at: AwareDatetime`.
- `QuickAddIn`: `name: str = "Quick add"` (1–200), `nutrients: dict[str, float]` (validated `per_100g=False`, `energy_kcal` required, and only the `energy_kcal`, `protein_g`, `carbs_g`, `fat_g` keys allowed), `meal`, `eaten_at`.
- `FoodLogPatch`: `grams?`, `serving_label?`, `serving_count?`, `meal?`, `eaten_at?`, `nutrients?` (quick-add entries only).
- `FoodLogOut`: id, eaten_at, meal, food_id, name, grams, serving_label, serving_count, nutrients (rounded to 1 decimal for output only), meal_ref.
- `FoodDayOut`: `day: date`, `entries: list[FoodLogOut]` (ordered by `eaten_at`), `totals`, `coverage`, `target: TargetsOut | None` (the row with the greatest `effective_from ≤ day`).

| Route | Behaviour |
|---|---|
| `GET /food-log?day=YYYY-MM-DD` | `day_bounds(day, profile tz)` → entries in `[start, end)` → `day_totals`. Defaults to local today. |
| `POST /food-log` | `visible_food` else **404**. Snapshot = `scale(food.nutrients_per_100g, grams)`, `name` = food name. 201 → `FoodLogOut`. `eaten_at` not in the future (reuse `check_not_future`). |
| `POST /food-log/quick` | Snapshot = `nutrients`, `food_id` null, `grams` null. 201. |
| `PATCH /food-log/{id}` | If `grams` changes on a food entry: `scale_snapshot`. `nutrients` on a food entry → 422 ("Change the amount instead"). Own rows only. |
| `DELETE /food-log/{id}` | 204 / 404 |

- [ ] **Step 1: Write failing tests `test_food_log_api.py`**
  - `test_log_food_computes_snapshot`
  - `test_quick_add`
  - `test_quick_add_rejects_micros_keys`: 422.
  - `test_cannot_log_other_users_custom_food`: 404.
  - `test_can_log_shared_food`
  - `test_editing_food_does_not_change_logged_entry`: PATCH the custom food's nutrients, and the day view is unchanged.
  - `test_patch_grams_scales_snapshot`
  - `test_patch_nutrients_on_food_entry_422`
  - `test_day_view_uses_profile_timezone`: profile `Asia/Jerusalem`. An entry at `2026-02-28T23:40:00+02:00` is in day `2026-02-28`, not `03-01`. An entry at `2026-03-01T00:10:00+02:00` is in `03-01`.
  - `test_day_view_totals_and_coverage`
  - `test_day_view_target_in_force`: targets from 02-01 and 02-20. Day 02-19 gets the first, and 02-20 the second.
  - `test_future_eaten_at_422`
  - `test_log_isolation`: B cannot see, patch or delete A's entries.
  - `test_deleting_logged_food_keeps_entry`: delete A's custom food *after* logging it. The food is archived, and the entry still shows its name and nutrients with `food_id` still set.

- [ ] **Step 2: Implement. Step 3: Tests, ruff, mypy. Commit** `feat(backend): add food log with snapshots and day totals`

---

### Task 7: Nutrition settings, targets and initial estimate

**Files:**
- Create: `backend/app/routers/nutrition.py`, `backend/app/services/nutrition_service.py`, `backend/tests/test_nutrition_api.py`
- Modify: `backend/app/schemas.py`, `backend/app/main.py`

**Interfaces:**
- `NutritionSettingsIn`: fields and ranges as in the migration. `food_country` is limited to a `Literal` of a few tags (`en:israel`, `en:united-states`, `en:united-kingdom`, `en:world`). `en:world` disables re-ranking.
- `NutritionSettingsOut`: `NutritionSettingsIn` + `configured: bool`.
- `TargetsIn`: `effective_from: date`, `energy_kcal`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `origin` (manual/suggested), `tdee_at_creation?`.
- `EstimateOut`: `bmr`, `tdee`, `method: "katch" | "mifflin"`, `weight_kg`, `lean_mass_kg | None`, `targets: TargetsOut`.
- `nutrition_service.current_body(conn, user_id, profile, today) -> (weight_trend, lean_mass_trend | None)` uses `series_for(..., "weight_kg" / "lean_mass_kg", ..., "1M", today).latest`, so it stays consistent with the dashboard.

| Route | Behaviour |
|---|---|
| `GET /nutrition/settings` | The row, or the defaults with `configured: false` (never 404). |
| `PUT /nutrition/settings` | Upsert → `configured: true`. |
| `GET /nutrition/estimate?activity_level=&mode=&deficit_pct=&protein_g_per_kg=` | Pure preview. BMR (Katch when lean mass exists) × activity factor → `targets_from_tdee`. Needs a profile (else 409 "Complete your profile first") and at least one weigh-in (else 409 "Log a weigh-in first"). |
| `GET /nutrition/targets` | History, newest first. |
| `GET /nutrition/targets/current?day=` | In force on that day (default today), or `null`. |
| `POST /nutrition/targets` | Upsert on `(user_id, effective_from)`. `effective_from` must be ≤ today + 1 day. |

- [ ] **Step 1: Write failing tests**
  - `test_settings_defaults_unconfigured`
  - `test_settings_roundtrip`
  - `test_settings_validation`
  - `test_estimate_mifflin_without_body_fat`
  - `test_estimate_katch_with_body_fat`
  - `test_estimate_needs_weigh_in_409`
  - `test_targets_upsert_same_day`
  - `test_current_target_by_day`
  - `test_targets_isolation`

- [ ] **Step 2: Implement. Step 3: Tests, ruff, mypy. Commit** `feat(backend): add nutrition settings, targets and initial estimate`

---

### Task 8: Frontend types, nutrient registry and queries

**Files:**
- Create: `frontend/src/lib/nutrients.ts`, `frontend/src/lib/serving.ts`, `frontend/src/lib/meals.ts` and tests
- Modify: `frontend/src/lib/types.ts`, `frontend/src/lib/queries.ts`, `frontend/src/lib/queries.test.tsx`

**Interfaces:**
- `NUTRIENTS: {key, label, unit, kind}[]` in backend order, and `NutrientKey`.
- `types.ts`: `Food`, `FoodSearch`, `FoodLogEntry`, `FoodDay`, `Targets`, `NutritionSettings`, `Estimate`, `Meal`, `Serving`.
- `serving.ts`:
  - `SERVING_100G = { label: "100 g", grams: 100 }`
  - `servingsFor(food): Serving[]`: 100 g/ml first, then the food's servings.
  - `gramsFor(serving, count): number`, rounded to 0.1.
  - `nutrientsFor(food, grams): Record<NutrientKey, number>`, preview only; the server computes the snapshot.
- `meals.ts`:
  - `MEALS` (order and labels)
  - `defaultMeal(date: Date): Meal`: hours 4–10 breakfast, 11–15 lunch, 16–21 dinner, else snack.
  - `eatenAtFor(day: string, meal: Meal, now: Date): string`: if `day` is today, now. Otherwise that day at 08:00 / 13:00 / 19:00 / 16:00 local, per meal, as ISO.
- `queries.ts`:
  - `qk.foodDay(day)`, `qk.foodSearch(q)`, `qk.myFoods`, `qk.nutritionSettings`, `qk.targets`, `qk.estimate(params)`.
  - Hooks: `useFoodDay`, `useFoodSearch(q, enabled)` (`staleTime` 10 min), `useFoodByBarcode` (a mutation-style imperative fetch), `useImportFood`, `useMyFoods`, `useSaveCustomFood`, `useDeleteCustomFood`, `useLogFood`, `useQuickAdd`, `useUpdateLogEntry`, `useDeleteLogEntry`, `useNutritionSettings`, `useSaveNutritionSettings`, `useTargets`, `useSaveTargets`, `useEstimate`.
  - `invalidateNutrition(qc)` invalidates `["food-day"]`, plus `qk.dashboard` so Phase 3 is ready. Every log mutation calls it.

- [ ] **Step 1: Write failing tests**
  - `serving.test.ts`: `gramsFor({grams: 28}, 2.5) === 70`; 100 g always first; `nutrientsFor` drops unknown keys.
  - `meals.test.ts`: the boundary hours; `eatenAtFor` past day dinner → 19:00 local.
  - `queries.test.tsx`: the log mutation invalidates `food-day` and `dashboard`.
  - A registry parity test: `nutrients.test.ts` asserts the exact key list, and must be updated alongside the backend.

- [ ] **Step 2: Implement. Step 3: `npm test && npm run typecheck && npm run lint`. Commit** `feat(frontend): add nutrition types, registry and queries`

---

### Task 9: Navigation — Food tab, Photos into More

**Files:**
- Modify: `frontend/src/components/AppLayout.tsx`, `frontend/src/App.tsx`, `frontend/src/pages/More.tsx`, `frontend/src/pages/Home.tsx`, `frontend/src/pages/Home.test.tsx`
- Create: `frontend/src/pages/Food.tsx` (placeholder heading, filled in by Task 10), `frontend/src/components/AppLayout.test.tsx`

**Interfaces:**
- `NAV` becomes Home (`House`), Food (`Utensils`), Trends (`ChartLine`), More (`Ellipsis`), with Log in the middle of the mobile bar. The sidebar also lists Photos under Trends, since the wide screen has room.
- `More.tsx` LINKS gain, first: `{ to: "/photos", label: "Photos", body: "Progress photos and compare" }` and `{ to: "/nutrition", label: "Nutrition", body: "My foods, targets, settings" }`.
- Home: in the nudges area, a "Photos" link row. The existing "no photos in 4 weeks" nudge links to `/photos`.
- `LogTab` gains `"food"`.

- [ ] **Step 1: Write failing tests**
  - `AppLayout.test.tsx`: the mobile nav has the links Home, Food, Trends, More and the Log button, in that order.
  - Home test: the Photos shortcut links to `/photos`.

- [ ] **Step 2: Implement. Step 3: Test, typecheck, lint. Commit** `feat(frontend): add Food tab and move Photos into More`

---

### Task 10: Food day view

**Files:**
- Create:
  - `frontend/src/components/nutrition/DateStrip.tsx`
  - `frontend/src/components/nutrition/NutritionSummary.tsx`
  - `frontend/src/components/nutrition/MealSection.tsx`
  - `frontend/src/components/nutrition/EntrySheet.tsx`
  - `frontend/src/components/nutrition/FoodName.tsx`
  - tests for each
- Modify: `frontend/src/pages/Food.tsx` (+ `Food.test.tsx`)

**Behaviour (spec §5.1):**
- **Route:** `/food?day=YYYY-MM-DD`. The day lives in the URL, so back/forward and reloads keep it. Default is today.
- **`DateStrip`:** previous/next buttons and a label ("Today", "Yesterday", or `Tue 29 Sep`). Next is disabled on today. Left/right swipe on touch.
- **`NutritionSummary`:**
  - Calories: eaten / target / remaining as a horizontal bar. Over target shows "X over" in the warning colour.
  - Protein bar first and visually primary, then carbs and fat, each g / target.
  - With no target: numbers only, plus a "Set targets" link to `/nutrition/setup`.
  - Follow the dataviz skill for bar colours and labels. Read it before writing the component.
- **`MealSection`** (one per meal):
  - The header shows the meal name and kcal subtotal.
  - Rows show `FoodName`, amount (`2 × 1 slice` / `150 g` / `—` for quick-add) and kcal.
  - A "＋ Add" button opens the add-food sheet with that meal and day.
  - "Copy from…" and "Save as meal" are **Phase 2**. Don't render placeholders.
- **`EntrySheet`:**
  - Food entries edit serving and count, meal and time. Quick-add entries edit kcal and macros.
  - Delete with confirm.
  - Uses `Modal`.
- **`FoodName`:** `<span dir="auto">` plus a muted brand.
- **Empty day:** each meal shows "Nothing logged", and the summary shows 0 / target.
- **First visit:** if `useNutritionSettings().data.configured === false`, show a card "Set up nutrition targets" → `/nutrition/setup`. Logging is still allowed.

- [ ] **Step 1: Write failing tests**
  - `NutritionSummary` shows remaining and over-target, and has no target link when the target is null.
  - `MealSection` groups and subtotals; quick-add rows show "—".
  - `FoodName` sets `dir="auto"`.
  - `EntrySheet` changing count PATCHes `grams` = count × serving grams.
  - `Food.test.tsx`:
    - The day comes from the URL.
    - Next is disabled on today.
    - The setup card appears when unconfigured.

- [ ] **Step 2: Implement. Step 3: Test, typecheck, lint. Commit** `feat(frontend): add food day view with meals and daily summary`

---

### Task 11: Add-food sheet — search, detail, serving picker, quick add

**Files:**
- Create:
  - `frontend/src/components/nutrition/AddFood.tsx`
  - `frontend/src/components/nutrition/FoodDetail.tsx`
  - `frontend/src/components/nutrition/ServingPicker.tsx`
  - `frontend/src/components/nutrition/QuickAddForm.tsx`
  - tests for each
- Modify: `frontend/src/components/LogSheet.tsx`, `frontend/src/components/AppLayout.tsx` (`open(tab, {meal, day})`)

**Behaviour (spec §5.2):**
- **`AddFood({ day, meal, onDone })`:**
  - The search input autofocuses.
  - *My foods* (local results) render as soon as `q.length ≥ 3`.
  - *Database* (external) results are fetched on Enter, or 800 ms after the last keystroke. The fetch is the same request, since the backend returns both. The local section shows a spinner row for Database until it's done.
  - Local results come from `GET /foods/search?q=&external=false` (Task 5), so they render without waiting on the sources.
  - `sources_failed` → an inline notice, e.g. "Open Food Facts didn't respond; showing other results."
  - A tab switch at the top: **Search · Quick add**. The **Scan** button is Phase 2.
- **Selecting a result:** an external result without `id` → `useImportFood` → `FoodDetail`.
- **`FoodDetail`:**
  - Header shows `FoodName`, source badge (`Open Food Facts` links to `https://world.openfoodfacts.org/product/{barcode}` for the ODbL attribution, `USDA`, `My food`).
  - A `ServingPicker` (serving select + count input accepting a comma decimal, the same parser as `lib/forms`).
  - A live preview of kcal and P/C/F for the chosen amount.
  - Meal select (preset), time (defaults to `eatenAtFor(day, meal, now)`).
  - Actions: **Log**, and "Copy to my foods", which opens `CustomFoodForm` pre-filled and is wired in Task 12.
- **`QuickAddForm`:** label, kcal (required, 1–5000), optional P/C/F, meal, and **Add**.
- **`LogSheet`:** add a **Food** tab (first in the list) that renders `AddFood`. The ＋ button still defaults to Weigh-in. From the Food page, `open("food", { meal, day })`.

- [ ] **Step 1: Write failing tests**
  - `ServingPicker`: the grams value matches serving × count; a comma decimal works.
  - `AddFood`: local results appear without waiting; external results appear after Enter; the failure notice; picking an external result calls import and then shows detail.
  - `FoodDetail`: the preview updates with the amount; Log posts `{food_id, grams, serving_label, serving_count, meal, eaten_at}`; the OFF attribution link.
  - `QuickAddForm`: kcal is required; it posts only the filled macros.
  - `LogSheet`: the Food tab is present.

- [ ] **Step 2: Implement. Step 3: Test, typecheck, lint. Commit** `feat(frontend): add food search, detail with servings, and quick add`

---

### Task 12: My foods and the custom food form

**Files:**
- Create: `frontend/src/forms/CustomFoodForm.tsx`, `frontend/src/pages/MyFoods.tsx`, `frontend/src/pages/Nutrition.tsx` (the hub: My foods · Targets · Settings links), tests
- Modify: `frontend/src/App.tsx` (routes `/nutrition`, `/nutrition/foods`, `/nutrition/setup`, `/nutrition/targets`), `AddFood.tsx` ("Create food" when nothing is found)

**Behaviour:**
- **Form fields:** name, brand, barcode (digits only), liquid toggle.
- **Basis switch:** *per 100 g* / *per serving*, with serving label and grams.
- **Nutrients:** kcal (required), P, C, F, then "More nutrients ▾" revealing the rest from `NUTRIENTS`.
- **Extra named servings:** add/remove rows.
- **Validation:** zod mirrors the backend ranges. Server 422s map onto the fields, reusing the existing `ApiError.fieldErrors` handling.
- **Editing** shows "Changes apply to future logs; past days keep what was logged."
- **MyFoods:** a list with edit and delete. Delete confirms "It stays in past days."

- [ ] **Step 1: Failing tests** (form validation, per-serving submit payload, prefill from an OFF food, MyFoods delete). **Step 2: Implement. Step 3: Test, typecheck, lint. Commit** `feat(frontend): add custom foods`

---

### Task 13: Nutrition setup and targets

**Files:**
- Create: `frontend/src/pages/NutritionSetup.tsx`, `frontend/src/pages/Targets.tsx`, `frontend/src/forms/TargetsForm.tsx`, tests

**Behaviour:**
- **Setup, step 1:** mode (Recomp / Cut / Maintain / Lean bulk, each with a one-line explanation) and activity level.
- **Setup, step 2:** calls `useEstimate` and shows "BMR 1,790 (Katch-McArdle, from your lean mass) × 1.375 = 2,460 kcal". Then the pre-filled `TargetsForm` (kcal, P, C, F, fibre) with a live "macros add up to X kcal" check, warning when it's more than 5% off the kcal. Save does `PUT /nutrition/settings` then `POST /nutrition/targets` (`origin: "suggested"` if unchanged, else `"manual"`, `effective_from` today) → navigate to `/food`.
- **Targets page:**
  - The current targets and "Edit" (TargetsForm, which saves a new row effective today).
  - The history list.
  - A settings section: deficit %, protein g/kg, check-in day (read-only note "Weekly check-ins arrive in a later update"), food region.

- [ ] **Step 1: Failing tests** (estimate rendered, origin suggested vs manual, macro-sum warning, 409 "Log a weigh-in first" message). **Step 2: Implement. Step 3: Test, typecheck, lint. Commit** `feat(frontend): add nutrition setup and targets`

---

### Task 14: End-to-end, config and docs

**Files:**
- Create: `frontend/e2e/nutrition-1-core.spec.ts`
- Modify: `.github/workflows/ci.yml` (e2e: `FOOD_SOURCES=fake`), `render.yaml` (`USDA_API_KEY` sync: false, `OFF_USER_AGENT`, `FOOD_SOURCES=live`), `README.md` (env vars, USDA key signup, OFF attribution note)

**Flows:**
1. After onboarding and a weigh-in, set up nutrition (Recomp, Light) and accept the estimate. Food shows the targets.
2. Food → Breakfast ＋ Add → search "hummus" → Enter → pick "Demo hummus" (fake OFF) → 2 × serving → Log. The Breakfast subtotal and summary update.
3. Quick add 450 kcal to Dinner. The summary total includes it.
4. Create a custom food "Protein shake" per serving (30 g → 120 kcal, P 24), then log it. Edit the food's kcal. Yesterday/today's logged entry is unchanged.
5. Navigate to the previous day. It's empty, and next is enabled.

- [ ] **Step 1: Write the flows. Step 2: Run locally per README. Step 3: Push the branch and watch CI. Commit** `test(e2e): cover nutrition setup, search, quick add and custom foods`

**Phase 1 is done when** CI is green, the PR is reviewed, and it's deployed with `USDA_API_KEY` set on Render.

---

### Phase 1 implementation notes

Deviations from the steps above, made while building Phase 1:

- **Fixtures are hand-built** from the documented OFF and FDC response formats (Task 3). The build environment's network policy blocked both APIs. Before relying on live data, run `backend/scripts/record_food_fixtures.py` from a machine that can reach them, and fix any field name the live payloads disagree on.
- **Nutrition schemas** live in `app/nutrition_schemas.py`, not `app/schemas.py`, which was already long.
- **Custom food edits use `PUT /foods/{id}`** (full replacement), not PATCH. The form always sends every field.
- **Services:** `app/services/food_log_service.py` holds the day view and `target_on()`, which Phase 3's check-in and dashboard reuse.
- **Food editor routes:** `/nutrition/foods/new` (optionally prefilled from a database food via router state) and `/nutrition/foods/:id`.
- **E2E ordering:** the e2e spec relies on running after `flows.spec.ts` (files run in name order; same user, already onboarded, with a weigh-in).

## Phase 2 — Speed

Goal (spec §1 success criteria): re-logging a recent or favourite food takes under 10 s, a barcode lookup under 20 s, and copying yesterday's breakfast is one action.

### Decisions made while expanding Phase 2

- **No nested recipes in v1.** A recipe's ingredients may be foods of any source except `recipe` (422 "Recipes can't contain other recipes yet"). This removes cycle checks and stale parent recipes. It is revisited if it proves limiting. *(Deviation from spec §4.4 "depth 2".)*
- **Saved meals can hold quick adds.** A `saved_meal_items` row either has a `food_id` (nutrients recomputed from the food when logged, like any log) or a `nutrients` snapshot (a quick add). "Save as meal" from a day's meal therefore keeps everything that was logged.
- **Foods referenced anywhere are archived, not deleted.** Deleting a custom food archives it if `food_log`, `recipe_items` or `saved_meal_items` references it. The item FKs are `on delete restrict`, so a hard delete can never break a recipe or saved meal.
- **Copying keeps snapshots.** Copied entries keep their nutrient snapshots and local time of day. On the target day, an entry whose copied time would be in the future is moved to now. Every copy shares a new `meal_ref`.
- **Recent** = distinct foods by last `eaten_at` (limit 30, archived excluded), with the last amount used. The add sheet shows Recent and Favourites before anything is typed, and a **＋** on a recent row re-logs the last amount in one tap.
- **Barcode scanner:**
  - Native `BarcodeDetector` when it supports EAN/UPC formats.
  - Otherwise `zxing-wasm/reader`, lazy-loaded, with its `.wasm` bundled by Vite (served from our own origin, not a CDN).
  - A manual digits field is always shown.
  - Lookup 404 → "Not found. Create it?" (custom food form prefilled with the barcode). 503 → Retry.
- **Undo for a logged saved meal** is deferred: the entries can be deleted one by one. `meal_ref` is stored now so undo can be added later without a migration.

### Task 15: Migration `20261001000001_nutrition_speed.sql`

Tables:
- `food_favourites` (PK `(user_id, food_id)`)
- `recipes` (`name`, `servings` 0.25–100, `cooked_weight_g` 1–20000 null, `note` ≤ 500, `archived`)
- `recipe_items` (`recipe_id` cascade, `user_id`, `food_id` restrict, `grams` 0.1–5000, `position`)
- `saved_meals` (`name`)
- `saved_meal_items` (`saved_meal_id` cascade, `user_id`, `food_id` restrict null, `name`, `grams`, `serving_label`, `serving_count`, `nutrients` jsonb null, `position`, check `(food_id is null) = (nutrients is not null)`)

Constraints:
- `foods.recipe_id` gets an FK to `recipes` (`on delete cascade`).
- Check `(source = 'recipe') = (recipe_id is not null)`.

RLS own-rows and `updated_at` triggers on every new table.

Tests (`test_migrations_nutrition.py`):
- A favourite is hidden from other users.
- A saved meal item needs exactly one of food/nutrients.
- A recipe food needs `recipe_id`.
- A restricted FK blocks a hard delete of a referenced food.

### Task 16: Favourites and recent

- `PUT /favourites/{food_id}` (the food must be visible, else 404; idempotent, 204).
- `DELETE /favourites/{food_id}` (204).
- `GET /favourites` → `FoodOut[]` ordered by name, archived excluded.
- `GET /foods/recent` → `[{food: FoodOut, grams, serving_label, serving_count, last_eaten_at}]` via `distinct on (food_id) … order by food_id, eaten_at desc`, then sorted by `last_eaten_at desc`, limit 30.

Tests:
- Isolation.
- Other users' custom foods can't be favourited.
- Recent is ordered and deduplicated, carries the last serving, and excludes archived foods and quick adds.

### Task 17: Copy

`POST /food-log/copy {from_day, to_day, meal?, to_meal?}` → `FoodLogOut[]` (201).
- Entries from `from_day` (optionally only `meal`) are copied to `to_day` (as `to_meal` or the same meal).
- Snapshot and amount are verbatim.
- `eaten_at` = same local time on `to_day` in the profile timezone, clamped to now.
- Copying an empty day/meal returns 201 `[]`.
- `to_day` must not be in the future (422).

Tests:
- A whole day.
- One meal into another meal.
- Timezone correctness across a DST day.
- The future clamp.
- Isolation (only my entries are copied).

### Task 18: Recipes

`GET/POST /recipes`, `GET/PUT/DELETE /recipes/{id}`.
- **Request:** `{name, servings, cooked_weight_g?, note?, items: [{food_id, grams}]}` (1–50 items).
- **Ingredients:** each must be visible and not a recipe.
- **Save:** computes `nutrients_per_100g` = Σ scaled ingredient nutrients ÷ (cooked weight or Σ grams) × 100, keeping only nutrients every ingredient reports. It then upserts the backing `foods` row (`source='recipe'`, one serving = total weight ÷ servings).
- **Response `RecipeOut`:** the recipe fields, `food_id`, `items` (with name and scaled nutrients), `total_grams`, `per_serving`, `incomplete_nutrients`.
- **Delete:** archives the recipe and its food when either is referenced (log, other items), and hard-deletes otherwise.

Tests:
- The maths (with and without cooked weight).
- Incomplete nutrients.
- A nested recipe → 422.
- Another user's food → 404.
- Update recomputes.
- The recipe appears in search and logs like a food.
- Delete archive vs hard delete.
- Isolation.

### Task 19: Saved meals

`GET/POST /saved-meals`, `PUT/DELETE /saved-meals/{id}`.
- **Items:** `{food_id, grams, serving_label?, serving_count?}` or `{name, nutrients}` (quick). 1–30 items.
- **`POST /saved-meals/from-log {name, day, meal}`:** builds a saved meal from that meal's entries (food entries by reference, quick adds by snapshot). 422 if the meal is empty.
- **`POST /saved-meals/{id}/log {meal, eaten_at}`:** one log row per item, sharing a new `meal_ref`. Food items are scaled from the food's current nutrients.

Tests:
- Round trip.
- `from-log` keeps quick adds.
- Logging creates N entries with one `meal_ref`.
- Another user's meal → 404.
- A deleted (archived) food still logs from its row.

### Task 20: Barcode scanner (frontend)

`components/nutrition/BarcodeScanner.tsx` + `lib/barcode.ts`:
- `pickDetector()`: native if `BarcodeDetector.getSupportedFormats()` includes `ean_13`, else zxing. Lazy `import("zxing-wasm/reader")` with `prepareZXingModule` + a Vite `?url` wasm import.
- A camera loop (`getUserMedia({video: {facingMode: "environment"}})`, detect about every 200 ms, stop tracks on unmount).
- A manual digits field with a Look up button.
- Camera errors fall back to manual entry with a message.

`AddFood` gains a **Scan** button. Tests: detector selection, the manual path, and not-found → create-with-barcode.

### Task 21: Speed UI

- **AddFood default view** (empty query): Recent (with one-tap ＋), Favourites and Saved meals sections.
- **FoodDetail:** a favourite star and the initial serving taken from the recent entry.
- **MealSection:** "Copy from…" (a modal with day, default yesterday, and source meal, default this meal) and "Save as meal" (name prompt).
- **Food page:** a "Copy another day…" link under the meals.
- **Pages:** `/nutrition/recipes`, `/nutrition/recipes/new`, `/nutrition/recipes/:id` (builder with ingredient picker, grams, live per-serving totals and incomplete markers) and `/nutrition/meals` (list, view, delete). The Nutrition hub links to both.
- **E2E (`nutrition-2-speed.spec.ts`):** log to yesterday then copy yesterday's breakfast to today, build a recipe and log one serving, manual barcode entry of the demo hummus.

## Phase 3 — Insight

Goal (spec §1 success criteria): after about 3 weeks of reasonably complete logging, the app shows an adaptive TDEE (total daily energy expenditure) and suggests calorie and macro targets once a week, and targets change only when the user accepts. The weekly micronutrient view flags real gaps without treating missing data as zero. Nutrition joins Trends, Home and History.

### Decisions made while expanding Phase 3

- **The TDEE updates weekly, on the check-in day.**
  - The estimate is a sequence of weekly values, each computed at a check-in day (Sunday by default) from the 28 days ending there.
  - "Current TDEE" is the latest value, so the number the user sees is the one the suggestion uses. It doesn't change from day to day with water weight.
  - Changing the check-in day recomputes the whole sequence; nothing is stored (spec §6.3).
- **Eligible days** (spec §6.3 step 1):
  - at least one entry
  - not flagged incomplete
  - kcal ≥ 50% of the target in force that day, or of the initial estimate when no target existed yet.
  - The same rule picks which days count in micronutrient averages and nutrition series, so a half-logged day never drags an average down anywhere.
- **The weight change is measured on the EWMA weight trend** from sub-project 1 (α 0.1), taking the trend values at the last weigh-in on or before each window edge. If either edge has no weigh-in, that week has no observation, so the estimate keeps its previous value.
- **A suggestion is owed when** all of these hold:
  - the most recent check-in day ≤ today
  - the TDEE has real data, not just the initial guess
  - it wasn't dismissed for that check-in week
  - it differs meaningfully from the targets in force (|Δkcal| ≥ 50 or |Δprotein| ≥ 5 g).

  Accepting writes new targets (origin `suggested`, effective today). The suggestion then equals the targets, so the card disappears without any extra state.
- **Safety rails** (spec §6.4) apply to the kcal before the macros are worked out:
  - at most ±150 kcal per check-in
  - the floor of max(BMR, 1,500 kcal male / 1,200 female)
  - if the weight trend is falling more than 1% of body weight a week, kcal can't go below the current target, and a warning is shown.

  `targets_from_tdee` is split into `kcal_target()` and `macros_for(kcal)` so the cap sits between them.
- **Micronutrient references** are a fixed table by sex and age band (US Dietary Reference Intakes):
  - Sodium (2,300 mg) and saturated fat (10% of average kcal) are upper limits ("stay under").
  - Fibre's reference is the fibre target.
  - Sugar has no reference and shows the amount only.
  - Calories, protein, carbs and fat stay on the day summary and aren't repeated here.
- **Nutrition in Trends:**
  - **Metrics:** `energy_kcal`, `protein_g`, `carbs_g`, `fat_g` and `fiber_g` give a point per eligible day, with a **7-day rolling mean** as the trend (not EWMA, since intake isn't a noisy measurement of a slowly moving quantity). Weekly rate is not shown.
  - **`tdee_kcal`:** the weekly sequence, drawn as steps.
  - **Comparisons** stay as stacked panels, the existing pattern with no second y-axis. The one same-unit pair, intake vs expenditure, gets its own single-axis chart on the Targets page instead.
- **E2E without clock tricks:** the e2e sets `check_in_weekday` to today's weekday and seeds 21 days of logs and weigh-ins through the API with past timestamps, so the check-in card appears for real. No `FIXED_NOW` flag.

### Task 22: Migration `20261003000001_nutrition_insight.sql`

New tables:
- `nutrition_day_flags (user_id, day, excluded boolean not null default true, created_at, updated_at, primary key (user_id, day))`
- `target_suggestion_dismissals (user_id, week_start date, created_at, primary key (user_id, week_start))`

Both get RLS own-rows; `nutrition_day_flags` also gets the `updated_at` trigger. Tests: isolation for both, and one row per day/week.

### Task 23: Adaptive TDEE calculation (pure)

`app/calculations/tdee.py`:
- `eligible_days(day_kcal: dict[date, float], excluded: set[date], target_on: Callable[[date], float]) -> dict[date, float]`
- `check_in_days(first: date, today: date, weekday: int) -> list[date]`
- `observe(window_end, day_kcal, weight_trend: list[Point]) -> Observation | None`: 28-day window, ≥ 14 eligible days, ≥ 8 weigh-ins in the window, otherwise `None`.
- `adaptive_tdee(...) -> TdeeResult(weekly: list[WeekEstimate(day, observed, smoothed, eligible_days)], current, confidence, has_data, eligible_days_now)`
  - smoothing `w = 0.5 × eligible/28`, seeded with the initial TDEE (spec §6.2)
  - confidence = standard deviation of the last 4 observations (`None` below 4)

Tests:
- **Synthetic run:** 10 weeks at a true TDEE of 2,500 kcal, intake 2,200 ± 300 (seeded RNG), the weight drifting by energy balance (7,700 kcal/kg) plus ±0.6 kg water noise, and the initial guess deliberately off at 2,100. The estimate must be within ±50 kcal by week 6, and |Δ| must shrink week on week on average.
- Excluded days and half-logged days are ignored.
- Fewer than 14 eligible days → `has_data False`, and the current value equals the seed.
- A 2 kg one-day water spike moves the smoothed value by < 150 kcal.
- A missing weigh-in at a window edge → no observation.

### Task 24: Suggestion, check-in and day flags (API)

- **Pure function:** `suggest_targets(current: Targets | None, tdee, settings, weight_trend_kg, weekly_rate_kg, bmr, sex) -> Suggestion(targets, capped: bool, warning: str | None)`, with the rails above.
- **`GET /nutrition/tdee`:** the current value, confidence, `has_data`, eligible days in the last 28, and the weekly sequence (for the chart and Trends).
- **`GET /nutrition/suggestion`:** `{week_start, tdee, targets, current, capped, warning}`, or `null` when nothing is owed.
- **`POST /nutrition/suggestion/dismiss`** (current week): 204, idempotent.
- **`PUT /food-log/days/{day}/flag {excluded}`**, plus `excluded: bool` added to `FoodDayOut`.
- **`GET /food-log/days?from=&to=`** (at most 92 days): `[{day, energy_kcal, protein_g, entries, excluded}]` for the History Food tab.

Tests:
- every rail (±150 cap both ways, floor, the >1%/week guard and its warning)
- the "meaningfully different" threshold
- dismissed weeks
- accepting removes the card
- before the check-in day in a fresh week → the previous week's suggestion is still shown unless dismissed or accepted
- flags change eligibility and the TDEE
- isolation

### Task 25: Micronutrients

- `app/nutrient_reference.py`: the DRI table (source cited in a comment), plus `reference(sex, age, key, avg_kcal, fibre_target) -> (value, kind: "target" | "limit") | None`.
- **`GET /nutrition/micros?window=7|28`:**
  - `{days_counted, nutrients: [{key, average, reference, kind, coverage, status}]}`
  - `status` is one of `low`, `ok`, `over_limit`, `not_enough_data` (coverage < 0.6)
  - averages are over eligible days in the window; coverage is weighted by kcal across them

Tests:
- reference values by sex and age band
- the limit kinds
- coverage gating
- excluded days ignored
- no data → `days_counted 0`

### Task 26: Series and dashboard

- **Metrics registry:** gains `source: "nutrition"` and a `trend: "ewma" | "rolling7" | "step"` field. Nutrition metrics come from eligible-day totals; `tdee_kcal` from `adaptive_tdee`. `/series` handles both, and `weekly_rate` is `None` for nutrition.
- **`/dashboard` gains:**
  - `food_today {energy_kcal, protein_g, target_kcal, target_protein_g, entries}`
  - `check_in` (the suggestion summary, or `null`)
  - `nudges.no_food_today` (true after 14:00 local time with no entries)

Tests: series values and rolling mean, the step series, and the dashboard fields.

### Task 27: Insight UI

- **Check-in card** on Home (above the stats) and Food (above the summary):
  - "Your burn is about 2,540 kcal (±120). Suggested: 2,290 kcal · P 170 · C 245 · F 65"
  - **Accept**, **Edit** (prefilled `TargetsForm`, saved as manual) and **Not this week**
  - shows the warning or "Capped at 150 kcal this week" when it applies
- **Targets page:**
  - TDEE block with the estimate, the ± band and "Based on 19 logged days" / "9 of 14 days logged so far". Before there is data: "Using your starting estimate".
  - **Intake vs burn chart:** weekly average intake vs weekly TDEE on one axis, built per the dataviz skill.
  - The check-in day note from Phase 1 is removed.
- **Food page:**
  - tabs **Day · Nutrients**
  - the day menu gets **Mark day incomplete / complete**, with a badge on flagged days
  - Nutrients tab: 7/28-day toggle and a bar per nutrient against its reference; limits read "stay under"; low coverage is greyed out and labelled "not enough data", never "low"; "Averaged over N logged days"
- **Trends:** a new "Nutrition" metric group (Calories, Protein, Carbs, Fat, Fibre, Burn), with the rolling-mean line labelled "7-day average".
- **Home:**
  - a "Today's food" card (kcal and protein against targets) linking to Food
  - the after-14:00 "No food logged today" nudge opens the log sheet on Food
- **History:** a third tab, Food: the last 30 days with totals and incomplete flags; tapping a day opens `/food?day=`.

Tests for every component: card actions, the coverage greying, flag toggles, Trends groups, the Home card and nudge, and History rows.

### Task 28: E2E, docs and release

**`nutrition-3-insight.spec.ts`:**
- Seed 21 days through the API: weigh-ins every other day drifting −0.05 kg/day, and intake of about 2,100 kcal a day as quick adds.
- Set `check_in_weekday` to today's weekday.
- The check-in card appears → **Accept** → Targets shows the new targets and the TDEE block shows real data.
- Flag a day incomplete and see the badge.
- The Nutrients tab shows the "not enough data" state for vitamin D, since quick adds report only macros.

Also: the README gains a short section on how the TDEE works; the Phase 3 migration is applied to Supabase before merging (as with Phases 1 and 2); then the PR.

*Importing the Israeli Ministry of Health food database (Tzameret) was considered and declined (2026-10-03).*
