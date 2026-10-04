-- BodyOS sub-project 3, phase 1: AI usage accounting, per-user AI settings, food log origin

-- One row per AI request. Users can read and add their own rows but never change them,
-- since the monthly limit is counted from this table.
create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in (
    'food_photo', 'weekly_report', 'body_fat', 'meal_plan', 'recipe_from_groceries'
  )),
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 120),
  prompt_version text not null check (char_length(prompt_version) <= 40),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  latency_ms integer not null check (latency_ms >= 0),
  outcome text not null check (outcome in (
    'ok', 'refused', 'invalid_output', 'unavailable', 'over_limit'
  )),
  created_at timestamptz not null default now()
);
create index ai_usage_user_time on public.ai_usage (user_id, created_at);

create table public.ai_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default true,
  -- features whose privacy notice the user has seen
  acknowledged text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ai_settings_updated_at before update on public.ai_settings
  for each row execute function public.set_updated_at();

alter table public.food_log
  add column origin text not null default 'manual'
    check (origin in ('manual', 'ai_photo', 'ai_plan'));

alter table public.ai_usage enable row level security;
create policy ai_usage_read_own on public.ai_usage for select to authenticated
  using (user_id = auth.uid());
create policy ai_usage_add_own on public.ai_usage for insert to authenticated
  with check (user_id = auth.uid());

alter table public.ai_settings enable row level security;
create policy ai_settings_own_rows on public.ai_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
