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
