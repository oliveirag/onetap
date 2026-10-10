import { buildReceipt } from './receipt';
import type { TransactionRow } from './types';

const base: TransactionRow = {
  id: 't1',
  user_id: 'u',
  reclaimed_card_id: 'r',
  lithic_token: 'l1',
  merchant_id: 'm',
  merchant_name: 'Knight Bites',
  mcc: '5812',
  category_id: 'dining',
  amount_cents: 1300,
  routed_card_id: 'card-amex',
  routing_mode: 'auto',
  decision_reason: 'best_rate',
  multiplier: 4,
  points_earned: 52,
  reward_value_cents: 52,
  baseline_value_cents: 26,
  best_value_cents: 52,
  alternatives: [
    { user_card_id: 'card-citi', card_name: 'Custom Cash', mask: '2290', multiplier: 1, value_cents: 13 },
    { user_card_id: 'card-sapphire', card_name: 'Sapphire Preferred', mask: '4417', multiplier: 3, value_cents: 39 },
    { user_card_id: 'card-active', card_name: 'Active Cash', mask: '7731', multiplier: 2, value_cents: 26 },
  ],
  status: 'approved',
  is_seeded: false,
  created_at: '2026-10-10T20:14:00Z',
};

it('puts the chosen card first and sorts the others by value', () => {
  const r = buildReceipt(base, 'Amex Gold');
  expect(r.lines.map((l) => [l.name, l.chosen])).toEqual([
    ['Amex Gold', true],
    ['Sapphire Preferred', false],
    ['Active Cash', false],
    ['Custom Cash', false],
  ]);
});

it('has no reason note for a plain best-rate decision', () => {
  expect(buildReceipt(base, 'Amex Gold').reasonNote).toBeNull();
});

it.each([
  ['tie_priority', 'Tied with another card. Your card order broke the tie.'],
  ['manual', 'You chose this card in Manual mode.'],
  ['fallback_default', 'Your chosen card was unavailable, so your default card was used.'],
] as const)('explains %s', (reason, note) => {
  expect(buildReceipt({ ...base, decision_reason: reason }, 'Amex Gold').reasonNote).toBe(note);
});

it('shows what Auto would have earned only in Manual mode when Auto was better', () => {
  const manual = { ...base, routing_mode: 'manual' as const, decision_reason: 'manual' as const, routed_card_id: 'card-citi', reward_value_cents: 13, multiplier: 1 };
  expect(buildReceipt(manual, 'Custom Cash').autoNote).toBe('Auto would have earned +$0.52.');
  expect(buildReceipt({ ...manual, best_value_cents: 13 }, 'Custom Cash').autoNote).toBeNull();
  expect(buildReceipt(base, 'Amex Gold').autoNote).toBeNull();
});

it('handles missing alternatives without crashing', () => {
  const r = buildReceipt({ ...base, alternatives: null }, 'Amex Gold');
  expect(r.lines).toHaveLength(1);
  expect(r.hasComparison).toBe(false);
});

it('builds the spoken summary for VoiceOver', () => {
  expect(buildReceipt(base, 'Amex Gold').summary).toBe('Routed to Amex Gold, 4 times dining, plus $0.52');
});
