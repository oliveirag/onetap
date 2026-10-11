-- Simulated payment processing: checkouts, authorizations, funding attempts,
-- double-entry ledger, settlement, refunds and processor events.
-- NOTHING in these tables represents a real card network transaction.

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  terminal_id uuid not null references public.test_terminals (id) on delete restrict,
  user_id uuid references public.profiles (id) on delete set null,
  reclaimed_card_id uuid references public.reclaimed_cards (id) on delete set null,
  merchant_id text not null,
  merchant_name text not null,
  mcc text not null check (mcc ~ '^\d{4}$'),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  state text not null default 'CREATED' check (state in (
    'CREATED', 'AUTHORIZATION_PENDING', 'AUTHORIZED', 'DECLINED', 'CAPTURED', 'SETTLEMENT_PENDING',
    'SETTLED', 'REVERSED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED')),
  authorization_result text check (authorization_result in (
    'APPROVED', 'DECLINED', 'CARD_FROZEN', 'INVALID_CARD', 'INSUFFICIENT_FUNDS', 'LIMIT_EXCEEDED',
    'AUTHORIZATION_TIMEOUT', 'INTERNAL_ERROR')),
  decline_reason text,
  funding_account_id uuid references public.mock_funding_accounts (id) on delete set null,
  funding_account_name text,
  processor text not null default 'mock' check (processor in ('mock', 'lithic_sandbox')),
  processor_reference text,
  captured_cents bigint not null default 0 check (captured_cents >= 0),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  expires_at timestamptz not null,
  authorized_at timestamptz,
  captured_at timestamptz,
  settled_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (captured_cents <= amount_cents),
  check (refunded_cents <= captured_cents)
);
-- One open checkout per terminal at a time.
create unique index payment_transactions_one_open_per_terminal
  on public.payment_transactions (terminal_id) where state in ('CREATED', 'AUTHORIZATION_PENDING');
create index payment_transactions_user_id_created_at_idx on public.payment_transactions (user_id, created_at desc, id);
create index payment_transactions_card_id_created_at_idx on public.payment_transactions (reclaimed_card_id, created_at desc);
create index payment_transactions_open_expiry_idx on public.payment_transactions (expires_at) where state = 'CREATED';
create trigger payment_transactions_set_updated_at before update on public.payment_transactions
  for each row execute function public.set_updated_at();

-- Defense in depth: mirror the TypeScript state machine (packages/payment-core/src/state-machine.ts).
create or replace function public.enforce_payment_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  if new.state = old.state and new.state <> 'PARTIALLY_REFUNDED' then
    return new;
  end if;
  allowed := case old.state
    when 'CREATED' then array['AUTHORIZATION_PENDING', 'FAILED']
    when 'AUTHORIZATION_PENDING' then array['AUTHORIZED', 'DECLINED', 'FAILED']
    when 'AUTHORIZED' then array['CAPTURED', 'REVERSED']
    when 'CAPTURED' then array['SETTLEMENT_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED']
    when 'SETTLEMENT_PENDING' then array['SETTLED']
    when 'SETTLED' then array['PARTIALLY_REFUNDED', 'REFUNDED']
    when 'PARTIALLY_REFUNDED' then array['PARTIALLY_REFUNDED', 'REFUNDED', 'SETTLEMENT_PENDING']
    else array[]::text[]
  end;
  if not (new.state = any (allowed)) then
    raise exception 'Invalid payment state transition % -> %', old.state, new.state using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger payment_transactions_enforce_transition before update of state on public.payment_transactions
  for each row execute function public.enforce_payment_transition();

alter table public.hardware_tap_events
  add constraint hardware_tap_events_payment_transaction_id_fkey
  foreign key (payment_transaction_id) references public.payment_transactions (id) on delete set null;

