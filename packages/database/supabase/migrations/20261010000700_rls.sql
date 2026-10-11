-- Row Level Security.
-- The Reclaimed API connects with a privileged role and ALSO enforces ownership in every
-- query. These policies are defense in depth for any client that talks to Supabase
-- directly with a user JWT: users can READ only their own non-secret rows and can
-- write nothing. Operational / secret tables have RLS enabled with no policies.

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'user_settings', 'idempotency_records', 'webhook_events', 'audit_logs',
    'plaid_items', 'plaid_sync_state', 'financial_accounts', 'account_liabilities', 'transactions',
    'card_products', 'user_cards',
    'hardware_readers', 'test_terminals', 'mock_funding_accounts', 'reclaimed_cards', 'nfc_enrollments',
    'hardware_tap_events',
    'payment_transactions', 'authorization_attempts', 'authorization_events', 'funding_attempts',
    'ledger_accounts', 'ledger_journals', 'ledger_entries', 'settlement_records', 'refund_records',
    'processor_events',
    'bill_payment_intents', 'bill_payment_attempts', 'bill_payment_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Secret / operational tables: no client access at all, even column-level.
revoke all on public.plaid_items, public.plaid_sync_state, public.idempotency_records, public.webhook_events,
  public.audit_logs, public.test_terminals, public.hardware_readers, public.hardware_tap_events,
  public.ledger_accounts, public.ledger_journals, public.ledger_entries, public.processor_events,
  public.authorization_events, public.bill_payment_attempts
  from anon, authenticated;

-- Read-only own-row policies.
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy user_settings_select_own on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy financial_accounts_select_own on public.financial_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy account_liabilities_select_own on public.account_liabilities
  for select to authenticated using (user_id = (select auth.uid()));
create policy transactions_select_own on public.transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_cards_select_own on public.user_cards
  for select to authenticated using (user_id = (select auth.uid()));
create policy mock_funding_accounts_select_own on public.mock_funding_accounts
  for select to authenticated using (user_id = (select auth.uid()));
create policy reclaimed_cards_select_own on public.reclaimed_cards
  for select to authenticated using (user_id = (select auth.uid()));
create policy nfc_enrollments_select_own on public.nfc_enrollments
  for select to authenticated using (user_id = (select auth.uid()));
create policy payment_transactions_select_own on public.payment_transactions
  for select to authenticated using (user_id = (select auth.uid()));
create policy authorization_attempts_select_own on public.authorization_attempts
  for select to authenticated using (user_id = (select auth.uid()));
create policy funding_attempts_select_own on public.funding_attempts
  for select to authenticated using (
    exists (select 1 from public.authorization_attempts a
             where a.id = funding_attempts.authorization_attempt_id and a.user_id = (select auth.uid())));
create policy settlement_records_select_own on public.settlement_records
  for select to authenticated using (
    exists (select 1 from public.payment_transactions p
             where p.id = settlement_records.payment_transaction_id and p.user_id = (select auth.uid())));
create policy refund_records_select_own on public.refund_records
  for select to authenticated using (
    exists (select 1 from public.payment_transactions p
             where p.id = refund_records.payment_transaction_id and p.user_id = (select auth.uid())));
create policy bill_payment_intents_select_own on public.bill_payment_intents
  for select to authenticated using (user_id = (select auth.uid()));
create policy bill_payment_events_select_own on public.bill_payment_events
  for select to authenticated using (
    exists (select 1 from public.bill_payment_intents i
             where i.id = bill_payment_events.intent_id and i.user_id = (select auth.uid())));

-- Seeded product catalog is public reference data for signed-in users.
create policy card_products_select_authenticated on public.card_products
  for select to authenticated using (true);
