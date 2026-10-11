-- Tighten table privileges on Plaid-reported data to match the RLS intent in
-- 20261010000700_rls.sql ("users can READ only their own non-secret rows and can
-- write nothing"). RLS already blocks row writes, but TRUNCATE is not subject to
-- RLS, and anon never needs these tables. Only the API's privileged role writes here.

revoke all on public.financial_accounts, public.account_liabilities, public.transactions, public.user_cards
  from anon;

revoke insert, update, delete, truncate, references, trigger
  on public.financial_accounts, public.account_liabilities, public.transactions, public.user_cards
  from authenticated;

grant select on public.financial_accounts, public.account_liabilities, public.transactions, public.user_cards
  to authenticated;
