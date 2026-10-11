import { CATEGORIES } from './categories';
import type { CardSpendingRow, CategoryId } from './types';

export type DashboardSummary = {
  totalSpendCents: number;
  purchases: number;
  cardCount: number;
  byCategory: { id: CategoryId; label: string; cents: number }[];
  byCard: { id: string; label: string; cents: number }[];
  recent: CardSpendingRow[];
};

// "This month" = the phone's calendar month, matched on Plaid's YYYY-MM-DD dates.
export function summarizeCards(rows: CardSpendingRow[], now = new Date()): DashboardSummary {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const inMonth = rows.filter((r) => r.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));

  const byCat = new Map<CategoryId, number>();
  const byCard = new Map<string, { label: string; cents: number }>();
  let total = 0;
  for (const r of inMonth) {
    total += r.amount_cents;
    byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + r.amount_cents);
    const card = byCard.get(r.financial_account_id) ?? { label: r.mask ? `${r.account_name} •••• ${r.mask}` : r.account_name, cents: 0 };
    byCard.set(r.financial_account_id, { ...card, cents: card.cents + r.amount_cents });
  }

  return {
    totalSpendCents: total,
    purchases: inMonth.length,
    cardCount: byCard.size,
    byCategory: [...byCat].map(([id, cents]) => ({ id, label: CATEGORIES[id].label, cents })).sort((a, b) => b.cents - a.cents),
    byCard: [...byCard].map(([id, c]) => ({ id, ...c })).sort((a, b) => b.cents - a.cents),
    recent: inMonth.slice(0, 5),
  };
}
