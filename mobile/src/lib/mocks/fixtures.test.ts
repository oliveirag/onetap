import { MERCHANTS, mockCards, mockProfile, routeMock, seedTransactions } from './fixtures';

const now = new Date('2026-10-10T20:00:00Z');
const merchant = (name: string) => MERCHANTS.find((m) => m.name === name)!;

it('routes the PRD example: $13.00 dining on Amex Gold 4x earns 52 points, +$0.52', () => {
  const tx = routeMock(merchant('Knight Bites'), mockCards, mockProfile, now);
  expect(tx.routed_card_id).toBe('card-amex');
  expect(tx.multiplier).toBe(4);
  expect(tx.points_earned).toBe(52);
  expect(tx.reward_value_cents).toBe(52);
  expect(tx.decision_reason).toBe('best_rate');
});

it('stores baseline (default card) and best value, and lists the losing cards', () => {
  const tx = routeMock(merchant('Knight Bites'), mockCards, mockProfile, now);
  expect(tx.baseline_value_cents).toBe(26); // Active Cash 2x on $13.00
  expect(tx.best_value_cents).toBe(52);
  expect(tx.alternatives?.map((a) => a.user_card_id).sort()).toEqual(['card-active', 'card-citi', 'card-sapphire']);
});

it('demo cards pick a different winner in at least four of six categories (PRD F3)', () => {
  const winners = new Set(MERCHANTS.map((m) => routeMock(m, mockCards, mockProfile, now).routed_card_id));
  expect(winners.size).toBeGreaterThanOrEqual(4);
});

it('manual mode routes to the chosen card and records what auto would have earned', () => {
  const tx = routeMock(merchant('Knight Bites'), mockCards, { ...mockProfile, routing_mode: 'manual', manual_card_id: 'card-citi' }, now);
  expect(tx.routed_card_id).toBe('card-citi');
  expect(tx.decision_reason).toBe('manual');
  expect(tx.best_value_cents).toBe(52);
});

it('seeds about 40 approved demo rows inside the last 30 days', () => {
  const rows = seedTransactions(now);
  expect(rows).toHaveLength(40);
  expect(rows.every((r) => r.is_seeded && r.status === 'approved')).toBe(true);
  const oldest = Math.min(...rows.map((r) => new Date(r.created_at).getTime()));
  expect(now.getTime() - oldest).toBeLessThanOrEqual(30 * 24 * 3600 * 1000);
  expect(seedTransactions(now)).toEqual(rows); // deterministic
});
