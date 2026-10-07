-- BodyOS MCP server: OAuth 2.1 for AI assistants (Claude and other MCP clients).
-- These tables are only used by the backend. Row level security is on with no policies, so the
-- Supabase API can't read them. Codes and tokens are stored as SHA-256 hashes only.

-- Clients register themselves (RFC 7591 dynamic client registration).
create table public.oauth_clients (
  client_id text primary key check (char_length(client_id) <= 100),
  info jsonb not null check (jsonb_typeof(info) = 'object'),
  created_at timestamptz not null default now()
);

-- An authorization request waiting for the user to allow or deny it on the consent page.
create table public.oauth_requests (
  id text primary key check (char_length(id) <= 100),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- One user's permission for one client. Revoking it deletes its codes and tokens.
create table public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  scopes text[] not null default '{}',
  resource text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index oauth_grants_user on public.oauth_grants (user_id);

create table public.oauth_codes (
  code_hash text primary key,
  grant_id uuid not null references public.oauth_grants (id) on delete cascade,
  params jsonb not null check (jsonb_typeof(params) = 'object'),
  expires_at timestamptz not null
);

create table public.oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references public.oauth_grants (id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null
);
create index oauth_tokens_grant on public.oauth_tokens (grant_id);

alter table public.oauth_clients enable row level security;
alter table public.oauth_requests enable row level security;
alter table public.oauth_grants enable row level security;
alter table public.oauth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
