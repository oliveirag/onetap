import { emptySeen, markSeen, shouldOpenSheet } from './seen';

const now = new Date('2026-10-10T20:00:00Z');
const tx = (id: string, secondsAgo: number, is_seeded = false) => ({
  id,
  is_seeded,
  created_at: new Date(now.getTime() - secondsAgo * 1000).toISOString(),
});

it('opens for a fresh unseen live transaction', () => {
  expect(shouldOpenSheet(tx('a', 2), emptySeen, now)).toBe(true);
});

it('never opens twice for the same id', () => {
  expect(shouldOpenSheet(tx('a', 2), markSeen(emptySeen, 'a'), now)).toBe(false);
});

it('does not open for rows older than 60 seconds (reconnect refetch)', () => {
  expect(shouldOpenSheet(tx('b', 61), emptySeen, now)).toBe(false);
});

it('never opens for seeded history', () => {
  expect(shouldOpenSheet(tx('c', 1, true), emptySeen, now)).toBe(false);
});

it('does not mutate the previous seen state', () => {
  const s = markSeen(emptySeen, 'a');
  expect(emptySeen.has('a')).toBe(false);
  expect(s.has('a')).toBe(true);
});
