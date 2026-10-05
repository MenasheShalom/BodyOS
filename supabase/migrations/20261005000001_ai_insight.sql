-- BodyOS sub-project 3, phase 2: weekly reports and body-fat estimates from photos

-- One written report per check-in week. `facts` keeps the computed numbers the text was
-- written from, so the report can be audited and shown again without recomputing.
create table public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,  -- the check-in day the report covers up to
  facts jsonb not null check (jsonb_typeof(facts) = 'object'),
  summary text not null check (char_length(summary) between 1 and 400),
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  focus text[] not null default '{}',
  -- true when the AI text failed the number check and a plain template was used instead
  fallback boolean not null default false,
  regenerations smallint not null default 0 check (regenerations between 0 and 1),
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 120),
  prompt_version text not null check (char_length(prompt_version) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

-- A rough range read from progress photos. Kept apart from scale and tape readings.
create table public.ai_body_fat_estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  taken_on date not null,
  photo_ids uuid[] not null check (cardinality(photo_ids) between 1 and 3),
  low_pct numeric(4,1) not null check (low_pct between 3 and 60),
  estimate_pct numeric(4,1) not null check (estimate_pct between 3 and 60),
  high_pct numeric(4,1) not null check (high_pct between 3 and 60),
  notes text not null default '' check (char_length(notes) <= 500),
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 120),
  prompt_version text not null check (char_length(prompt_version) <= 40),
  created_at timestamptz not null default now(),
  constraint ai_body_fat_order check (low_pct <= estimate_pct and estimate_pct <= high_pct)
);
create index ai_body_fat_user_day on public.ai_body_fat_estimates (user_id, taken_on);

create trigger ai_reports_updated_at before update on public.ai_reports
  for each row execute function public.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array['ai_reports', 'ai_body_fat_estimates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated'
      ' using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own_rows', t
    );
  end loop;
end $$;
