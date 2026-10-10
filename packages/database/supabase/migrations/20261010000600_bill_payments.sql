-- TEST MODE credit-card bill payments. No ACH or issuer payment is ever initiated.
-- Completing a simulated payment never changes Plaid-reported balances.

create table public.bill_payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  financial_account_id uuid references public.financial_accounts (id) on delete set null,
  financial_account_name text,
  funding_account_id uuid references public.mock_funding_accounts (id) on delete set null,
  funding_account_name text,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  state text not null default 'DRAFT'
    check (state in ('DRAFT', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED', 'RETURNED')),
  scenario text not null default 'SUCCESS' check (scenario in ('SUCCESS', 'FAIL', 'RETURN')),
  failure_reason text,
  idempotency_key text,
  next_transition_at timestamptz,
  submitted_at timestamptz,
  processing_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  returned_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bill_payment_intents_idempotency_key
  on public.bill_payment_intents (user_id, idempotency_key) where idempotency_key is not null;
create index bill_payment_intents_user_id_created_at_idx on public.bill_payment_intents (user_id, created_at desc);
create index bill_payment_intents_due_idx on public.bill_payment_intents (next_transition_at)
  where state in ('SUBMITTED', 'PROCESSING', 'COMPLETED') and next_transition_at is not null;
create trigger bill_payment_intents_set_updated_at before update on public.bill_payment_intents
  for each row execute function public.set_updated_at();

create table public.bill_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.bill_payment_intents (id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  provider text not null default 'mock' check (provider in ('mock')),
  provider_reference text not null,
  result text not null check (result in ('ACCEPTED', 'REJECTED')),
  detail text,
  created_at timestamptz not null default now(),
  unique (intent_id, attempt_number)
);

create table public.bill_payment_events (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.bill_payment_intents (id) on delete cascade,
  state text not null,
  note text,
  created_at timestamptz not null default clock_timestamp()
);
create index bill_payment_events_intent_id_idx on public.bill_payment_events (intent_id, created_at);

alter table public.ledger_journals
  add constraint ledger_journals_bill_payment_intent_id_fkey
  foreign key (bill_payment_intent_id) references public.bill_payment_intents (id) on delete set null;
