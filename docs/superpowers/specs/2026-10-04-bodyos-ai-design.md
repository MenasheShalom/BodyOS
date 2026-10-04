# BodyOS — Sub-project 3: AI

- **Date:** 2026-10-04
- **Status:** Draft, awaiting review
- **Scope:** Third of four sub-projects. Delivers a provider-neutral AI layer and four features built on it:
  - food logging from a photo
  - a weekly written report
  - a rough body-fat estimate from progress photos
  - meal plans and recipes built from the groceries you have
- **Builds on:** the sub-project 1 spec (photos, metric registry, trends) and the sub-project 2 spec (food sources, food log snapshots, recipes, saved meals, adaptive TDEE, targets).

## 1. Context and goals

Sub-projects 1 and 2 turn logging into numbers. This one uses a multimodal model in three ways:
- to make logging faster (photo of a meal),
- to explain the numbers in words (weekly report),
- to plan ahead (meal plans and recipes that hit the targets).

The owner hasn't settled on an AI vendor, so nothing outside one adapter module may depend on a particular vendor.

### Success criteria

- Switching between Anthropic (Claude) and Google (Gemini) is a config change only (`AI_PROVIDER`, `AI_MODEL`, key). No code changes and no data migration.
- **Food photo:** a photo of a plate gives an editable list of items with grams and nutrients in under 15 s. Nothing is logged until the user confirms.
- **Weekly report:** every number in the report comes from the app's own calculations, never from the model.
- **Body-fat estimate:** a range (for example 17–21%) plus a midpoint, labelled as rough and kept separate from the scale and tape readings.
- **Meal plans and recipes:** totals are computed from real food-database nutrients, not the model's guesses, and each one saves as a saved meal or recipe.
- **Spending:** a monthly request cap bounds the cost. With AI switched off, the app works exactly as it does today.

### Non-goals (this sub-project)

- Chat or a free-form "ask anything" assistant.
- The model writing to the database on its own. Every AI output is a draft that the user reviews.
- Storing food photos. They are sent to the model and discarded.
- Automatic AI runs on body photos (privacy decision, §11).
- Fine-tuning, embeddings, or local models.
- Workouts and health-platform import (sub-project 4).

## 2. Decisions

| Topic | Decision |
|---|---|
| Providers | `AI_PROVIDER` = `none` (default) \| `anthropic` \| `google` \| `fake`. Each is an adapter behind one `AIProvider` protocol. `fake` returns deterministic canned answers for tests and e2e. |
| SDKs | Anthropic: official `anthropic` Python SDK. Google: official `google-genai` SDK. Both are imported lazily inside their adapter, so neither is needed when the other is in use. |
| Model | `AI_MODEL` overrides the per-provider default. Anthropic defaults to `claude-opus-5-5`. Google has no built-in default because Gemini model names change often: `AI_MODEL` is required (any current Gemini model with image input and JSON-schema output, for example a Flash model), and startup fails with a clear message if it's missing. |
| Effort | `AI_EFFORT` (`low`/`medium`/`high`, default `medium`) maps to Anthropic's `output_config.effort` and Gemini's thinking level, where the model supports one. |
| Output format | Every call asks for **structured JSON** against a Pydantic schema, using each provider's native schema-constrained output. The backend validates the result again and rejects it if it is invalid. There is no free-text parsing. |
| Images | The client downsizes to at most 1280 px on the long edge as JPEG (q 0.8) before upload. Food photos go straight from the request to the model. Progress photos are read from private storage by the backend. |
| Privacy | AI is never called on body photos without an explicit tap. The first use of each feature shows a one-time notice naming the provider. Food photos are not stored. Users can turn AI features off in Settings, which hides them. |
| Cost control | `AI_MONTHLY_REQUEST_LIMIT` (default 300) per user per calendar month. Every call is recorded in `ai_usage` (feature, provider, model, tokens, latency, ok/error). Over the limit, the API returns 429 and the UI says when the limit resets. |
| Numbers vs words | The model estimates only what has no other source: food in a photo, body fat from a picture, and meal ideas. Totals, trends, adherence and projections come from existing calculations, and the report text is written from those facts. |
| Language | English UI and prompts. Food names in other languages (Hebrew) are kept as given, and the model is told to keep the user's language for names. |

## 3. Architecture changes

```
React PWA ──JWT──▶ FastAPI ──▶ Supabase Postgres (ai_usage, ai_reports, ai_body_fat_estimates, …)
                      │
                      ├──▶ Supabase Storage (progress photos, read server-side for estimates)
                      └──▶ AIProvider ─┬─ AnthropicProvider (anthropic SDK)
                                       ├─ GoogleProvider    (google-genai SDK)
                                       └─ FakeProvider      (tests, e2e)
```

