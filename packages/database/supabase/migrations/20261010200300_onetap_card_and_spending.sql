-- 1. One OneTap card, digital and physical.
-- A reclaimed_cards row is the user's OneTap card. It is created digital (no NFC UID), and the
-- physical NFC card is attached to the same row when it is tapped during enrollment.

alter table public.reclaimed_cards
  alter column uid_fingerprint drop not null,
  alter column uid_masked drop not null;

-- At most one live digital-only card per user.
create unique index if not exists reclaimed_cards_one_digital_per_user
  on public.reclaimed_cards (user_id) where uid_fingerprint is null and status in ('ACTIVE', 'FROZEN');

-- 2. Spending across the cards connected through Plaid (the app's Dashboard).
-- Plaid's detailed category separates groceries from dining and gas from other transport.

alter table public.transactions add column if not exists category_detailed text;

-- Plaid personal_finance_category (detailed or primary) -> OneTap category. Unlisted: 'general'.
create table if not exists public.plaid_category_map (
  plaid_category text primary key,
  category_id text not null references public.categories (id) on delete restrict
);

alter table public.plaid_category_map enable row level security;
drop policy if exists plaid_category_map_select_authenticated on public.plaid_category_map;
create policy plaid_category_map_select_authenticated on public.plaid_category_map
  for select to authenticated using (true);
revoke insert, update, delete on public.plaid_category_map from anon, authenticated;

-- Purchases on connected credit cards. security_invoker: RLS on transactions and
-- financial_accounts applies, so a user sees only their own rows.
create or replace view public.card_spending with (security_invoker = true) as
select t.id,
       t.user_id,
       t.financial_account_id,
       coalesce(a.official_name, a.name) as account_name,
       a.mask,
       coalesce(t.merchant_name, t.name) as merchant,
       t.amount_cents,
       t.date,
       t.pending,
       coalesce(d.category_id, p.category_id, 'general') as category_id
  from public.transactions t
  join public.financial_accounts a on a.id = t.financial_account_id
  left join public.plaid_category_map d on d.plaid_category = t.category_detailed
  left join public.plaid_category_map p on p.plaid_category = t.category
 where a.type = 'credit'
   and t.amount_cents > 0 -- Plaid: positive is money out; payments and refunds are negative
   and coalesce(t.category, '') not in ('TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS', 'INCOME');

revoke all on public.card_spending from anon;
grant select on public.card_spending to authenticated;
