# BodyOS — Sub-project 2: Nutrition

- **Date:** 2026-09-30
- **Status:** Approved (review answers folded in, see §11)
- **Scope:** Second of four sub-projects. Delivers food logging (search, barcode, custom foods, recipes, saved meals, quick-add), a cached food database backed by Open Food Facts and USDA FoodData Central, macro and key-micronutrient tracking, adaptive TDEE, and weekly suggested targets that the user approves.
- **Builds on:** `2026-09-25-bodyos-foundation-body-tracking-design.md` (architecture, auth, timezone bucketing, EWMA trend, metric registry, dashboard).

## 1. Context and goals

The user is doing a **recomposition** (lose fat, keep or gain muscle). Sub-project 1 answers "what is my body doing?". Sub-project 2 answers "what am I eating, and how does it explain the body trend?". The adaptive TDEE ties the two together: logged intake plus the weight trend gives an energy expenditure estimate, and that estimate drives the calorie and protein targets.

### Success criteria

- Logging a food already in *Recent* or *Favourites* takes under 10 seconds. Logging a new packaged food by barcode takes under 20 seconds.
- Copying yesterday's breakfast is one action.
- After about 3 weeks of reasonably complete logging, the app shows an adaptive TDEE estimate and suggests calorie and macro targets. Targets change only when the user accepts a suggestion.
- The weekly micronutrient view flags nutrients that stay below reference intake, and shows how much of the logged food actually reported each nutrient.
- External food APIs failing or being slow never blocks logging of custom, recent, favourite or already-cached foods.
- Still free tiers only. The USDA API key stays server-side.

### Non-goals (this sub-project)

- **Photo-based food logging and AI meal plans.** These move to sub-project 3 (AI).
- Workouts, and activity-adjusted calorie targets. The adaptive TDEE absorbs activity implicitly.
- Water and supplements (listed under Extras in sub-project 4).
- Full micronutrient panel (30+ nutrients). v1 tracks a fixed set of 18 (§4.1).
- Offline logging, sharing, and multi-user features.
- Editing the shared external food cache. Users fix bad external data by copying the food into a custom food.
- Imperial or household-unit conversion beyond each food's own named servings.

## 2. Decisions

| Topic | Decision |
|---|---|
| Food data | Open Food Facts (OFF) for barcodes and packaged foods. USDA FoodData Central (FDC) for generic foods (Foundation, SR Legacy, Survey/FNDDS). Both are proxied and normalised by FastAPI. |
| Caching | An external food is copied into our `foods` table the first time it is opened or logged. Search results are not stored. |
| Nutrients | kcal, protein, carbs, fat, fibre, sugar, saturated fat, sodium, plus 10 key micros (§4.1). |
| Quantities | Everything is stored in grams. Liquids that OFF reports per 100 ml are treated as 1 ml = 1 g, and the UI keeps showing "ml". |
| History stability | Each log entry stores a **snapshot** of its nutrients. Editing a custom food or recipe never rewrites past days. |
| Barcode scanning | Native `BarcodeDetector` where the browser supports it. Otherwise `zxing-wasm` (iOS Safari has no `BarcodeDetector`). Typing the digits is always available. |
| Targets | Adaptive TDEE → weekly *suggested* targets → the user accepts or edits them. Nothing changes silently. |
| Micros reference | Fixed reference intakes by sex and age (RDA/AI) in code. Not user-editable in v1. |
| Food region | Israel. OFF search is one worldwide query whose results are re-ranked so products sold in Israel (`countries_tags` contains `en:israel`) come first. Hebrew queries and Hebrew product names are supported; names render with `dir="auto"` |
| Dependencies | Backend stays standard-library for maths. `httpx` (already a dependency) calls OFF and FDC. Frontend adds `zxing-wasm`. |

## 3. Architecture changes

```
React PWA ──JWT──▶ FastAPI ──▶ Supabase Postgres (foods cache, logs, targets)
                      │
                      ├──▶ Open Food Facts   (search, barcode; no key; User-Agent required)
                      └──▶ USDA FDC          (search, details; USDA_API_KEY)
```

