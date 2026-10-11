import { asCardProduct, OTHER_CARD, productById } from './catalog';
import { supabase } from './supabase';
import type {
  Alternative,
  CardProduct,
  CardSpendingRow,
  CardProductRate,
  CategoryId,
  DecisionReason,
  OneTapCardRow,
  ProfileRow,
  RoutingMode,
  TransactionRow,
  UserCardRow,
} from './types';

// The backend (apps/api, packages/database) stores OneTap data in its own tables. The app keeps the
// shared/contracts.ts row types, so these functions map rows at the boundary:
//   user_cards   <- mock_funding_accounts (the cards the router charges) + card_products
//   onetap_cards <- reclaimed_cards (the enrolled NFC card)
//   transactions <- payment_transactions (with the routing columns)
// Product ids are the catalog ids the screens use ("cp-amex-gold"), keyed by product_slug.

export const appProductId = (slug: string) => (slug === 'other-card' ? OTHER_CARD.id : `cp-${slug}`);
export const productSlug = (appId: string) => (appId === OTHER_CARD.id ? 'other-card' : appId.replace(/^cp-/, ''));

type Numeric = number | string; // Postgres numeric/bigint can arrive as strings

export type DbProduct = {
  product_slug: string;
  issuer_name: string;
  product_name: string;
  card_network: string;
  reward_type: string | null;
  reward_currency: string | null;
  cents_per_point: Numeric | null;
  card_art: string | null;
  is_generic: boolean;
};

export type DbFundingAccount = {
  id: string;
  display_name: string;
  last4: string | null;
  match_source: 'auto' | 'user';
  priority: number;
  current_balance_cents: Numeric;
  credit_limit_cents: Numeric;
  status: string;
  financial_account_id: string | null;
  card_product: DbProduct | null;
};

export type DbPayment = {
  id: string;
  user_id: string | null;
  reclaimed_card_id: string | null;
  processor: string;
  processor_reference: string | null;
  merchant_id: string;
  merchant_name: string;
  mcc: string;
  amount_cents: Numeric;
  state: string;
  funding_account_id: string | null;
  category_id: string | null;
  routing_mode: string | null;
  decision_reason: string | null;
  multiplier: Numeric | null;
  points_earned: Numeric | null;
  reward_value_cents: Numeric | null;
  baseline_value_cents: Numeric | null;
  best_value_cents: Numeric | null;
  alternatives: { funding_account_id: string; name: string; last4: string | null; multiplier: Numeric; value_cents: Numeric }[] | null;
  is_seeded: boolean;
  created_at: string;
};

const PRODUCT_COLUMNS = 'product_slug, issuer_name, product_name, card_network, reward_type, reward_currency, cents_per_point, card_art, is_generic';
export const FUNDING_COLUMNS = `id, display_name, last4, match_source, priority, current_balance_cents, credit_limit_cents, status, financial_account_id, card_product:card_products(${PRODUCT_COLUMNS})`;
export const PAYMENT_COLUMNS =
  'id, user_id, reclaimed_card_id, processor, processor_reference, merchant_id, merchant_name, mcc, amount_cents, state, funding_account_id, ' +
  'category_id, routing_mode, decision_reason, multiplier, points_earned, reward_value_cents, baseline_value_cents, best_value_cents, alternatives, is_seeded, created_at';

const num = (v: Numeric | null | undefined) => Number(v ?? 0);

// Catalog names are the short display names the design uses ("Sapphire Preferred").
export function toCardProduct(p: DbProduct): CardProduct {
  const id = appProductId(p.product_slug);
  const known = productById(id);
  return {
    id,
    issuer: known?.issuer ?? p.issuer_name,
    name: known?.name ?? p.product_name,
    network: p.card_network.toLowerCase() as CardProduct['network'],
    reward_type: (p.reward_type ?? 'points') as CardProduct['reward_type'],
    reward_currency: p.reward_currency ?? 'Points',
    cents_per_point: num(p.cents_per_point ?? 1),
    card_art: p.card_art ?? 'solid',
    is_generic: p.is_generic,
  };
}

export function toUserCard(r: DbFundingAccount): UserCardRow {
  const product = r.card_product ? toCardProduct(r.card_product) : asCardProduct(OTHER_CARD);
  return {
    id: r.id,
    account_name: r.display_name,
    mask: r.last4 ?? '',
    card_product_id: product.id,
    match_source: r.match_source,
    priority: r.priority,
    current_balance_cents: num(r.current_balance_cents),
    credit_limit_cents: num(r.credit_limit_cents),
    points_balance: 0, // not tracked for simulated funding accounts
    is_active: r.status === 'ACTIVE',
    financial_account_id: r.financial_account_id,
    card_product: product,
  };
}

export function toOneTapCard(r: { id: string; display_id: string; status: string; uid_masked: string | null }): OneTapCardRow {
  return {
    id: r.id,
    last4: r.display_id.replace(/[^0-9A-Z]/gi, '').slice(-4),
    state: r.status === 'FROZEN' ? 'paused' : 'open',
    physical_linked: r.uid_masked != null,
  };
}

export function toCardSpending(r: Omit<CardSpendingRow, 'amount_cents'> & { amount_cents: Numeric }): CardSpendingRow {
  return { ...r, amount_cents: num(r.amount_cents) };
}

/** First day of the phone's current month, as Plaid dates are written (YYYY-MM-DD). */
export const monthStart = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

