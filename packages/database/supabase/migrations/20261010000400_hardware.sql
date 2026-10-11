-- NFC hardware, test terminals, Reclaimed test cards and mock funding accounts.
-- Generic NFC UIDs can be spoofed: they identify DEVELOPMENT test cards only and are
-- never treated as real-money credentials. Raw UIDs are not stored — only a keyed
-- HMAC fingerprint and a masked suffix for display.

create table public.hardware_readers (
  id uuid primary key default gen_random_uuid(),
  bridge_id text not null,
  reader_name text not null,
  model text,
  connected boolean not null default false,
  last_seen_at timestamptz,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  last_card_present_at timestamptz,
  last_card_removed_at timestamptz,
  last_card_type text,
  last_uid_masked text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bridge_id, reader_name)
);
create trigger hardware_readers_set_updated_at before update on public.hardware_readers
  for each row execute function public.set_updated_at();

create table public.test_terminals (
  id uuid primary key default gen_random_uuid(),
  terminal_code text not null unique,
  display_name text not null,
  -- sha256 hex of the terminal's shared secret; the secret itself lives only in env.
  secret_hash text not null,
  -- When set, only taps from this reader can complete this terminal's checkouts.
  reader_id uuid references public.hardware_readers (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger test_terminals_set_updated_at before update on public.test_terminals
  for each row execute function public.set_updated_at();

-- Fictional funding sources used ONLY by the payment simulator.
-- Completely separate from Plaid-reported balances in financial_accounts.
create table public.mock_funding_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  fictional_issuer text not null,
  kind text not null default 'CREDIT' check (kind in ('CREDIT', 'DEPOSIT')),
  card_product_id uuid references public.card_products (id) on delete set null,
  -- CREDIT: credit limit. DEPOSIT: unused (0).
  credit_limit_cents bigint not null default 0 check (credit_limit_cents >= 0),
  -- CREDIT: amount owed. DEPOSIT: funds on deposit.
  current_balance_cents bigint not null default 0 check (current_balance_cents >= 0),
  pending_holds_cents bigint not null default 0 check (pending_holds_cents >= 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  priority integer not null default 10 check (priority between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mock_funding_accounts_user_id_idx on public.mock_funding_accounts (user_id, priority);
create trigger mock_funding_accounts_set_updated_at before update on public.mock_funding_accounts
  for each row execute function public.set_updated_at();

create table public.reclaimed_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  display_id text not null unique,
  nickname text check (char_length(nickname) <= 40),
  status text not null default 'UNREGISTERED'
    check (status in ('UNREGISTERED', 'ACTIVE', 'FROZEN', 'DISABLED', 'REVOKED')),
  uid_fingerprint text not null,
  uid_masked text not null,
  card_technology text,
  atr text,
  primary_funding_account_id uuid references public.mock_funding_accounts (id) on delete set null,
  secondary_funding_account_id uuid references public.mock_funding_accounts (id) on delete set null,
  fallback_enabled boolean not null default true,
  per_transaction_limit_cents bigint not null default 100000 check (per_transaction_limit_cents > 0),
  daily_limit_cents bigint not null default 250000 check (daily_limit_cents > 0),
  enrolled_at timestamptz,
  last_tapped_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (primary_funding_account_id is null or primary_funding_account_id is distinct from secondary_funding_account_id)
);
-- A physical tag can be enrolled to at most one live card.
create unique index reclaimed_cards_live_fingerprint_key
  on public.reclaimed_cards (uid_fingerprint) where status <> 'REVOKED';
create index reclaimed_cards_user_id_idx on public.reclaimed_cards (user_id);
create trigger reclaimed_cards_set_updated_at before update on public.reclaimed_cards
  for each row execute function public.set_updated_at();

create table public.nfc_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  reader_id uuid references public.hardware_readers (id) on delete set null,
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED', 'FAILED')),
  nickname text,
  reclaimed_card_id uuid references public.reclaimed_cards (id) on delete set null,
  failure_reason text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index nfc_enrollments_one_pending_per_user
  on public.nfc_enrollments (user_id) where status = 'PENDING';
create index nfc_enrollments_pending_idx on public.nfc_enrollments (status, expires_at) where status = 'PENDING';
create trigger nfc_enrollments_set_updated_at before update on public.nfc_enrollments
  for each row execute function public.set_updated_at();

-- Every bridge event (reader connect/disconnect, card presented/removed, errors).
create table public.hardware_tap_events (
  id uuid primary key default gen_random_uuid(),
  -- Bridge-generated id; the unique constraint makes event delivery idempotent.
  external_event_id uuid not null unique,
  event_type text not null
    check (event_type in ('READER_CONNECTED', 'READER_DISCONNECTED', 'CARD_PRESENTED', 'CARD_REMOVED', 'READER_ERROR')),
  reader_id uuid references public.hardware_readers (id) on delete set null,
  bridge_id text not null,
  uid_fingerprint text,
  uid_masked text,
  card_type text,
  atr text,
  outcome text check (outcome in (
    'ENROLLED', 'ENROLLMENT_REJECTED', 'AUTHORIZATION_STARTED', 'NO_PENDING_CHECKOUT',
    'DUPLICATE_TAP', 'UNKNOWN_CARD', 'IGNORED')),
  reclaimed_card_id uuid references public.reclaimed_cards (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  enrollment_id uuid references public.nfc_enrollments (id) on delete set null,
  payment_transaction_id uuid,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index hardware_tap_events_created_at_idx on public.hardware_tap_events (created_at desc);
create index hardware_tap_events_fingerprint_idx on public.hardware_tap_events (uid_fingerprint, occurred_at desc);
create index hardware_tap_events_user_id_idx on public.hardware_tap_events (user_id, created_at desc);
