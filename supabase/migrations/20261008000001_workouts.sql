-- BodyOS workouts, phase 1: equipment locations, a training profile, AI-built programs and
-- the sessions logged against them.

-- AI usage gains the workout plan feature.
alter table public.ai_usage drop constraint ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check check (feature in (
  'food_photo', 'weekly_report', 'body_fat', 'meal_plan', 'recipe_from_groceries', 'workout_plan'
));

-- Where the user trains and what's there.
create table public.training_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  equipment text[] not null default '{}' check (cardinality(equipment) <= 30),
  -- free text such as "dumbbells up to 20 kg, no bench"
  notes text not null default '' check (char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_locations_user on public.training_locations (user_id);

create table public.training_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  experience text not null default 'some' check (experience in ('new', 'some', 'experienced')),
  limitations text not null default '' check (char_length(limitations) <= 500),
  days_per_week smallint not null default 3 check (days_per_week between 2 and 6),
  session_minutes smallint not null default 60 check (session_minutes between 20 and 120),
  cardio text not null default 'light' check (cardio in ('none', 'light', 'moderate')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A program the AI built. One is active at a time; older ones are kept for history.
create table public.workout_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  summary text not null default '' check (char_length(summary) <= 600),
  weeks smallint not null check (weeks between 1 and 16),
  daily_steps integer check (daily_steps between 0 and 30000),
  started_on date not null,
  active boolean not null default true,
  -- the profile, locations and body numbers the program was built from
  inputs jsonb not null default '{}' check (jsonb_typeof(inputs) = 'object'),
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 120),
  prompt_version text not null check (char_length(prompt_version) <= 40),
  created_at timestamptz not null default now()
);
create unique index workout_programs_one_active on public.workout_programs (user_id) where active;

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.workout_programs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null check (position between 0 and 6),
  name text not null check (char_length(name) between 1 and 60),
  focus text not null default '' check (char_length(focus) <= 120),
  location_id uuid references public.training_locations (id) on delete set null,
  cardio text not null default '' check (char_length(cardio) <= 200),
  unique (program_id, position)
);

create table public.program_exercises (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.program_days (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null check (position between 0 and 19),
  name text not null check (char_length(name) between 1 and 80),
  -- "reps": sets × rep range; "time": sets × seconds
  kind text not null default 'reps' check (kind in ('reps', 'time')),
  sets smallint not null check (sets between 1 and 10),
  reps_low smallint check (reps_low between 1 and 100),
  reps_high smallint check (reps_high between 1 and 100),
  seconds smallint check (seconds between 5 and 3600),
  rest_seconds smallint not null default 90 check (rest_seconds between 0 and 600),
  uses_weight boolean not null default true,
  notes text not null default '' check (char_length(notes) <= 200),
  alternatives text[] not null default '{}' check (cardinality(alternatives) <= 3),
  unique (day_id, position),
  constraint program_exercises_target check (
    (kind = 'reps' and reps_low is not null and reps_high is not null and reps_low <= reps_high)
    or (kind = 'time' and seconds is not null)
  )
);

-- A workout as performed. Sets copy the exercise name, so history survives program changes.
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  program_day_id uuid references public.program_days (id) on delete set null,
  day_name text not null check (char_length(day_name) between 1 and 60),
  performed_on date not null,
  completed_at timestamptz,
  notes text not null default '' check (char_length(notes) <= 500),
  created_at timestamptz not null default now()
);
create index workout_sessions_user_day on public.workout_sessions (user_id, performed_on);

create table public.session_sets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workout_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid references public.program_exercises (id) on delete set null,
  exercise_name text not null check (char_length(exercise_name) between 1 and 80),
  set_number smallint not null check (set_number between 1 and 20),
  weight_kg numeric(5,1) check (weight_kg between 0 and 500),
  reps smallint check (reps between 0 and 200),
  seconds smallint check (seconds between 0 and 3600),
  unique (session_id, exercise_name, set_number)
);
create index session_sets_exercise on public.session_sets (user_id, exercise_name);

create trigger training_locations_updated_at before update on public.training_locations
  for each row execute function public.set_updated_at();
create trigger training_profiles_updated_at before update on public.training_profiles
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['training_locations', 'training_profiles', 'workout_programs',
    'program_days', 'program_exercises', 'workout_sessions', 'session_sets']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated'
      ' using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own_rows', t
    );
  end loop;
end $$;
