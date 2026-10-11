import { CATEGORIES } from './categories';
import type { CategoryId, TransactionRow, UserCardRow } from './types';

// One sentence about this month, from a fixed template (never Claude), so its numbers are the
// screen's numbers.
export type Insight = {
  rule: 'one_category' | 'top_reclaimed' | 'top_spend';
  category: CategoryId;
  percent: number;
  amountCents: number;
  sentence: string;
  isDemoHistory: boolean;
};

export type SpendingSummary = {
  totalSpendCents: number;
  rewardsCents: number;
  extraCents: number;
  hasSeeded: boolean;
  /** Last 30 days of extra value x 365 / 30, whole dollars. An estimate; null until it means something. */
  projectionDollars: number | null;
  insight: Insight | null;
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
    projectionDollars: projectYearly(txs, now),
    insight: insight(month),
    byCategory: [...byCat].map(([id, cents]) => ({ id, label: CATEGORIES[id].label, cents })).sort((a, b) => b.cents - a.cents),
    byCard: [...byCard].map(([id, cents]) => ({ id, name: names.get(id) ?? 'Unknown card', cents })).sort((a, b) => b.cents - a.cents),
  };
}

const DAY = 24 * 3600 * 1000;
const extra = (t: TransactionRow) => t.reward_value_cents - t.baseline_value_cents;

// Hidden while the history is under 7 days old (too little to extrapolate) or the pace isn't positive.
export function projectYearly(txs: TransactionRow[], now = new Date()): number | null {
  if (!txs.length) return null;
  const first = Math.min(...txs.map((t) => new Date(t.created_at).getTime()));
  if (now.getTime() - first < 7 * DAY) return null;
  const since = now.getTime() - 30 * DAY;
  const last30 = txs.filter((t) => t.status === 'approved' && new Date(t.created_at).getTime() >= since).reduce((sum, t) => sum + extra(t), 0);
  return last30 > 0 ? Math.round((last30 * 365) / 30 / 100) : null;
}

const ORDER = Object.keys(CATEGORIES) as CategoryId[];
const pct = (part: number, whole: number) => Math.round((part * 100) / whole);

// First rule that applies: one category only; the category where routing earned the most; the
// biggest category. No purchases this month: no insight (the screen shows its empty state).
export function insight(month: TransactionRow[]): Insight | null {
  if (!month.length) return null;
  const cats = new Map<CategoryId, { spend: number; extra: number }>();
  let total = 0;
  for (const t of month) {
    const c = cats.get(t.category_id) ?? { spend: 0, extra: 0 };
    cats.set(t.category_id, { spend: c.spend + t.amount_cents, extra: c.extra + extra(t) });
    total += t.amount_cents;
  }
  const rows = [...cats].map(([id, c]) => ({ id, ...c })).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const isDemoHistory = month.filter((t) => t.is_seeded).length * 2 > month.length;
  const label = (id: CategoryId) => CATEGORIES[id].label;

  if (rows.length === 1 && rows[0].extra > 0) {
    const r = rows[0];
    return {
      rule: 'one_category', category: r.id, percent: 100, amountCents: r.extra, isDemoHistory,
      sentence: `All ${label(r.id).toLowerCase()} this month.`,
    };
  }
  const top = rows.filter((r) => r.extra > 0).sort((a, b) => b.extra - a.extra || b.spend - a.spend)[0];
  if (top) {
    return {
      rule: 'top_reclaimed', category: top.id, percent: pct(top.spend, total), amountCents: top.extra, isDemoHistory,
      sentence: `${label(top.id)}: ${pct(top.spend, total)}% of OneTap spend.`,
    };
  }
  const big = [...rows].sort((a, b) => b.spend - a.spend || b.extra - a.extra)[0];
  return {
    rule: 'top_spend', category: big.id, percent: pct(big.spend, total), amountCents: big.spend, isDemoHistory,
    sentence: `${label(big.id)}: ${pct(big.spend, total)}% of OneTap spend.`,
  };
}