- New backend module `app/food_sources/` with `off.py`, `fdc.py` and a shared `normalise.py`. They map each source's payload into one `FoodDraft` shape (name, brand, barcode, per-100 g nutrients, servings). The module sits behind a `FoodSource` protocol so tests use a fake, the same pattern as `PhotoStorage`.
- **OFF rate limits** (about 10 search requests per minute and 100 product reads per minute per IP): one OFF call per submitted search, never per keystroke, and an in-memory TTL cache (10 min) for search and barcode responses. The implementation plan re-checks the current limits.
- External calls use an 8 s timeout. A failure returns partial results with a `sources_failed` list, and the UI shows "USDA unavailable, showing other results". No retries on the request path.
- New env vars: `USDA_API_KEY` (in development, `DEMO_KEY` works at low rate limits) and `OFF_USER_AGENT` (for example `BodyOS/0.2 (contact email)`), as OFF requires.
- OFF data is ODbL-licensed. The food detail screen shows the source and an "Open Food Facts" attribution link. USDA data is public domain.

## 4. Data model

The same conventions as sub-project 1 apply: uuid ids, `created_at`/`updated_at` with the `set_updated_at` trigger, RLS on every table, text + check instead of enums, and derived values computed rather than stored. The one deliberate exception is log snapshots (§2).

### 4.1 Nutrient registry (backend `nutrients.py`, mirrored in frontend `lib/nutrients.ts`)

| Key | Unit | USDA nutrient # | OFF field |
|---|---|---|---|
| `energy_kcal` | kcal | 1008 (fallback: Atwater 2047/2048) | `energy-kcal_100g` (fallback: kJ ÷ 4.184) |
| `protein_g` | g | 1003 | `proteins_100g` |
| `carbs_g` | g | 1005 | `carbohydrates_100g` |
| `fat_g` | g | 1004 | `fat_100g` |
| `fiber_g` | g | 1079 | `fiber_100g` |
| `sugar_g` | g | 2000 | `sugars_100g` |
| `sat_fat_g` | g | 1258 | `saturated-fat_100g` |
| `sodium_mg` | mg | 1093 | `sodium_100g` × 1000 |
| `potassium_mg` | mg | 1092 | `potassium_100g` × 1000 |
| `calcium_mg` | mg | 1087 | `calcium_100g` × 1000 |
| `iron_mg` | mg | 1089 | `iron_100g` × 1000 |
| `magnesium_mg` | mg | 1090 | `magnesium_100g` × 1000 |
| `zinc_mg` | mg | 1095 | `zinc_100g` × 1000 |
| `vit_d_mcg` | µg | 1114 | `vitamin-d_100g` × 1e6 |
| `vit_b12_mcg` | µg | 1178 | `vitamin-b12_100g` × 1e6 |
| `vit_c_mg` | mg | 1162 | `vitamin-c_100g` × 1000 |
| `vit_a_mcg` (RAE) | µg | 1106 | `vitamin-a_100g` × 1e6 |
| `folate_mcg` (DFE) | µg | 1190 | `folates_100g` × 1e6 |

Nutrients are stored as `jsonb` objects keyed by registry key. A **missing key means "unknown", not zero**. This matters for micros, because most packaged foods report none. Pydantic validates the keys, and that every value is ≥ 0 and plausible per 100 g (for example kcal ≤ 900, macros ≤ 100 g).

The implementation plan verifies the exact USDA numbers and OFF field names against live responses and records fixtures.

### 4.2 `foods`

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid, **nullable** | `null` = shared cached external food; set = the user's custom food or recipe |
| `source` | text | `off` / `usda` / `custom` / `recipe` |
| `source_ref` | text | OFF barcode or FDC id. Unique per `(source, source_ref)` for external foods |
| `barcode` | text | Indexed. Also allowed on custom foods |
| `name`, `brand` | text | Name required, ≤ 200 chars |
| `nutrients_per_100g` | jsonb | §4.1 |
| `servings` | jsonb | `[{label, grams}]`, for example `[{"label":"1 slice","grams":28}]`. "100 g" is always implied |
| `is_liquid` | boolean | Display in ml |
| `recipe_id` | uuid null | Set when `source = 'recipe'` |
| `archived` | boolean | Hidden from search but still referenced by history |

