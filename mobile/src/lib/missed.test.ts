import { missedRewards } from './missed';
import { mockCards, mockRates } from './mocks/fixtures';
import type { CardSpendingRow } from './types';

let n = 0;
const row = (p: Partial<CardSpendingRow>): CardSpendingRow => ({
  id: String(n++),
  financial_account_id: 'fa-card-active',
  account_name: 'Wells Fargo Active Cash Card',
  mask: '7731',
  merchant: 'Knight Bites',
  amount_cents: 1300,
  date: '2026-10-10',
  pending: false,
  category_id: 'dining',
  ...p,
});

it('totals what the best card would have earned beyond the card used', () => {
  // Dining $13.00: Amex 4x = 52, Active Cash 2x = 26 -> 26 missed. Gas $41.75: Citi 5x = 209, Active 2x = 84 -> 125.
  const m = missedRewards([row({}), row({ category_id: 'gas', amount_cents: 4175, merchant: 'Sunshine Fuel' })], mockCards, mockRates);
  expect(m).toEqual({
    missedCents: 151,
    purchases: 2,
    topCategory: { id: 'gas', cents: 125 },
    worst: { merchant: 'Sunshine Fuel', usedName: 'Active Cash', bestName: 'Custom Cash', cents: 125 },
  });
});

it('counts nothing missed when the best card was used', () => {
  const m = missedRewards([row({ financial_account_id: 'fa-card-amex' })], mockCards, mockRates);
  expect(m).toMatchObject({ missedCents: 0, purchases: 1, topCategory: null, worst: null });
});

it('skips purchases on cards OneTap does not know, and returns null when none remain', () => {
  expect(missedRewards([row({ financial_account_id: 'fa-unknown' })], mockCards, mockRates)).toBeNull();
  expect(missedRewards([], mockCards, mockRates)).toBeNull();
});

it('weighs cents per point like the router', () => {
  const rich = mockCards.map((c) => (c.id === 'card-sapphire' ? { ...c, card_product: { ...c.card_product!, cents_per_point: 1.5 } } : c));
  // Dining $13.00: Sapphire 3x at 1.5 = 59 beats Amex 52; Active Cash earned 26 -> 33 missed.
  expect(missedRewards([row({})], rich, mockRates)?.worst).toMatchObject({ bestName: 'Sapphire Preferred', cents: 33 });
});