- **New package `app/ai/`:**
  - `provider.py`: the protocol, plus the `AIRequest` / `AIImage` / `AIResult` types.
  - `anthropic.py`, `google.py`, `fake.py`: the adapters.
  - `budget.py`: the usage cap and recording.
  - `prompts/`: one module per feature, each holding its system prompt and output schema.
- **Protocol:** one method, `generate(request) -> AIResult`.
  - `AIRequest` carries the system prompt, the user text, images (bytes + media type), the output schema (a Pydantic model) and a max output size.
  - `AIResult` returns the validated object plus usage (input/output tokens), model and latency.
  - Adapters translate provider errors into four types: `AIUnavailable` (network, 5xx, 429 from the provider), `AIRefused` (safety refusal), `AIInvalidOutput` (schema mismatch after one retry) and `AIConfigError`.
- **Timeouts:** each call times out after 60 s, with one retry on `AIInvalidOutput` only. Calls run on the request path, since each is a single round trip, with a "thinking…" state in the UI.
- **New env vars:**
  - `AI_PROVIDER`, `AI_MODEL`, `AI_MONTHLY_REQUEST_LIMIT`
  - `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY`, depending on the provider
  - Keys stay server-side.
- **`GET /ai/status`** returns `{enabled, provider, model, used_this_month, limit, resets_on}`. The frontend uses it to show or hide every AI entry point.

## 4. Data model

The same conventions as before apply: uuid ids, timestamps with the `set_updated_at` trigger, RLS own-rows on every table, and text + check instead of enums.

### 4.1 `ai_usage` (Phase 1)

| Column | Notes |
|---|---|
| `id`, `user_id`, `created_at` | |
| `feature` | `food_photo`, `weekly_report`, `body_fat`, `meal_plan` or `recipe_from_groceries` |
| `provider`, `model` | text |
| `input_tokens`, `output_tokens` | int, nullable (not every error reports them) |
| `latency_ms` | int |
| `outcome` | `ok`, `refused`, `invalid_output`, `unavailable` or `over_limit` |

Every request counts against the monthly limit except `over_limit` and `unavailable`, so a provider outage doesn't use up your quota.

### 4.2 `ai_settings` (Phase 1)

`user_id` (pk), `enabled` (default true), `acknowledged` (a text[] of the features whose privacy notice has been seen).

### 4.3 Food log origin (Phase 1)

Add `food_log.origin text not null default 'manual' check (origin in ('manual','ai_photo','ai_plan'))`. Entries logged from a photo are marked as estimates in the day view (a small "AI estimate" tag). This keeps sub-project 2's snapshot model unchanged.

### 4.4 `ai_reports` (Phase 2)

| Column | Notes |
|---|---|
| `id`, `user_id` | |
| `week_start` | date, the check-in day the report covers up to; unique per user |
| `facts` | jsonb: the computed inputs the text was written from, kept for audit and re-display |
| `summary` | text, at most 400 chars |
| `sections` | jsonb: `[{title, body, tone: good\|watch\|neutral}]` |
| `focus` | text[], 1–3 short next-week actions |
| `provider`, `model`, `created_at` | |

### 4.5 `ai_body_fat_estimates` (Phase 2)

| Column | Notes |
|---|---|
| `id`, `user_id`, `taken_on` | `taken_on` is a date |
| `photo_ids` | uuid[], 1–3 progress photos from the same day |
| `low_pct`, `high_pct`, `estimate_pct` | numeric(4,1), 3–60, low ≤ estimate ≤ high |
| `notes` | text, at most 500 chars: the model's visual cues, shown on request |
| `provider`, `model`, `created_at` | |

It appears on Trends as the metric `ai_body_fat_pct` (source `ai`). The chart shows the range as a band and the midpoint as dots. It has no trend line and no goals, and it never feeds the Navy, scale or TDEE calculations.

### 4.6 Recipes gain instructions (Phase 3)

`recipes.instructions text check (char_length(instructions) <= 4000)`. This holds the steps for AI-generated recipes, and users can edit it for any recipe.

## 5. Features and screens

### 5.1 Food photo logging (Phase 1)