create table public.authorization_attempts (
  id uuid primary key default gen_random_uuid(),
  -- One authorization per checkout: a repeated tap can never authorize twice.
  payment_transaction_id uuid not null unique references public.payment_transactions (id) on delete cascade,
  tap_event_id uuid references public.hardware_tap_events (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  reclaimed_card_id uuid references public.reclaimed_cards (id) on delete set null,
  result text check (result in (
    'APPROVED', 'DECLINED', 'CARD_FROZEN', 'INVALID_CARD', 'INSUFFICIENT_FUNDS', 'LIMIT_EXCEEDED',
    'AUTHORIZATION_TIMEOUT', 'INTERNAL_ERROR')),
  decline_reason text,
  processor text not null,
  total_ms integer,
  db_lookup_ms integer,
  funding_evaluation_ms integer,
  processor_ms integer,
  request jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index authorization_attempts_user_id_idx on public.authorization_attempts (user_id, created_at desc);

create table public.authorization_events (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_transactions (id) on delete cascade,
  authorization_attempt_id uuid references public.authorization_attempts (id) on delete cascade,
  event_type text not null,
  from_state text,
  to_state text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index authorization_events_payment_transaction_id_idx
  on public.authorization_events (payment_transaction_id, created_at);

create table public.funding_attempts (
  id uuid primary key default gen_random_uuid(),
  authorization_attempt_id uuid not null references public.authorization_attempts (id) on delete cascade,
  funding_account_id uuid references public.mock_funding_accounts (id) on delete set null,
  funding_account_name text not null,
  sequence integer not null check (sequence between 1 and 5),
  result text not null check (result in (
    'APPROVED', 'DECLINED', 'CARD_FROZEN', 'INVALID_CARD', 'INSUFFICIENT_FUNDS', 'LIMIT_EXCEEDED',
    'AUTHORIZATION_TIMEOUT', 'INTERNAL_ERROR')),
  reason text,
  created_at timestamptz not null default now(),
  unique (authorization_attempt_id, sequence),
  -- Never try the same funding account twice for one authorization.
  unique (authorization_attempt_id, funding_account_id)
);

-- ---------------------------------------------------------------------------
-- Double-entry simulation ledger (append-only, balanced per journal)
-- ---------------------------------------------------------------------------
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  user_id uuid references public.profiles (id) on delete set null,
  mock_funding_account_id uuid references public.mock_funding_accounts (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.ledger_journals (
  id uuid primary key default gen_random_uuid(),
  journal_type text not null check (journal_type in (
    'AUTHORIZATION_HOLD', 'AUTHORIZATION_REVERSAL', 'CAPTURE', 'SETTLEMENT', 'REFUND',
    'BILL_PAYMENT_HOLD', 'BILL_PAYMENT_RELEASE', 'BILL_PAYMENT_COMPLETION', 'BILL_PAYMENT_RETURN')),
  description text not null,
  payment_transaction_id uuid references public.payment_transactions (id) on delete set null,
  bill_payment_intent_id uuid,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create index ledger_journals_payment_transaction_id_idx on public.ledger_journals (payment_transaction_id);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.ledger_journals (id) on delete restrict,
  ledger_account_id uuid not null references public.ledger_accounts (id) on delete restrict,
  direction text not null check (direction in ('DEBIT', 'CREDIT')),
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);
create index ledger_entries_journal_id_idx on public.ledger_entries (journal_id);
create index ledger_entries_ledger_account_id_idx on public.ledger_entries (ledger_account_id);

-- Every journal must balance by COMMIT time.
create or replace function public.assert_ledger_journal_balanced()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_journal uuid := coalesce(new.journal_id, old.journal_id);
  v_debits bigint;
  v_credits bigint;
begin
  select coalesce(sum(amount_cents) filter (where direction = 'DEBIT'), 0),
         coalesce(sum(amount_cents) filter (where direction = 'CREDIT'), 0)
    into v_debits, v_credits
    from public.ledger_entries
   where journal_id = v_journal;
  if v_debits <> v_credits then
    raise exception 'Ledger journal % is unbalanced (debits %, credits %)', v_journal, v_debits, v_credits
      using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger ledger_entries_balanced
  after insert on public.ledger_entries
  deferrable initially deferred
  for each row execute function public.assert_ledger_journal_balanced();

create or replace function public.prevent_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Ledger entries are append-only' using errcode = 'P0001';
end;
$$;
create trigger ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function public.prevent_ledger_mutation();

create table public.settlement_records (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null unique references public.payment_transactions (id) on delete cascade,
  batch_reference text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'SETTLED')),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.refund_records (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_transactions (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  reason text,
  status text not null default 'COMPLETED' check (status in ('COMPLETED', 'FAILED')),
  processor_reference text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (payment_transaction_id, idempotency_key)
);

create table public.processor_events (
  id uuid primary key default gen_random_uuid(),
  processor text not null check (processor in ('mock', 'lithic_sandbox')),
  event_type text not null,
  external_id text,
  payment_transaction_id uuid references public.payment_transactions (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index processor_events_processor_external_id_key
  on public.processor_events (processor, external_id) where external_id is not null;
create index processor_events_payment_transaction_id_idx on public.processor_events (payment_transaction_id);

-- Lithic Sandbox card mapping (token only — never the PAN).
alter table public.reclaimed_cards add column lithic_card_token text unique;
