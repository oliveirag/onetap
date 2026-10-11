-- Category routing on payment_transactions.
-- The routed card is the existing funding_account_id (a mock_funding_accounts row).
-- Routing columns are nullable: a row is created before routing runs, and declines
-- before routing never get them. The backend fills them in the same update that sets
-- state to AUTHORIZED or DECLINED, so the app sees the full result in one Realtime event.

-- ---------- Reference data the router reads ----------

create table if not exists public.categories (
  id text primary key,
  label text not null,
  icon text,
  sort_order integer not null
);

insert into public.categories (id, label, sort_order) values
  ('dining', 'Dining', 1),
  ('groceries', 'Groceries', 2),
  ('gas', 'Gas', 3),
  ('streaming', 'Streaming', 4),
  ('travel', 'Travel', 5),
  ('general', 'General', 6)
on conflict (id) do nothing;

create table if not exists public.mcc_map (
  mcc text primary key check (mcc ~ '^\d{4}$'),
  category_id text not null references public.categories(id) on delete restrict,
  description text
);

alter table public.card_products
  add column if not exists reward_type text not null default 'points'
    check (reward_type in ('points', 'cashback')),
  add column if not exists reward_currency text,
  add column if not exists cents_per_point numeric(5,2) not null default 1.00
    check (cents_per_point > 0),
  add column if not exists card_art text,
  add column if not exists is_generic boolean not null default false;

create table if not exists public.card_product_rates (
  id uuid primary key default gen_random_uuid(),
  card_product_id uuid not null references public.card_products(id) on delete cascade,
  category_id text not null references public.categories(id) on delete restrict,
  multiplier numeric(4,2) not null check (multiplier >= 0),
  unique (card_product_id, category_id)
);

-- Only last four ever reaches the app.
alter table public.mock_funding_accounts
  add column if not exists last4 text check (last4 ~ '^\d{4}$');

-- ---------- Routing result on payment_transactions ----------

alter table public.payment_transactions
  add column if not exists category_id text references public.categories(id) on delete restrict,
  add column if not exists funding_account_last4 text check (funding_account_last4 ~ '^\d{4}$'),
  add column if not exists routing_mode text check (routing_mode in ('auto', 'manual')),
  add column if not exists decision_reason text
    check (decision_reason in ('best_rate', 'tie_priority', 'manual', 'fallback_default')),
  add column if not exists multiplier numeric(4,2) check (multiplier >= 0),
  add column if not exists points_earned integer check (points_earned >= 0),
  add column if not exists reward_value_cents bigint check (reward_value_cents >= 0),
  add column if not exists baseline_value_cents bigint check (baseline_value_cents >= 0),
  add column if not exists best_value_cents bigint check (best_value_cents >= 0),
  -- [{ funding_account_id, name, last4, multiplier, value_cents }], losing options only
  add column if not exists alternatives jsonb check (alternatives is null or jsonb_typeof(alternatives) = 'array'),
  add column if not exists is_seeded boolean not null default false;

-- Routing fields arrive together or not at all.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_transactions'::regclass
      and conname = 'payment_transactions_routing_complete'
  ) then
    alter table public.payment_transactions
      add constraint payment_transactions_routing_complete check (
        (decision_reason is null
          and multiplier is null and points_earned is null and reward_value_cents is null
          and baseline_value_cents is null and best_value_cents is null)
        or
        (decision_reason is not null and category_id is not null and routing_mode is not null
          and funding_account_id is not null
          and multiplier is not null and points_earned is not null and reward_value_cents is not null
          and baseline_value_cents is not null and best_value_cents is not null)
      );
  end if;
end $$;

-- ---------- RLS: reference tables are read-only to signed-in users ----------

alter table public.categories enable row level security;
alter table public.mcc_map enable row level security;
alter table public.card_product_rates enable row level security;

drop policy if exists categories_select_authenticated on public.categories;
create policy categories_select_authenticated on public.categories
  for select to authenticated using (true);

drop policy if exists mcc_map_select_authenticated on public.mcc_map;
create policy mcc_map_select_authenticated on public.mcc_map
  for select to authenticated using (true);

drop policy if exists card_product_rates_select_authenticated on public.card_product_rates;
create policy card_product_rates_select_authenticated on public.card_product_rates
  for select to authenticated using (true);

-- ---------- Realtime: the app opens the result sheet from this table ----------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payment_transactions'
  ) then
    alter publication supabase_realtime add table public.payment_transactions;
  end if;
end $$;
