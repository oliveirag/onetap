-- Reclaimed Phase 1 — core identity, settings, idempotency, webhooks and audit.
-- All simulated money is stored as bigint minor units (cents).


create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per Supabase auth user
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text check (char_length(full_name) <= 120),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.user_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  theme_preference text not null default 'system' check (theme_preference in ('system', 'light', 'dark')),
  developer_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

-- Create profile + settings automatically when Supabase Auth creates a user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- idempotency_records: replay-safe POSTs (checkouts, captures, refunds, bill pay)
-- ---------------------------------------------------------------------------
create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  owner_id text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash text not null,
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'COMPLETED')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  unique (scope, owner_id, idempotency_key)
);
create index idempotency_records_expires_at_idx on public.idempotency_records (expires_at);

-- ---------------------------------------------------------------------------
-- webhook_events: every inbound provider webhook, verified or not
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('plaid', 'lithic')),
  external_id text,
  event_type text not null,
  verified boolean not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now()
);
create unique index webhook_events_provider_external_id_key
  on public.webhook_events (provider, external_id) where external_id is not null;
create index webhook_events_received_at_idx on public.webhook_events (received_at desc);

-- ---------------------------------------------------------------------------
-- audit_logs: append-only trail of security-relevant actions
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('user', 'system', 'bridge', 'terminal', 'webhook')),
  actor_id text,
  user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_user_id_created_at_idx on public.audit_logs (user_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