RLS: select where `user_id is null or user_id = auth.uid()`; insert/update/delete only own rows. Only the backend writes shared rows.

### 4.3 `food_log`

| Column | Type | Notes |
|---|---|---|
| `eaten_at` | timestamptz | Bucketed into days in the profile timezone (same rule as body entries) |
| `meal` | text | `breakfast` / `lunch` / `dinner` / `snack` |
| `food_id` | uuid null | `null` for quick-add. `on delete set null`, because the snapshot keeps history intact |
| `name` | text | Snapshot of the food name, or the quick-add label |
| `grams` | numeric(7,1) | null for quick-add. 0.1–5000 |
| `serving_label`, `serving_count` | text, numeric | What the user picked, so edits reopen with "2 × 1 slice" |
| `nutrients` | jsonb | **Totals for this entry** (snapshot), not per 100 g |
| `meal_ref` | uuid null | Groups entries logged from one saved meal, for "undo meal" |

Index `(user_id, eaten_at)`.

### 4.4 Recipes and saved meals

- **`recipes`**: `name`, `servings` (≥ 1), `cooked_weight_g` (optional; when set, per-100 g values are based on cooked weight), `note`.
- **`recipe_items`**: `recipe_id`, `food_id`, `grams`, `position`.
- Saving a recipe recomputes its backing `foods` row (source `recipe`, per-100 g nutrients, serving `1 serving = total_g / servings`). The recipe can then be searched and logged like any food. A nutrient counts as known for the recipe only if every ingredient reports it. Otherwise it is marked "incomplete" (§6.5).
- **`saved_meals`** and **`saved_meal_items`** (`food_id`, `grams`, `serving_label`, `serving_count`, `position`). Logging a saved meal expands into one `food_log` row per item, sharing a `meal_ref`. The rows can then be edited individually.
- A recipe cannot contain itself (checked when saved). Recipes can use other recipes up to depth 2.

### 4.5 Favourites and recent

- **`food_favourites`**: `(user_id, food_id)` primary key.
- *Recent* is derived from `food_log`: distinct `food_id` ordered by last use, limit 30. It also returns the last-used serving so re-logging is one tap.

### 4.6 Targets and nutrition settings

- **`nutrition_settings`** (one row per user):
  - `mode`: `recomp` / `cut` / `maintain` / `lean_bulk`. Default `recomp`.
  - `deficit_pct`: default 10. Range −10 (surplus) to 25.
  - `protein_g_per_kg`: default 2.0 g per kg of **body weight** (trend). Range 1.4–3.0.
  - `activity_level`: `sedentary` / `light` / `moderate` / `very`. Used only for the initial TDEE guess.
  - `check_in_weekday`: 0–6 (Python `weekday()`, Monday = 0), default 6 (**Sunday**).
  - `food_country`: OFF country tag used to rank search results, default `en:israel`.
- **`nutrition_targets`**:
  - Columns: `effective_from` (date), `energy_kcal`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `origin` (`manual` / `suggested`), `tdee_at_creation`.
  - The history is kept, so past days are judged against the target in force on that day.
  - One row per `(user_id, effective_from)`.
- **`nutrition_day_flags`**: `(user_id, day)` with `excluded boolean`. The user marks a day "incomplete / don't use for TDEE", for example after a restaurant meal they didn't log.
- **`target_suggestion_dismissals`**: `(user_id, week_start)`, so a dismissed suggestion doesn't nag again that week.

## 5. Screens

### Navigation

Bottom nav becomes `Home` · `Food` · **`＋`** · `Trends` · `More`. Photos moves into More, and Home gets a "Photos" shortcut in its nudge area. The sidebar on wide screens lists all of them.

### 5.1 Food (day view), the main new screen

- A date strip (swipe or arrows, today by default) at the top.
- **Summary card:** calories eaten / target / remaining, shown as a bar, not a ring (following the dataviz skill). Protein, carbs and fat bars with grams / target. Protein is visually primary, because it is the recomposition lever.
- **Meal sections** (Breakfast / Lunch / Dinner / Snacks): entries with name, amount and kcal, plus per-section kcal. Each section has **＋ Add**, **Copy from…** (yesterday by default, or pick a date) and **Save as meal**.
- The day menu offers **Mark day incomplete** (excludes it from TDEE, §6.3) and **Copy whole day**.
- Tapping an entry opens the edit sheet (amount, serving, meal, time) or deletes it.

