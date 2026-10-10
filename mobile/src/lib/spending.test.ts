import { aggregate } from './spending';
import type { TransactionRow, UserCardRow } from './types';

let n = 0;
const tx = (p: Partial<TransactionRow>): TransactionRow => ({
  id: String(n++),
  user_id: 'u',
  reclaimed_card_id: 'r',
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
