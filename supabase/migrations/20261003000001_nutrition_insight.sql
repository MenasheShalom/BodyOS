-- BodyOS sub-project 2, phase 3: incomplete-day flags and dismissed check-ins

-- A flagged day is left out of the adaptive TDEE, averages and nutrition charts.
create table public.nutrition_day_flags (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  excluded boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- "Not this week" on a target suggestion; week_start is that week's check-in day.
create table public.target_suggestion_dismissals (
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

create trigger nutrition_day_flags_updated_at before update on public.nutrition_day_flags
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['nutrition_day_flags', 'target_suggestion_dismissals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated'
      ' using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own_rows', t
    );
  end loop;
end $$;
