import type { TransactionRow } from '../types';

// Stands in for Supabase Realtime INSERTs in mock mode.
type Listener = (tx: TransactionRow) => void;
const listeners = new Set<Listener>();

export const mockEmitter = {
  on(cb: Listener) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  emit(tx: TransactionRow) {
    listeners.forEach((cb) => cb(tx));
  },
};