### 5.2 Add food sheet (opened from ＋ Log → Food, or a meal's ＋ Add)

- A search field with results grouped **Recent · Favourites · My foods & recipes · Database**. Local results appear instantly. Database results (OFF + USDA) load underneath when the user presses Enter or pauses typing for 800 ms, with a minimum of 3 characters.
- A **Scan** button opens the camera barcode scanner. The flow is: known barcode → food detail. Unknown barcode → "Not found. Create it?", pre-filled with the barcode.
- A **Quick add** tab: label (optional), kcal, and optional protein, carbs and fat.
- **Food detail:** serving picker (named servings, grams or ml, count), a live nutrient preview for the chosen amount, meal and time, a favourite toggle, and **Log**. There is also a "Copy to my foods" action to fix bad external data.

### 5.3 My foods, recipes, meals (under More → Nutrition)

- Custom food form: name, brand, barcode, and nutrients per 100 g **or per serving**. Per-serving values are converted to per 100 g on save.
- Recipe builder: add ingredients via the same search, set servings and optional cooked weight, see live per-serving totals and incomplete-nutrient markers.
- Saved meals: list, edit and delete.

### 5.4 Targets and check-in (More → Nutrition → Targets)

- Shows the current targets, the TDEE estimate with a confidence label, and the logging-completeness figure used.
- **Weekly check-in card** on Home and Food, on or after the check-in weekday when a suggestion differs meaningfully (§6.4):
  - "Your expenditure is estimated at 2,540 kcal (±120). Suggested: 2,290 kcal · P 165 · C 230 · F 75."
  - Actions: **Accept**, **Edit** (opens the prefilled form, saved as `manual`), **Dismiss for this week**.
- The settings form covers mode, deficit %, protein per kg body weight, check-in day and food country.
- **First-time setup** (the first visit to Food): mode, activity level, then initial targets from BMR × activity factor (§6.2). The user can edit them before saving.

### 5.5 Micronutrients (Food → "Nutrients" tab)

- Window 7 days (switchable to 28). Each of the 18 nutrients shows the daily average versus the reference intake as a percentage bar, plus **coverage**: the share of logged kcal from foods that report that nutrient. Low coverage (< 60%) greys the bar and shows "not enough data" instead of a misleading "low".
- Sodium and saturated fat are upper limits and are styled as "stay under".

### 5.6 Home and Trends integration

- **Home:** a new "Today's food" card (kcal and protein vs target), plus the check-in card when one is due. The nudge "no food logged today" appears after 14:00 local time.
- **Trends:** new metrics:
  - `energy_kcal`, `protein_g`, `carbs_g`, `fat_g` and `fiber_g` as daily totals, with a 7-day mean line as the "trend".
  - `tdee_kcal` as a derived daily series.
  - A new default **overlay preset: "Intake vs expenditure"** (energy_kcal vs tdee_kcal on one axis) next to the existing fat mass vs lean mass overlay. A second preset is **"Intake vs weight trend"**.
- **History:** a new "Food" tab listing past days with their totals.

## 6. Calculations (pure Python, `app/calculations/nutrition.py`)

### 6.1 Entry nutrients

- `entry = per_100g × grams / 100`, rounded at display only.
- Quick-add entries store only what was entered.
- Daily totals sum known values per nutrient and track **coverage** (kcal from entries that report the nutrient ÷ total kcal).

### 6.2 BMR and initial TDEE

- **BMR:** Katch-McArdle `370 + 21.6 × lean_mass_kg` when a body-fat trend exists. Otherwise Mifflin-St Jeor: `10w + 6.25h − 5a + 5` (male) or `… − 161` (female). Weight and lean mass come from their **trend** values in sub-project 1.
- **Initial TDEE** = BMR × activity factor: sedentary 1.2, light 1.375, moderate 1.55, very 1.725.

### 6.3 Adaptive TDEE (energy balance)

For a window of the last **28 days**:

