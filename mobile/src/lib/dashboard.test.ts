import { summarizeCards } from './dashboard';
import type { CardSpendingRow } from './types';

const row = (over: Partial<CardSpendingRow>): CardSpendingRow => ({
  id: Math.random().toString(36),
  financial_account_id: 'gold',
  account_name: 'Gold Card',
  mask: '1008',
  merchant: 'Shop',
  amount_cents: 1_000,
  date: '2026-10-05',
  pending: false,
  category_id: 'general',
  ...over,
});

describe('summarizeCards', () => {
  const now = new Date(2026, 9, 10);

  it('totals this month by category and by card, largest first', () => {
    const s = summarizeCards(
      [
        row({ amount_cents: 5_000, category_id: 'groceries' }),
        row({ amount_cents: 1_500, category_id: 'dining', financial_account_id: 'csp', account_name: 'Sapphire', mask: null }),
        row({ amount_cents: 2_500, category_id: 'dining' }),
        row({ amount_cents: 9_999, date: '2026-09-30' }), // last month
      ],
      now,
    );
    expect(s.totalSpendCents).toBe(9_000);
    expect(s.purchases).toBe(3);
    expect(s.cardCount).toBe(2);
    expect(s.byCategory).toEqual([
      { id: 'groceries', label: 'Groceries', cents: 5_000 },
      { id: 'dining', label: 'Dining', cents: 4_000 },
    ]);
    expect(s.byCard).toEqual([
      { id: 'gold', label: 'Gold Card •••• 1008', cents: 7_500 },
      { id: 'csp', label: 'Sapphire', cents: 1_500 },
    ]);
  });


  it('is empty with no purchases this month', () => {
    expect(summarizeCards([], now)).toMatchObject({ totalSpendCents: 0, purchases: 0, cardCount: 0, byCategory: [], byCard: [] });
  });
});