export function toProfile(r: { id: string; full_name: string | null; routing_mode: RoutingMode; manual_card_id: string | null; default_card_id: string | null }): ProfileRow {
  return {
    id: r.id,
    display_name: r.full_name,
    routing_mode: r.routing_mode,
    manual_card_id: r.manual_card_id,
    default_card_id: r.default_card_id,
    onboarding_step: 'done', // setup progress lives in the auth user's metadata (auth.ts), not on profiles
  };
}

/** The columns the app may write on profiles (app_preferences migration). */
export function toProfilePatch(patch: Partial<ProfileRow>) {
  const out: Record<string, unknown> = {};
  if ('display_name' in patch) out.full_name = patch.display_name;
  for (const k of ['routing_mode', 'manual_card_id', 'default_card_id'] as const) if (k in patch) out[k] = patch[k];
  return out;
}

/** Only routed payments become transaction rows: the receipt needs the routing decision. */
export const isRouted = (r: Pick<DbPayment, 'decision_reason'>) => r.decision_reason != null;

export function toTransaction(r: DbPayment): TransactionRow {
  return {
    id: r.id,
    user_id: r.user_id ?? '',
    onetap_card_id: r.reclaimed_card_id ?? '',
    lithic_token: r.processor === 'lithic_sandbox' ? r.processor_reference : null,
    merchant_id: r.merchant_id,
    merchant_name: r.merchant_name,
    mcc: r.mcc,
    category_id: (r.category_id ?? 'general') as CategoryId,
    amount_cents: num(r.amount_cents),
    routed_card_id: r.funding_account_id ?? '',
    routing_mode: (r.routing_mode ?? 'auto') as RoutingMode,
    decision_reason: (r.decision_reason ?? 'best_rate') as DecisionReason,
    multiplier: num(r.multiplier),
    points_earned: num(r.points_earned),
    reward_value_cents: num(r.reward_value_cents),
    baseline_value_cents: num(r.baseline_value_cents),
    best_value_cents: num(r.best_value_cents),
    alternatives: r.alternatives?.map(
      (a): Alternative => ({ user_card_id: a.funding_account_id, card_name: a.name, mask: a.last4 ?? '', multiplier: num(a.multiplier), value_cents: num(a.value_cents) }),
    ) ?? null,
    status: r.state === 'DECLINED' || r.state === 'FAILED' ? 'declined' : 'approved',
    is_seeded: r.is_seeded,
    created_at: r.created_at,
  };
}

// ---------- Live reads (Supabase with the user's session; RLS limits them to the user's rows) ----------

async function must<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export const live = {
  profile: async () =>
    toProfile(await must(supabase.from('profiles').select('id, full_name, routing_mode, manual_card_id, default_card_id').single())),

  userCards: async () =>
    (await must<DbFundingAccount[]>(supabase.from('mock_funding_accounts').select(FUNDING_COLUMNS).eq('kind', 'CREDIT').neq('status', 'CLOSED').order('priority'))).map(toUserCard),

  userCard: async (id: string) => toUserCard(await must(supabase.from('mock_funding_accounts').select(FUNDING_COLUMNS).eq('id', id).single())),

  rates: async () =>
    (
      await must<{ category_id: CategoryId; multiplier: Numeric; card_product: { product_slug: string } | null }[]>(
        supabase.from('card_product_rates').select('category_id, multiplier, card_product:card_products(product_slug)'),
      )
    ).flatMap((r): CardProductRate[] =>
      r.card_product ? [{ card_product_id: appProductId(r.card_product.product_slug), category_id: r.category_id, multiplier: num(r.multiplier) }] : [],
    ),

  // The card with the physical card attached wins; otherwise the newest (the digital card).
  oneTapCard: async () => {
    const rows = await must<{ id: string; display_id: string; status: string; uid_masked: string | null }[]>(
      supabase.from('reclaimed_cards').select('id, display_id, status, uid_masked').in('status', ['ACTIVE', 'FROZEN']).order('created_at', { ascending: false }).limit(5),
    );
    const row = rows.find((r) => r.uid_masked != null) ?? rows[0];
    return row ? toOneTapCard(row) : null;
  },

  cardSpending: async (now = new Date()) =>
    (
      await must<Parameters<typeof toCardSpending>[0][]>(
        supabase
          .from('card_spending')
          .select('id, financial_account_id, account_name, mask, merchant, amount_cents, date, pending, category_id')
          .gte('date', monthStart(now))
          .order('date', { ascending: false })
          .limit(500),
      )
    ).map(toCardSpending),

  transactions: async () =>
    (
      await must<DbPayment[]>(
        supabase.from('payment_transactions').select(PAYMENT_COLUMNS).not('decision_reason', 'is', null).order('created_at', { ascending: false }).limit(200),
      )
    ).map(toTransaction),

  transaction: async (id: string) => toTransaction(await must(supabase.from('payment_transactions').select(PAYMENT_COLUMNS).eq('id', id).single())),

  updateProfile: async (id: string, patch: Partial<ProfileRow>) =>
    toProfile(
      await must(supabase.from('profiles').update(toProfilePatch(patch)).eq('id', id).select('id, full_name, routing_mode, manual_card_id, default_card_id').single()),
    ),

  setCardOrder: async (order: string[]) => {
    await Promise.all(order.map((id, i) => must(supabase.from('mock_funding_accounts').update({ priority: i + 1 }).eq('id', id).select('id'))));
    return order;
  },

  setCardProduct: async (cardId: string, appId: string) => {
    const product = await must<{ id: string }>(supabase.from('card_products').select('id').eq('product_slug', productSlug(appId)).single());
    return toUserCard(
      await must(supabase.from('mock_funding_accounts').update({ card_product_id: product.id, match_source: 'user' }).eq('id', cardId).select(FUNDING_COLUMNS).single()),
    );
  },
};
