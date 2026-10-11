-- Plaid-connected institutions, accounts, liabilities and transactions.
-- These rows mirror data REPORTED by Plaid. Simulated Reclaimed activity never writes here.

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plaid_item_id text not null unique,
  -- AES-256-GCM ciphertext (v1:<iv>:<tag>:<data>, base64). Never returned to clients.
  access_token_ciphertext text not null,
  institution_id text,
  institution_name text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'LOGIN_REQUIRED', 'ERROR', 'REMOVED')),
  error_code text,
  last_error text,
  products text[] not null default '{}',
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plaid_items_user_id_idx on public.plaid_items (user_id);
create trigger plaid_items_set_updated_at before update on public.plaid_items
  for each row execute function public.set_updated_at();

create table public.plaid_sync_state (
  plaid_item_id uuid primary key references public.plaid_items (id) on delete cascade,
  transactions_cursor text,
  sync_in_progress boolean not null default false,
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_status text check (last_sync_status in ('SUCCESS', 'FAILED')),
  last_sync_error text,
  added_count integer not null default 0,
  modified_count integer not null default 0,
  removed_count integer not null default 0,
  updated_at timestamptz not null default now()
);
create trigger plaid_sync_state_set_updated_at before update on public.plaid_sync_state
  for each row execute function public.set_updated_at();

create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plaid_item_id uuid not null references public.plaid_items (id) on delete cascade,
  plaid_account_id text not null unique,
  name text not null,
  official_name text,
  mask text check (mask is null or char_length(mask) <= 4),
  type text not null,
  subtype text,
  current_balance_cents bigint,
  available_balance_cents bigint,
  credit_limit_cents bigint,
  iso_currency_code text,
  balance_updated_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index financial_accounts_user_id_idx on public.financial_accounts (user_id);
create index financial_accounts_plaid_item_id_idx on public.financial_accounts (plaid_item_id);
create trigger financial_accounts_set_updated_at before update on public.financial_accounts
  for each row execute function public.set_updated_at();

create table public.account_liabilities (
  financial_account_id uuid primary key references public.financial_accounts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_statement_balance_cents bigint,
  minimum_payment_cents bigint,
  next_payment_due_date date,
  last_statement_issue_date date,
  last_payment_amount_cents bigint,
  last_payment_date date,
  aprs jsonb not null default '[]'::jsonb,
  is_overdue boolean,
  updated_at timestamptz not null default now()
);
create index account_liabilities_user_id_idx on public.account_liabilities (user_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts (id) on delete cascade,
  plaid_transaction_id text not null unique,
  pending_transaction_id text,
  name text not null,
  merchant_name text,
  -- Plaid sign convention: positive = money out of the account.
  amount_cents bigint not null,
  iso_currency_code text,
  date date not null,
  authorized_date date,
  pending boolean not null default false,
  category text,
  payment_channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_id_date_idx on public.transactions (user_id, date desc, id);
create index transactions_financial_account_id_date_idx on public.transactions (financial_account_id, date desc);
create index transactions_pending_transaction_id_idx on public.transactions (pending_transaction_id)
  where pending_transaction_id is not null;
create trigger transactions_set_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();
