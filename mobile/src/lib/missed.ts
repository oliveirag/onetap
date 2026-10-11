import type { CardProductRate, CardSpendingRow, CategoryId, UserCardRow } from './types';

export type MissedRewards = {
  /** What the best of the user's cards would have earned, minus what the card used earned. Never negative. */
  missedCents: number;
  purchases: number;
  topCategory: { id: CategoryId; cents: number } | null;
  /** The single purchase that left the most behind, for one concrete example. */
  worst: { merchant: string; usedName: string; bestName: string; cents: number } | null;
};

// "Money you left on the table": the Plaid purchases on the user's connected cards, re-run through
// the rule Auto uses (multiplier x cents per point, missing rate = 1x, ties to card order) and the
// router's rounding (payment-core rewardValueCents). Purchases on a card OneTap doesn't know are skipped.
export function missedRewards(rows: CardSpendingRow[], cards: UserCardRow[], rates: CardProductRate[]): MissedRewards | null {
  const usable = cards.filter((c) => c.is_active);
  const byAccount = new Map(cards.flatMap((c) => (c.financial_account_id ? [[c.financial_account_id, c] as const] : [])));
  const rate = new Map(rates.map((r) => [`${r.card_product_id}:${r.category_id}`, r.multiplier]));
  const value = (c: UserCardRow, cat: CategoryId, cents: number) =>
    Math.round((cents * (rate.get(`${c.card_product_id}:${cat}`) ?? 1) * (c.card_product?.cents_per_point ?? 1)) / 100);
  const name = (c: UserCardRow) => c.card_product?.name ?? c.account_name;

  let missed = 0;
  let purchases = 0;
  const byCat = new Map<CategoryId, number>();
  let worst: MissedRewards['worst'] = null;
  for (const r of rows) {
    const used = byAccount.get(r.financial_account_id);
    if (!used || r.amount_cents <= 0 || !usable.length) continue;
    const best = [...usable].sort((a, b) => value(b, r.category_id, r.amount_cents) - value(a, r.category_id, r.amount_cents) || a.priority - b.priority)[0];
    const gap = Math.max(0, value(best, r.category_id, r.amount_cents) - value(used, r.category_id, r.amount_cents));
    purchases++;
    missed += gap;
    if (gap > 0) byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + gap);
    if (gap > (worst?.cents ?? 0)) worst = { merchant: r.merchant, usedName: name(used), bestName: name(best), cents: gap };
  }
  if (!purchases) return null;
  const [top] = [...byCat].sort((a, b) => b[1] - a[1]);
  return { missedCents: missed, purchases, topCategory: top ? { id: top[0], cents: top[1] } : null, worst };
}
