import { groupByDay } from './feed';
import { seedTransactions } from './mocks/fixtures';

const at = (d: Date, id: string) => ({ ...seedTransactions(d)[0], id, created_at: d.toISOString() });

it('labels today and yesterday, then dates, keeping order inside a day', () => {
  const now = new Date(2026, 9, 10, 15, 0);
  const txs = [
    at(new Date(2026, 9, 10, 14, 0), 'a'),
    at(new Date(2026, 9, 10, 9, 0), 'b'),
    at(new Date(2026, 9, 9, 22, 0), 'c'),
    at(new Date(2026, 9, 6, 12, 0), 'd'),
  ];
  const groups = groupByDay(txs, now);
  expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Tue, Oct 6']);
  expect(groups[0].items.map((t) => t.id)).toEqual(['a', 'b']);
});

it('uses the local calendar day across midnight and month starts', () => {
  const now = new Date(2026, 10, 1, 0, 30);
  const groups = groupByDay([at(new Date(2026, 10, 1, 0, 10), 'a'), at(new Date(2026, 9, 31, 23, 50), 'b')], now);
  expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
  expect(groupByDay([], now)).toEqual([]);
});
