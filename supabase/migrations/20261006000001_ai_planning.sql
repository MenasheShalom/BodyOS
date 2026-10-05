-- BodyOS sub-project 3, phase 3: meal plans and recipes from groceries

-- Cooking steps, filled in by hand or kept from an AI recipe idea.
alter table public.recipes
  add column instructions text check (char_length(instructions) <= 4000);

-- Free-text meal planning preferences (dislikes, cuisine, kosher, budget), remembered
-- between plans.
alter table public.ai_settings
  add column plan_preferences text not null default ''
    check (char_length(plan_preferences) <= 500);
