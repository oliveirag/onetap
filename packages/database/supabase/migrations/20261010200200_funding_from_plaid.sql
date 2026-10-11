-- Each routable card the OneTap app connects comes from one Plaid-reported credit account.
-- The link keeps reconnects idempotent (update the same card, never duplicate it) without
-- matching on names. Unlinking the bank leaves past payments intact (set null).

alter table public.mock_funding_accounts
  add column if not exists financial_account_id uuid unique references public.financial_accounts (id) on delete set null;