1. **Eligible days:** at least one food entry, not flagged `excluded`, and daily kcal ≥ 0.5 × current target. The last condition catches days that were obviously only half-logged.
2. `mean_intake` = mean kcal over eligible days.
3. `Δweight` = weight **trend** (EWMA from sub-project 1) at window end − at window start. `days` = window length.
4. `observed_tdee = mean_intake − (Δweight × 7700) / days`.
5. **Enough data** means ≥ 14 eligible days *and* the weight trend has ≥ 8 readings in the window. Otherwise the estimate is labelled `insufficient_data` and the app keeps the prior.
6. **Smoothing** against noise and water-weight swings, computed as a weekly sequence from the first logged week (deterministic, recomputed on demand, never stored): `tdee_k = tdee_{k−1} + w × (observed_k − tdee_{k−1})`, with `w = 0.5 × eligible_days/28`. The sequence is seeded with the initial TDEE (§6.2).
7. **Confidence band** = ± the standard deviation of the last 4 weekly observed values (shown when ≥ 4 weeks exist).
8. **The daily `tdee_kcal` series** for Trends is the smoothed weekly estimate, carried across that week's days.

7700 kcal/kg is the usual whole-body approximation. A composition-aware version (fat ≈ 9,400 kcal/kg, lean ≈ 1,800 kcal/kg) is attractive for a recomposition, but consumer BIA body fat is too noisy week to week. It is a candidate for sub-project 4 correlation work, not v1.

### 6.4 Suggested targets

From the current smoothed TDEE `T`, mode and settings:

- **kcal** = `T × (1 − deficit_pct/100)`, with the mode's default deficit (recomp 10%, cut 20%, maintain 0%, lean bulk −7%) unless the user overrides it.
- **Protein** = `protein_g_per_kg × weight_trend` (default 2.0 g/kg).
- **Fat** = `max(0.25 × kcal / 9, 0.6 × weight_trend)`.
- **Carbs** = `(kcal − 4·protein − 9·fat) / 4`. If this is negative, lower the protein to 1.6 g/kg and recompute. If still negative, cap the deficit.
- **Fibre** = `14 g per 1000 kcal`.
- **Safety rails:**
  - kcal ≥ `max(BMR, 1500 male / 1200 female)`.
  - A single check-in never moves kcal by more than **±150** from the current target.
  - If the weight trend fell by > 1% of body weight per week over the window, the suggestion shows a warning and does not deepen the deficit.
- **"Meaningfully different"** means |Δkcal| ≥ 50 or |Δprotein| ≥ 5 g. A smaller difference triggers no check-in card.

All numbers round to 10 kcal and 5 g.

### 6.5 Recipes

Per-100 g value = Σ ingredient nutrients ÷ (`cooked_weight_g` or Σ ingredient grams) × 100. A nutrient missing from any ingredient is left out of the recipe and listed in `incomplete_nutrients`.

### 6.6 Micronutrient reference intakes

A table keyed by sex and age band (19–30, 31–50, 51–70, 71+) from the US DRIs (RDA, or AI where no RDA exists). Sodium uses 2,300 mg as the upper target and saturated fat uses 10% of kcal. The source is cited in a code comment.

## 7. API

| Method & path | Purpose |
|---|---|
| `GET /foods/search?q=&sources=` | Local (own, recipes, favourites, cached) + OFF (products sold in Israel ranked first) + FDC, merged and de-duplicated by barcode. Returns `sources_failed` |
| `GET /foods/barcode/{code}` | Cache → OFF → FDC branded (`gtinUpc`). 404 if not found |
| `GET /foods/{id}` · `POST /foods/import` `{source, source_ref}` | Detail / cache an external result and return its id |
| `POST/PATCH/DELETE /foods` (custom) | CRUD for own foods. Delete archives a food if the log references it |
| `GET/POST/PATCH/DELETE /recipes` | CRUD. Save recomputes the backing food |
| `GET/POST/PATCH/DELETE /saved-meals` · `POST /saved-meals/{id}/log` | CRUD / expand into log entries |
| `GET/PUT/DELETE /favourites/{food_id}` · `GET /foods/recent` | Favourites and recent list |
| `GET /food-log?day=` · `POST/PATCH/DELETE /food-log` | Day entries + totals + target for that day; CRUD. POST computes the snapshot server-side from `food_id` + grams |
| `POST /food-log/copy` `{from_day, to_day, meal?}` | Copy a day or a meal |
| `PUT /food-log/days/{day}/flag` | Mark a day excluded / included |
| `GET/PUT /nutrition/settings` | Settings |
| `GET/POST /nutrition/targets` | History / create (manual or accepted suggestion) |
| `GET /nutrition/tdee` | Current estimate, confidence, eligible days, weekly sequence |
| `GET /nutrition/suggestion` · `POST /nutrition/suggestion/dismiss` | Current suggestion (or none) / dismiss for this week |
| `GET /nutrition/micros?window=7\|28` | Averages, reference, coverage |
| `GET /series?metric=energy_kcal…` | Existing endpoint, extended with the nutrition metrics |
| `GET /dashboard` | Extended with `food_today` and `check_in` |

