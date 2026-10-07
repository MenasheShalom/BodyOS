-- Achievement trophies. Which trophies exist, and how each is earned, is defined in the app;
-- this table only remembers which ones a user has earned, when, and whether they've seen it.
-- Earned trophies are kept even if the condition later stops holding (a streak breaks).
create table public.achievements (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 60),
  earned_on date not null,
  -- null until the celebration has been shown
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.achievements enable row level security;
create policy achievements_own_rows on public.achievements for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
