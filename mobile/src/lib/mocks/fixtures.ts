// Typed fake data for EXPO_PUBLIC_USE_MOCKS=1. Mirrors the backend's routing rules (PRD F4) closely
// enough to drive every screen before Supabase and Lithic are live. Swap the cards for Sultan's
// real demo cards once the catalog is entered.
import type { CardProductRate, CategoryId, ProfileRow, OneTapCardRow, TransactionRow, UserCardRow } from '../types';

export const MOCK_USER_ID = 'mock-user';

export type MockMerchant = { id: string; name: string; mcc: string; category_id: CategoryId; amount_cents: number };

// README F5 merchants: fictional names, real category codes, fixed baskets.
export const MERCHANTS: MockMerchant[] = [
  { id: 'm-knight-bites', name: 'Knight Bites', mcc: '5812', category_id: 'dining', amount_cents: 1300 },
  { id: 'm-citrus-coffee', name: 'Citrus Coffee', mcc: '5814', category_id: 'dining', amount_cents: 850 },
  { id: 'm-pegasus-market', name: 'Pegasus Market', mcc: '5411', category_id: 'groceries', amount_cents: 6420 },
  { id: 'm-sunshine-fuel', name: 'Sunshine Fuel', mcc: '5541', category_id: 'gas', amount_cents: 4175 },
  { id: 'm-streambox', name: 'StreamBox', mcc: '4899', category_id: 'streaming', amount_cents: 1599 },
  { id: 'm-orlando-air', name: 'Orlando Air', mcc: '4511', category_id: 'travel', amount_cents: 21800 },
  { id: 'm-lakeside-inn', name: 'Lakeside Inn', mcc: '7011', category_id: 'travel', amount_cents: 12900 },
  { id: 'm-campus-books', name: 'Campus Books', mcc: '5942', category_id: 'general', amount_cents: 8999 },
];

const card = (
  id: string,
  account_name: string,
  mask: string,
  priority: number,
  product: { name: string; issuer: string; network: 'visa' | 'mastercard' | 'amex'; reward_type: 'points' | 'cashback'; reward_currency: string; card_art: string },
  points_balance: number,
): UserCardRow => ({
  id,
  account_name,
  mask,
  card_product_id: `p-${id}`,
  match_source: 'auto',
  priority,
  current_balance_cents: 0,
  credit_limit_cents: 500000,
  points_balance,
  is_active: true,
  card_product: { id: `p-${id}`, cents_per_point: 1, is_generic: false, ...product },
});

export const mockCards: UserCardRow[] = [
  card('card-amex', 'American Express Gold Card', '1008', 1, { name: 'Amex Gold', issuer: 'American Express', network: 'amex', reward_type: 'points', reward_currency: 'Membership Rewards', card_art: 'lines' }, 42000),
  card('card-sapphire', 'Chase Sapphire Preferred', '4417', 2, { name: 'Sapphire Preferred', issuer: 'Chase', network: 'visa', reward_type: 'points', reward_currency: 'Ultimate Rewards', card_art: 'dots' }, 31500),
  card('card-citi', 'Citi Custom Cash Card', '2290', 3, { name: 'Custom Cash', issuer: 'Citi', network: 'mastercard', reward_type: 'points', reward_currency: 'ThankYou Points', card_art: 'grid' }, 8800),
  card('card-active', 'Wells Fargo Active Cash Card', '7731', 4, { name: 'Active Cash', issuer: 'Wells Fargo', network: 'visa', reward_type: 'cashback', reward_currency: 'Cash back', card_art: 'solid' }, 0),
];

// Multipliers per category. Winners: Amex dining/groceries, Sapphire streaming/travel, Citi gas, Active Cash general.
const RATES: Record<string, Record<CategoryId, number>> = {
  'card-amex': { dining: 4, groceries: 4, gas: 1, streaming: 1, travel: 3, general: 1 },
  'card-sapphire': { dining: 3, groceries: 1, gas: 1, streaming: 3, travel: 5, general: 1 },
  'card-citi': { dining: 1, groceries: 1, gas: 5, streaming: 1, travel: 1, general: 1 },
  'card-active': { dining: 2, groceries: 2, gas: 2, streaming: 2, travel: 2, general: 2 },
};

