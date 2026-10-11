-- Stripe test-mode charge of the routed card after each approved tap.
-- One Stripe customer per user, one saved test payment method per funding account, and the
-- charge outcome on the payment row (pushed to the phone by Realtime like the routing UPDATE).
-- Test mode only: no real money moves.

alter table public.profiles
  add column if not exists stripe_customer_id text;

alter table public.mock_funding_accounts
  add column if not exists stripe_payment_method_id text;

-- null = no charge applies (Stripe off, seeded history, declines).
alter table public.payment_transactions
  add column if not exists charge_status text check (charge_status in ('pending', 'succeeded', 'failed')),
  add column if not exists stripe_payment_intent_id text,
  add column if not exists charged_funding_account_id uuid references public.mock_funding_accounts (id) on delete set null,
  add column if not exists charged_at timestamptz;
create index if not exists payment_transactions_charge_pending_idx
  on public.payment_transactions (created_at) where charge_status = 'pending';

-- One row per charge attempt: 1 = routed card, 2 = one fallback to the default card.
create table if not exists public.stripe_charge_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_transactions (id) on delete cascade,
  attempt_no smallint not null check (attempt_no in (1, 2)),
  funding_account_id uuid references public.mock_funding_accounts (id) on delete set null,
  stripe_payment_intent_id text unique,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_transaction_id, attempt_no)
);
alter table public.stripe_charge_attempts enable row level security;
revoke all on public.stripe_charge_attempts from anon, authenticated;

-- Stripe webhooks are stored alongside Plaid and Lithic ones.
alter table public.webhook_events drop constraint if exists webhook_events_provider_check;
alter table public.webhook_events
  add constraint webhook_events_provider_check check (provider in ('plaid', 'lithic', 'stripe'));
