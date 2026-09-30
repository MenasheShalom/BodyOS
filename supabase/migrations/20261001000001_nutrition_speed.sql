-- BodyOS sub-project 2, phase 2: favourites, recipes and saved meals

create table public.food_favourites (
  user_id uuid not null references auth.users (id) on delete cascade,
  food_id uuid not null references public.foods (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, food_id)
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  servings numeric(5,2) not null check (servings between 0.25 and 100),
  cooked_weight_g numeric(7,1) check (cooked_weight_g between 1 and 20000),
  note text check (char_length(note) <= 500),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_user on public.recipes (user_id);

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- restrict: a food used in a recipe is archived, never deleted (see DELETE /foods)
  food_id uuid not null references public.foods (id) on delete restrict,
  grams numeric(7,1) not null check (grams between 0.1 and 5000),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipe_items_recipe on public.recipe_items (recipe_id);
create index recipe_items_food on public.recipe_items (food_id);

-- Each recipe is logged through a backing row in foods (source 'recipe').
alter table public.foods
  add constraint foods_recipe_fk
    foreign key (recipe_id) references public.recipes (id) on delete cascade,
  add constraint foods_recipe_has_recipe_id
    check ((source = 'recipe') = (recipe_id is not null));
create unique index foods_recipe_unique on public.foods (recipe_id) where recipe_id is not null;

create table public.saved_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index saved_meals_user on public.saved_meals (user_id);

create table public.saved_meal_items (
  id uuid primary key default gen_random_uuid(),
  saved_meal_id uuid not null references public.saved_meals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  food_id uuid references public.foods (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  grams numeric(7,1) check (grams between 0.1 and 5000),
  serving_label text check (char_length(serving_label) <= 100),
  serving_count numeric(6,2) check (serving_count > 0 and serving_count <= 100),
  -- quick adds keep their numbers; food items are scaled from the food when logged
  nutrients jsonb check (nutrients is null or (jsonb_typeof(nutrients) = 'object' and nutrients ? 'energy_kcal')),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_meal_items_kind check ((food_id is null) = (nutrients is not null)),
  constraint saved_meal_items_amount check (food_id is null or grams is not null)
);
create index saved_meal_items_meal on public.saved_meal_items (saved_meal_id);
create index saved_meal_items_food on public.saved_meal_items (food_id);

do $$
declare
  t text;
begin
  foreach t in array array['recipes', 'recipe_items', 'saved_meals', 'saved_meal_items']
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_updated_at', t
    );
  end loop;
  foreach t in array array['food_favourites', 'recipes', 'recipe_items', 'saved_meals', 'saved_meal_items']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated'
      ' using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own_rows', t
    );
  end loop;
end $$;