Log mutations invalidate the `foodDay`, `dashboard`, `series`, `tdee`, `suggestion` and `micros` query keys on the client.

## 8. Error handling (additions)

| Situation | Behaviour |
|---|---|
| OFF or FDC down or slow | Local results shown immediately, banner names the failed source. Barcode lookup falls back to "not found, create it?" with a "retry" link |
| Incomplete or odd external data (kcal missing, macros > 100 g) | kcal is derived from macros (4/4/9) when missing. An implausible food is excluded from search and cannot be imported |
| Camera permission denied or no camera | The scanner shows manual barcode entry |
| Editing a food after logging it | Past entries keep their snapshot. The food form says "changes apply to future logs" |
| Target missing on a day | Totals are shown without a comparison. The first visit to Food starts setup |
| TDEE not ready yet | The card shows progress ("9 of 14 logged days") and uses the initial estimate |

## 9. Testing

- **Backend unit tests:**
  - Nutrient scaling and totals.
  - Unknown vs zero handling and coverage.
  - OFF and FDC normalisers against recorded JSON fixtures, including the kJ-only, per-100 ml and missing-kcal cases.
  - Recipe maths, including cooked weight and incomplete nutrients.
  - BMR formulas.
  - Adaptive TDEE: a synthetic scenario where a known true TDEE is recovered within ±50 kcal, excluded days, half-logged days, insufficient data, and a water-weight spike damped by smoothing.
  - Every suggestion rule and safety rail.
  - Timezone bucketing of late-night meals.
- **API tests** (real Postgres):
  - CRUD and isolation for every new table: user A cannot read B's custom foods, recipes, log or targets. Shared cached foods are readable by both and writable by neither.
  - Snapshot stability after a food edit.
  - Copy day and meal.
  - Saved meal expansion.
  - Search with a failing source.
- **Frontend (Vitest + RTL):** serving picker maths, add-food sheet grouping, quick add, day view totals, check-in accept/edit/dismiss, the micros coverage greying, and barcode scanner fallback to manual entry.
- **E2E (Playwright, external sources faked by a backend test flag):** search → log → day totals and Home card update. Scan flow via manual barcode entry. Copy yesterday's breakfast. Create a recipe and log one serving.

## 10. Delivery phases

Each phase is one PR, and each is usable on its own:

1. **Core logging:** schema, nutrient registry, OFF/FDC proxies + cache, custom foods, food log CRUD, day view, add-food sheet with search and quick-add, manual targets, and the Food tab plus nav change.
2. **Speed:** barcode scanner, recent, favourites, copy day/meal, saved meals, recipes.
3. **Insight:** adaptive TDEE, suggested targets + weekly check-in, micronutrients view, and the Trends, Home and History integration.

## 11. Review decisions (2026-09-30)

1. **Nav:** Photos moves into More; Food gets the bottom-nav tab.
2. **Recomp deficit:** 10% below TDEE.
3. **Protein:** 2.0 g per kg of body weight (weight trend). *Read as body weight, not lean mass; this is a one-number change in `nutrition_settings` if you meant per kg lean mass.*
4. **Check-in day:** Sunday.
5. **Food region:** Israel. OFF results sold in Israel rank first, and Hebrew product names are first-class.
