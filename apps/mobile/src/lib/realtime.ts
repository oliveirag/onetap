import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeServerMessage } from '@reclaimed/shared';
import { env } from './env';
import { supabase } from './supabase';
import { qk } from './queries';

/**
 * Authenticated WebSocket to /api/v1/realtime. Events invalidate the matching
 * TanStack queries so screens update the moment a physical tap is authorized.
 */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || closed) return;
      ws = new WebSocket(`${env.apiUrl.replace(/^http/, 'ws')}/api/v1/realtime`);
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', accessToken: token }));
      ws.onmessage = (m) => {
        const msg = JSON.parse(String(m.data)) as RealtimeServerMessage;
        if (msg.type !== 'event') return;
        const e = msg.event;
        switch (e.type) {
          case 'payment.updated':
            void qc.invalidateQueries({ queryKey: ['sim-txns'] });
            void qc.invalidateQueries({ queryKey: qk.simTxn(e.transaction.id) });
            void qc.invalidateQueries({ queryKey: qk.funding });
            void qc.invalidateQueries({ queryKey: qk.dashboard });
            void qc.invalidateQueries({ queryKey: qk.hardware });
            break;
          case 'enrollment.updated':
            qc.setQueryData(qk.enrollment(e.enrollment.id), e.enrollment);
            void qc.invalidateQueries({ queryKey: qk.cards });
            break;
          case 'card.updated':
            void qc.invalidateQueries({ queryKey: qk.cards });
            break;
          case 'bill_payment.updated':
            void qc.invalidateQueries({ queryKey: qk.billPayment(e.billPaymentId) });
            void qc.invalidateQueries({ queryKey: qk.billPayments });
            void qc.invalidateQueries({ queryKey: qk.funding });
            break;
          case 'plaid.synced':
            void qc.invalidateQueries({ queryKey: ['accounts'] });
            void qc.invalidateQueries({ queryKey: qk.items });
            void qc.invalidateQueries({ queryKey: ['bank-txns'] });
            void qc.invalidateQueries({ queryKey: qk.dashboard });
            break;
          case 'hardware.reader':
          case 'hardware.tap':
            void qc.invalidateQueries({ queryKey: qk.hardware });
            break;
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    void connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [enabled, qc]);
}
