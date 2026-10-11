-- Settings the OneTap app reads and writes directly with the user's JWT (mobile/src/lib/queries.ts).
-- The router (payment-core CategoryRoutingSelector) reads them at authorization time.
-- Writes are limited to these columns on the user's own rows; everything else stays read-only.

-- ---------- Routing preferences on profiles ----------

alter table public.profiles
  add column if not exists routing_mode text not null default 'auto' check (routing_mode in ('auto', 'manual')),
  -- Manual mode: every purchase goes to this card.
  add column if not exists manual_card_id uuid references public.mock_funding_accounts (id) on delete set null,
  -- The card the user would otherwise have used; the "baseline" a routing decision is compared with.
  add column if not exists default_card_id uuid references public.mock_funding_accounts (id) on delete set null;

-- A profile may only point at the user's own cards.
create or replace function public.profiles_check_card_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.manual_card_id is not null and not exists (
    select 1 from public.mock_funding_accounts m where m.id = new.manual_card_id and m.user_id = new.id
  ) then
    raise exception 'manual_card_id must be one of the user''s cards' using errcode = '23514';
  end if;
  if new.default_card_id is not null and not exists (
    select 1 from public.mock_funding_accounts m where m.id = new.default_card_id and m.user_id = new.id
  ) then
    raise exception 'default_card_id must be one of the user''s cards' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_check_card_owner on public.profiles;
create trigger profiles_check_card_owner
  before insert or update of manual_card_id, default_card_id on public.profiles
  for each row execute function public.profiles_check_card_owner();

-- ---------- Card match source on funding accounts ----------

-- 'auto': matched to a catalog product by account name. 'user': the user picked it.
alter table public.mock_funding_accounts
  add column if not exists match_source text not null default 'auto' check (match_source in ('auto', 'user'));

-- ---------- Column-level write access for the app ----------

revoke insert, update, delete on public.profiles, public.mock_funding_accounts from anon, authenticated;

grant update (full_name, routing_mode, manual_card_id, default_card_id) on public.profiles to authenticated;
grant update (priority, card_product_id, match_source) on public.mock_funding_accounts to authenticated;

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists mock_funding_accounts_update_own on public.mock_funding_accounts;
create policy mock_funding_accounts_update_own on public.mock_funding_accounts
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

