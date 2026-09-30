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
