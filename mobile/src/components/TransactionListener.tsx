import { useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

import { isRouted, toTransaction, type DbPayment } from '@/lib/backend';
import { haptics } from '@/lib/haptics';
import { mockEmitter } from '@/lib/mocks/emitter';
import { keys, useTransactions } from '@/lib/queries';
import { emptySeen, markSeen, shouldOpenSheet, type SeenState } from '@/lib/seen';
import { supabase, USE_MOCKS } from '@/lib/supabase';
import type { TransactionRow } from '@/lib/types';

// One global subscriber, so the receipt opens from any tab (PRD F6).
export function TransactionListener({ userId }: { userId: string | null }) {
  const qc = useQueryClient();
  const txs = useTransactions();
  const seen = useRef<SeenState>(emptySeen);
  const primed = useRef(false);
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  const open = useCallback((tx: TransactionRow) => {
    if (!shouldOpenSheet(tx, seen.current)) return;
    seen.current = markSeen(seen.current, tx.id);
    haptics.resultArrived(); // same frame as the sheet is presented (causality + harmony)
    const href = { pathname: '/result/[id]', params: { id: tx.id } } as const;
    // Replace an open receipt instead of stacking a second sheet.
    if (path.current.startsWith('/result/')) router.replace(href);
    else router.push(href);
  }, []);

  // First load: everything already in the feed counts as seen.
  // Later loads (reconnect, foreground): a fresh unseen row still opens, so a tap made offline isn't lost.
  useEffect(() => {
    if (!txs.data) return;
    if (!primed.current) {
      primed.current = true;
      seen.current = new Set([...seen.current, ...txs.data.map((t) => t.id)]);
      return;
    }
    if (txs.data[0]) open(txs.data[0]);
  }, [txs.data, open]);

  useEffect(() => {
    if (!userId && !USE_MOCKS) return;

    const handle = (tx: TransactionRow) => {
      qc.setQueryData<TransactionRow[]>(keys.transactions, (old = []) => (old.some((t) => t.id === tx.id) ? old : [tx, ...old]));
      qc.setQueryData(keys.transaction(tx.id), tx);
      open(tx);
    };

    if (USE_MOCKS) return mockEmitter.on(handle);

    // The backend writes the routing decision onto the checkout's payment row in one UPDATE.
    const channel = supabase
      .channel(`tx-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'payment_transactions', filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new as DbPayment;
        if (isRouted(row)) handle(toTransaction(row));
      })
      .subscribe((status) => {
        // Catch rows that landed while the socket was down.
        if (status === 'SUBSCRIBED') qc.invalidateQueries({ queryKey: keys.transactions });
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc, open]);

  return null;
}
