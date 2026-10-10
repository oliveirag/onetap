import type { ProfileRow, TransactionRow, UserCardRow } from '../types';
import { mockCards, mockProfile, mockRates, mockReclaimedCard, seedTransactions } from './fixtures';

// In-memory stand-in for the user's Supabase rows. Lives for the app session.
let profile: ProfileRow = { ...mockProfile };
const cards: UserCardRow[] = mockCards.map((c) => ({ ...c }));
let transactions: TransactionRow[] = seedTransactions(new Date());

export const mockStore = {
  profile: () => ({ ...profile }),
  cards: () => cards.map((c) => ({ ...c })),
  reclaimedCard: () => ({ ...mockReclaimedCard }),
  rates: () => mockRates.map((r) => ({ ...r })),
  transactions: () => [...transactions],
  updateProfile(patch: Partial<ProfileRow>) {
    profile = { ...profile, ...patch };
    return { ...profile };
  },
  // Card order = priority (1 first). Lower priority wins routing ties.
  setCardOrder(ids: string[]) {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const next = ids.map((id, i) => ({ ...byId.get(id)!, priority: i + 1 }));
    cards.splice(0, cards.length, ...next);
    return ids;
  },
  addTransaction(tx: TransactionRow) {
    if (!transactions.some((t) => t.id === tx.id)) transactions = [tx, ...transactions];
  },
};
