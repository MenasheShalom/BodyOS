-- Supabase security advisor 0011: pin the trigger function's search_path.
-- now() lives in pg_catalog, which is always searched, so an empty path is safe.
alter function public.set_updated_at() set search_path = '';