// The same multipliers as card_product_rates rows, keyed by each mock card's product id.
export const mockRates: CardProductRate[] = Object.entries(RATES).flatMap(([cardId, byCategory]) =>
  Object.entries(byCategory).map(([category_id, multiplier]) => ({ card_product_id: `p-${cardId}`, category_id: category_id as CategoryId, multiplier })),
);

export const mockProfile: ProfileRow = {
  id: MOCK_USER_ID,
  display_name: 'Demo',
  routing_mode: 'auto',
  manual_card_id: null,
  default_card_id: 'card-active',
  onboarding_step: 'done',
};

export const mockOneTapCard: OneTapCardRow = { id: 'rc-1', last4: '4821', state: 'open' };

// PRD F4 reward math: points = round(dollars x multiplier); value = round(points x cents per point).
function earn(c: UserCardRow, m: MockMerchant) {
  const multiplier = RATES[c.id]?.[m.category_id] ?? 1;
  const points = Math.round((m.amount_cents * multiplier) / 100);
  return { multiplier, points, value: Math.round(points * (c.card_product?.cents_per_point ?? 1)) };
}

let live = 0;

export function routeMock(m: MockMerchant, cards: UserCardRow[], profile: ProfileRow, now: Date, id?: string): TransactionRow {
  const usable = cards.filter((c) => c.is_active);
  const ranked = [...usable].sort((a, b) => earn(b, m).value - earn(a, m).value || a.priority - b.priority);
  const best = ranked[0];
  const fallback = usable.find((c) => c.id === profile.default_card_id) ?? best;

  let chosen = best;
  let reason: TransactionRow['decision_reason'] = ranked.length > 1 && earn(ranked[1], m).value === earn(best, m).value ? 'tie_priority' : 'best_rate';
  if (profile.routing_mode === 'manual') {
    const manual = usable.find((c) => c.id === profile.manual_card_id);
    chosen = manual ?? fallback;
    reason = manual ? 'manual' : 'fallback_default';
  }

  const won = earn(chosen, m);
  return {
    id: id ?? `mock-${now.getTime()}-${live++}`,
    user_id: profile.id,
    onetap_card_id: mockOneTapCard.id,
    lithic_token: null,
    merchant_id: m.id,
    merchant_name: m.name,
    mcc: m.mcc,
    category_id: m.category_id,
    amount_cents: m.amount_cents,
    routed_card_id: chosen.id,
    routing_mode: profile.routing_mode,
    decision_reason: reason,
    multiplier: won.multiplier,
    points_earned: won.points,
    reward_value_cents: won.value,
    baseline_value_cents: earn(fallback, m).value,
    best_value_cents: earn(best, m).value,
    alternatives: usable
      .filter((c) => c.id !== chosen.id)
      .map((c) => ({ user_card_id: c.id, card_name: c.card_product?.name ?? c.account_name, mask: c.mask, multiplier: earn(c, m).multiplier, value_cents: earn(c, m).value })),
    status: 'approved',
    is_seeded: false,
    created_at: now.toISOString(),
  };
}

// 40 deterministic demo rows spread over the last ~29 days (PRD F8 "Demo history").
export function seedTransactions(now: Date): TransactionRow[] {
  const day = 24 * 3600 * 1000;
  return Array.from({ length: 40 }, (_, i) => {
    const m = MERCHANTS[(i * 5 + 3) % MERCHANTS.length];
    const at = new Date(now.getTime() - (i / 40) * 29 * day - (i % 5) * 2 * 3600 * 1000 - 3600 * 1000);
    return { ...routeMock(m, mockCards, mockProfile, at, `seed-${i}`), is_seeded: true };
  });
}

export function randomMerchant(): MockMerchant {
  return MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
}