- **Entry point:** a **Photo** tab in the add-food sheet, next to Search, Barcode and Quick add. It opens the camera (`<input type=file accept=image/* capture=environment>`) and also accepts a gallery pick.
- **Hint:** an optional free-text field ("e.g. 'the rice was about a cup', 'cooked in olive oil'").
- **`POST /ai/food-photo`** (multipart: the image plus `hint` and `meal`) returns `{items: [{name, grams, nutrients, confidence: low|medium|high, search_query}], notes}`.
  - Nutrients cover kcal, protein, carbs and fat per item (the quick-add set), and the existing quick-add plausibility rules apply.
  - `search_query` is a short English food name for the database.
- **Review list:** each item has editable grams (nutrients rescale linearly), a remove button, and **"Find in database"**. That runs the normal food search for `search_query` and swaps the item for the real food at the same grams, giving full micros and a real snapshot.
- **Log all** writes one entry per item in one request, `POST /food-log/batch`:
  - Swapped items are normal entries.
  - Estimated items are quick-add entries with `origin = 'ai_photo'`.
- **Errors:**
  - Low confidence overall or no food found: the model returns an empty list with a note, shown as "Couldn't recognise food in this photo".
  - Refusal: "This photo couldn't be analysed".
  - Over limit: "AI limit reached until <date>".

### 5.2 Weekly report (Phase 2)

- **Where:** More → Reports (a list of past weeks). On Home, a "Your weekly report" card appears on the check-in day and the 2 days after, until opened.
- **Generation:** opening a week with no report generates it once (a few seconds, with a spinner). The user can regenerate once per week (this counts against the limit).
- **Facts, computed by `report_service.facts(user, week)`:**
  - start and end trend values and the weekly rate for weight, fat mass, lean mass, body fat % and waist
  - goal projections
  - days logged, average kcal and protein against target, and protein-target hit days
  - TDEE and confidence
  - check-in outcome
  - micronutrients flagged low (28-day)
  - weigh-in count and photos taken
  - deltas against the previous week
- **The model's task:** write `summary`, 2–4 `sections` and 1–3 `focus` items. The rules:
  - Use only the facts given.
  - Use the units and rounding given.
  - Don't give medical advice, and don't diagnose.
  - Encourage without overpraising.
  - Mention data gaps honestly ("only 3 days logged").
- **Validation:** numbers in the output text must appear in the facts (a check over numeric tokens after rounding). If a number doesn't, the call is retried once and then falls back to a template report with the facts in plain sentences. The fallback is marked as such.

### 5.3 Body-fat estimate from photos (Phase 2)

- **Where:** the Photos screen. Selecting a day's photos (front required, side and back optional) offers **"Estimate body fat (AI)"**. The first use shows the privacy notice.
- **`POST /ai/body-fat`** `{photo_ids}`:
  - The backend checks ownership and same-day.
  - It reads the images from storage and sends them with sex, age, height and the weight trend for that day.
  - Returns `{low_pct, high_pct, estimate_pct, notes}`.
  - Validation: the range must be ≤ 8 points wide (otherwise retry once, then clamp to estimate ± 4), and values must stay within 3–60.
- **Display:**
  - On the photo set, a caption such as "AI estimate: 17–21% (rough)".
  - Next to it, the same day's scale and Navy values, if any.
  - On Trends, the `ai_body_fat_pct` series as above.
  - The estimate can be deleted. The photos are unaffected.

### 5.4 Meal plans and recipes from groceries (Phase 3)

