// Decides whether a transaction should pop the receipt sheet: once per id, live rows only,
// and only while fresh (a tap made while offline still opens if we reconnect within a minute).
export type SeenState = ReadonlySet<string>;

export const emptySeen: SeenState = new Set();

export const markSeen = (s: SeenState, id: string): SeenState => new Set(s).add(id);

export function shouldOpenSheet(tx: { id: string; is_seeded: boolean; created_at: string }, seen: SeenState, now = new Date()) {
  if (tx.is_seeded || seen.has(tx.id)) return false;
  return now.getTime() - new Date(tx.created_at).getTime() <= 60_000;
}
