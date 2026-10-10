import type { TransactionRow } from './types';

export type DayGroup = { key: string; label: string; items: TransactionRow[] };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Activity grouped by the phone's local calendar day, newest first: "Today", "Yesterday",
// then "Mon, Oct 6". Rows keep their incoming order inside each day.
export function groupByDay(txs: TransactionRow[], now = new Date()): DayGroup[] {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: DayGroup[] = [];
  for (const tx of txs) {
    const at = new Date(tx.created_at);
    const key = dayKey(at);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label =
        key === today ? 'Today' : key === yesterday ? 'Yesterday' : at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(tx);
  }
  return groups;
}
