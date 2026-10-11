import type { AppContext } from './context.js';

/**
 * Lightweight in-process schedulers for the simulation: checkout expiry,
 * settlement completion, bill-payment progression, enrollment expiry and Stripe charge retries.
 */
export function startJobs(ctx: AppContext): () => void {
  let running = false;
  let lastChargeSweep = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { lifecycle, billPay, hardware } = ctx.services;
      for (const id of await lifecycle.expireCheckouts()) {
        const t = await ctx.db.query<{ terminal_id: string }>('select terminal_id from payment_transactions where id = $1', [id]);
        if (t.rows[0]) {
          const { loadTransaction, toTransactionDto } = await import('@reclaimed/payment-core');
          const row = await loadTransaction(ctx.db, id);
          if (row) ctx.realtime.toTerminal(t.rows[0].terminal_id, { type: 'payment.updated', transaction: toTransactionDto(row) });
        }
      }
      for (const txn of await lifecycle.completeDueSettlements(ctx.config.SETTLEMENT_DELAY_MS)) {
        ctx.realtime.toTerminal(txn.terminalId, { type: 'payment.updated', transaction: txn });
        const owner = await ctx.db.query<{ user_id: string | null }>('select user_id from payment_transactions where id = $1', [txn.id]);
        if (owner.rows[0]?.user_id) ctx.realtime.toUser(owner.rows[0].user_id, { type: 'payment.updated', transaction: txn });
      }
      for (const c of await billPay.tick()) ctx.realtime.toUser(c.userId, { type: 'bill_payment.updated', billPaymentId: c.id, state: c.state });
      for (const e of await hardware.expireEnrollments()) ctx.realtime.toUser(e.userId, { type: 'enrollment.updated', enrollment: await hardware.enrollmentDto(e.id) });
      if (ctx.services.charges && Date.now() - lastChargeSweep >= 30_000) {
        lastChargeSweep = Date.now();
        // Not awaited: slow Stripe calls must not hold up settlement and the other jobs.
        void ctx.services.charges.resumePending().catch((err) => ctx.logger.error({ err }, 'stripe charge sweep failed'));
      }
    } catch (err) {
      ctx.logger.error({ err }, 'background job tick failed');
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void tick(), 1_000);
  return () => clearInterval(handle);
}
