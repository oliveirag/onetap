import type { ProfileRow, TransactionRow, UserCardRow } from '../types';
import { mockCards, mockProfile, mockReclaimedCard, seedTransactions } from './fixtures';

// In-memory stand-in for the user's Supabase rows. Lives for the app session.
let profile: ProfileRow = { ...mockProfile };
const cards: UserCardRow[] = mockCards.map((c) => ({ ...c }));
let transactions: TransactionRow[] = seedTransactions(new Date());

export const mockStore = {
  profile: () => ({ ...profile }),
  cards: () => cards.map((c) => ({ ...c })),
  reclaimedCard: () => ({ ...mockReclaimedCard }),
  transactions: () => [...transactions],
  updateProfile(patch: Partial<ProfileRow>) {
    profile = { ...profile, ...patch };
    return { ...profile };
  },
  addTransaction(tx: TransactionRow) {
    if (!transactions.some((t) => t.id === tx.id)) transactions = [tx, ...transactions];
  },
};
