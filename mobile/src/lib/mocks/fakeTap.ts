import type { ProfileRow, UserCardRow } from '../types';
import { mockEmitter } from './emitter';
import { randomMerchant, routeMock } from './fixtures';
import { mockStore } from './store';

// Dev-only stand-in for a tap at the store: routes a random merchant with the current mode and
// cards, stores it, and pushes it through the same path a Realtime INSERT takes.
export function fakeTap(profile: ProfileRow, cards: UserCardRow[]) {
  const tx = routeMock(randomMerchant(), cards, profile, new Date());
  mockStore.addTransaction(tx);
  mockEmitter.emit(tx);
  return tx;
}
