import type { ProfileRow, TransactionRow, UserCardRow } from '../types';
import { mockEmitter } from './emitter';
import { randomMerchant, routeMock } from './fixtures';
import { mockStore } from './store';

// Dev-only stand-in for a tap at the store: routes a random merchant with the current mode and
// cards, stores it, and pushes it through the same path a Realtime UPDATE takes. Like the backend's
// Stripe test-mode charge, a second update follows with the charge outcome.
export function fakeTap(profile: ProfileRow, cards: UserCardRow[]) {
  const tx: TransactionRow = { ...routeMock(randomMerchant(), cards, profile, new Date()), charge_status: 'pending', charged_card_id: null };
  mockStore.addTransaction(tx);
  mockEmitter.emit(tx);
  setTimeout(() => {
    const charged: TransactionRow = { ...tx, charge_status: 'succeeded', charged_card_id: tx.routed_card_id };
    mockStore.addTransaction(charged);
    mockEmitter.emit(charged);
  }, 800);
  return tx;
}