- **Where:** More → Nutrition → **Plan with AI**, with two tabs.
- **Plan a day:**
  - Inputs:
    - targets (defaults to the targets in force; or what's left today, for "plan the rest of today")
    - number of meals (2–5)
    - preferences (free text, remembered: dislikes, cuisine, kosher, budget)
  - The model returns meals made of ingredients `{name, search_query, grams}`.
  - **Resolution:** the backend resolves each ingredient with the existing food search (local custom foods, then USDA generic, then OFF). It takes the top plausible match and computes the nutrients from it.
  - **Display:** per-meal and day totals against targets, unresolved ingredients flagged, and an ingredient swap through the normal search.
  - **Actions:** "Save meal" (to saved meals), "Log this meal" (food log entries, `origin='ai_plan'`), and "Regenerate".
- **Recipes from groceries:**
  - Input: groceries as text (one per line, or comma-separated), optional servings, and "use only these" vs "staples allowed" (oil, salt, spices).
  - The model returns 1–3 recipes with ingredients, servings and steps. Resolution and totals work the same way, per serving.
  - "Save recipe" creates a normal recipe with `instructions`.
- **Reuse:** nothing new is needed for logging. A saved AI recipe is an ordinary recipe.

### 5.5 Settings

Settings → **AI**:
- the provider and model in use (read-only, from `/ai/status`)
- usage this month against the limit
- an on/off switch
- "Reset privacy notices"

## 6. Prompts

- Each prompt module holds a fixed system prompt, a builder for the user turn, and an output schema. The system prompts are constants: the date, profile and facts go in the user turn, so prompt caching works where the provider supports it.
- User free text (hints, preferences, groceries) is passed as quoted data inside clear delimiters, and the system prompt says to treat it as information, not instructions. Outputs are schema-validated, and no output triggers an action without user review, which bounds the damage of any injection.
- Prompts are versioned (`PROMPT_VERSION` per module). The version is recorded in `ai_usage` and in stored reports and estimates.

## 7. API (additions)

| Method | Path | Phase | Notes |
|---|---|---|---|
| GET | `/ai/status` | 1 | enabled, provider, model, usage, limit |
| GET/PUT | `/ai/settings` | 1 | enabled, acknowledged features |
| POST | `/ai/food-photo` | 1 | multipart; returns items, not logged |
| POST | `/food-log/batch` | 1 | up to 20 entries (food or quick add) in one transaction |
| GET | `/ai/reports` | 2 | list (week_start, summary) |
| GET/POST | `/ai/reports/{week_start}` | 2 | GET returns 404 if none; POST generates or regenerates |
| GET/POST/DELETE | `/ai/body-fat` | 2 | list, estimate, delete |
| POST | `/ai/meal-plan` | 3 | returns a resolved plan, not saved |
| POST | `/ai/recipes-from-groceries` | 3 | returns resolved recipes, not saved |

All `/ai/*` POST endpoints return:
- 503 `ai_disabled` when `AI_PROVIDER=none` or the user turned AI off,
- 429 `ai_limit` with `resets_on`,
- 502 `ai_unavailable`,
- 422 `ai_refused` / `ai_invalid_output`.

## 8. Error handling (additions)

| Situation | Behaviour |
|---|---|
| Provider down or slow (> 60 s) | "AI is unavailable right now, try again." Nothing is counted against the limit. Manual logging is unaffected. |
| Model output fails schema twice | "Couldn't read the AI's answer." The attempt is recorded as `invalid_output` |
| Safety refusal | A neutral message, with no retry. |
| Report quotes a number not in the facts | One retry, then the template report |
| Ingredient can't be matched | Shown as "not found" with a search button. It is left out of totals, with the coverage shown. |
| Body-fat range implausible | Clamped as in §5.3, with the notes kept |
| AI off or not configured | Every AI entry point is hidden, and the API returns 503 if called directly |

## 9. Testing

- **Unit:**
  - Each adapter against recorded or mocked SDK responses: schema mapping, error translation, usage extraction.
  - Budget counting and the month boundary in the profile timezone.
  - Report facts, plus the number-grounding check.
  - Body-fat validation and clamping.
  - Ingredient resolution ranking.
  - Rescaling of photo items.
- **API (real Postgres, `FakeProvider`):**
  - Every endpoint's happy path.
  - Over limit, disabled, refused, invalid output.
  - Ownership checks on `photo_ids`.
  - RLS isolation for the new tables.
  - Batch logging is atomic.
- **Frontend (Vitest + RTL):**
  - The photo tab review list: edit grams, remove, swap.
  - The privacy notice gate.
  - Report rendering, including the fallback.
  - The body-fat caption.
  - Plan totals with unresolved items.
  - Hidden entry points when AI is off.
- **E2E (`AI_PROVIDER=fake`):**
  - Photo → review → log.
  - Open the weekly report.
  - Estimate body fat on an uploaded photo.
  - Plan a day → save meal.
  - Groceries → save recipe.
- **No live-provider calls in CI.** `backend/scripts/ai_smoke.py` runs each feature once against the configured real provider, for manual checks when switching vendor.

## 10. Delivery phases

Each phase is one PR, and each is usable on its own:

1. **Foundation + food photo:**
   - the `app/ai` layer with the three adapters
   - usage cap, settings, status
   - `food_log.origin` and batch logging
   - the Photo tab
   - Settings → AI
2. **Insight:** weekly report, and body-fat estimate from photos (with its Trends series).
3. **Planning:** meal plans and recipes from groceries, `recipes.instructions`, and ingredient resolution.

## 11. Decisions from the owner (2026-10-04)

1. **Provider:** undecided between Claude and Google. The code is generic, and the vendor is chosen in config.
2. **Features:** all four (weekly report, food photo logging, body-fat estimate from photos, meal plans and recipes).
3. **Privacy:** photos are sent to the AI only when the user taps. There are no automatic runs.
