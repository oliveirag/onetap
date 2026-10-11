import { aggregate, insight, projectYearly } from './spending';
import type { TransactionRow, UserCardRow } from './types';

let n = 0;
const tx = (p: Partial<TransactionRow>): TransactionRow => ({
  id: String(n++),
  user_id: 'u',
  onetap_card_id: 'r',
  lithic_token: null,
  merchant_id: null,
  merchant_name: 'Knight Bites',
  mcc: '5812',
  category_id: 'dining',
  amount_cents: 1300,
  routed_card_id: 'amex',
  routing_mode: 'auto',
  decision_reason: 'best_rate',
  multiplier: 4,
  points_earned: 52,
  reward_value_cents: 52,
  baseline_value_cents: 13,
  best_value_cents: 52,
  alternatives: [],
  status: 'approved',
  is_seeded: false,
  created_at: '2026-10-10T12:00:00Z',
  ...p,
});
const cards = [
  { id: 'amex', account_name: 'Amex Gold' },
  { id: 'citi', account_name: 'Citi Custom Cash' },
] as UserCardRow[];

it('totals spend, rewards and extra value for the current month only', () => {
  const s = aggregate(
    [
      tx({}),
      tx({ category_id: 'gas', amount_cents: 4175, routed_card_id: 'citi', reward_value_cents: 209, baseline_value_cents: 42 }),
      tx({ created_at: '2026-09-20T12:00:00Z' }),
      tx({ status: 'declined' }),
    ],
    cards,
    new Date('2026-10-10T18:00:00Z'),
  );
  expect(s.totalSpendCents).toBe(5475);
  expect(s.rewardsCents).toBe(261);
  expect(s.extraCents).toBe(261 - 55);
  expect(s.byCategory[0]).toEqual({ id: 'gas', label: 'Gas', cents: 4175 });
  expect(s.byCard.map((c) => c.name)).toEqual(['Citi Custom Cash', 'Amex Gold']);
  expect(s.hasSeeded).toBe(false);
});

it('flags seeded demo history', () => {
  expect(aggregate([tx({ is_seeded: true })], cards, new Date('2026-10-10T18:00:00Z')).hasSeeded).toBe(true);
});

it('returns an empty summary for no transactions', () => {
  const s = aggregate([], cards, new Date());
  expect(s.totalSpendCents).toBe(0);
  expect(s.byCategory).toEqual([]);
  expect(s.byCard).toEqual([]);
});

const NOW = new Date('2026-10-10T18:00:00Z');

it('projects a year of extra value from the last 30 days, once the history is a week old', () => {
  // 3000 cents extra in the last 30 days -> 3000 x 365 / 30 = 36500 cents = $365.
  const old = tx({ created_at: '2026-09-01T12:00:00Z', reward_value_cents: 0, baseline_value_cents: 0 });
  const recent = tx({ created_at: '2026-10-05T12:00:00Z', reward_value_cents: 3100, baseline_value_cents: 100 });
  expect(projectYearly([old, recent], NOW)).toBe(365);
  expect(aggregate([old, recent], cards, NOW).projectionDollars).toBe(365);
});

it('hides the projection for young histories and non-positive pace', () => {
  expect(projectYearly([tx({ created_at: '2026-10-08T12:00:00Z' })], NOW)).toBeNull();
  expect(projectYearly([tx({ created_at: '2026-09-01T12:00:00Z', baseline_value_cents: 52 })], NOW)).toBeNull();
  expect(projectYearly([], NOW)).toBeNull();
});

it('writes the one-category insight', () => {
  const i = insight([tx({}), tx({})]);
  expect(i?.rule).toBe('one_category');
  expect(i?.sentence).toBe('All dining this month, $0.78 reclaimed.');
});

it('names the category where routing earned the most, with its share of spending', () => {
  const i = insight([tx({}), tx({ category_id: 'gas', amount_cents: 3900, reward_value_cents: 195, baseline_value_cents: 39 })]);
  expect(i).toMatchObject({ rule: 'top_reclaimed', category: 'gas', percent: 75, amountCents: 156 });
  expect(i?.sentence).toBe('Gas: 75% of OneTap spend, $1.56 reclaimed.');
});

it('falls back to the biggest category when routing earned nothing extra, and flags demo history', () => {
  const i = insight([
    tx({ baseline_value_cents: 52, is_seeded: true }),
    tx({ category_id: 'travel', amount_cents: 3900, reward_value_cents: 78, baseline_value_cents: 78, is_seeded: true }),
  ]);
  expect(i).toMatchObject({ rule: 'top_spend', category: 'travel', percent: 75, isDemoHistory: true });
  expect(i?.sentence).toBe('Travel: 75% of OneTap spend.');
  expect(insight([])).toBeNull();
});
