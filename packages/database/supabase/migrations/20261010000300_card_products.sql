-- Small, locally seeded catalog of credit card products (Phase 1).
-- Deliberately contains NO rewards, fees or benefits data — that is Phase 2.

create table public.card_products (
  id uuid primary key default gen_random_uuid(),
  issuer_name text not null,
  product_name text not null,
  product_slug text not null unique check (product_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  card_network text not null check (card_network in ('VISA', 'MASTERCARD', 'AMEX', 'DISCOVER')),
  -- Free-text caveats about the seeded metadata (e.g. network migrations).
  notes text,
  -- Lowercased issuer + product + aliases, used for simple account-name matching.
  match_keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (issuer_name, product_name)
);
create trigger card_products_set_updated_at before update on public.card_products
  for each row execute function public.set_updated_at();

-- Association of a user's Plaid financial account with a seeded product.
-- Many users can reference the same card_products row.
create table public.user_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  financial_account_id uuid not null unique references public.financial_accounts (id) on delete cascade,
  card_product_id uuid not null references public.card_products (id) on delete restrict,
  confirmed_by_user boolean not null default true,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index user_cards_user_id_idx on public.user_cards (user_id);
create index user_cards_card_product_id_idx on public.user_cards (card_product_id);
create trigger user_cards_set_updated_at before update on public.user_cards
  for each row execute function public.set_updated_at();
