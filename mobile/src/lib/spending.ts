import { CATEGORIES } from './categories';
import type { CategoryId, TransactionRow, UserCardRow } from './types';

export type SpendingSummary = {
  totalSpendCents: number;
  rewardsCents: number;
  extraCents: number;
  hasSeeded: boolean;
  byCategory: { id: CategoryId; label: string; cents: number }[];
  byCard: { id: string; name: string; cents: number }[];
};

// "This month" = approved transactions in the current UTC calendar month.
// Relay (Sultan) must use the same definition so the Assistant matches this screen exactly.
export function aggregate(txs: TransactionRow[], cards: UserCardRow[], now = new Date()): SpendingSummary {
  const month = txs.filter((t) => {
    const d = new Date(t.created_at);
    return t.status === 'approved' && d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
  });

  const byCat = new Map<CategoryId, number>();
  const byCard = new Map<string, number>();
  let total = 0;
  let rewards = 0;
  let baseline = 0;
  for (const t of month) {
    total += t.amount_cents;
    rewards += t.reward_value_cents;
    baseline += t.baseline_value_cents;
    byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + t.amount_cents);
    byCard.set(t.routed_card_id, (byCard.get(t.routed_card_id) ?? 0) + t.amount_cents);
  }

  const names = new Map(cards.map((c) => [c.id, c.account_name]));
  return {
    totalSpendCents: total,
    rewardsCents: rewards,
    extraCents: rewards - baseline,
    hasSeeded: month.some((t) => t.is_seeded),
    byCategory: [...byCat].map(([id, cents]) => ({ id, label: CATEGORIES[id].label, cents })).sort((a, b) => b.cents - a.cents),
    byCard: [...byCard].map(([id, cents]) => ({ id, name: names.get(id) ?? 'Unknown card', cents })).sort((a, b) => b.cents - a.cents),
  };
}
