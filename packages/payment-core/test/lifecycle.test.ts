import { describe, expect, it } from 'vitest';
import { authInput, createCard, createFunding, createUser, fundingRow, setup, WALMART } from './helpers.js';

async function approved(amountCents = 10_000) {
  const ctx = await setup();
  const user = await createUser(ctx.db);
  const citi = await createFunding(ctx.db, user, 'Mock Citi', { limit: 200_000 });
  const card = await createCard(ctx.db, user, { primary: citi });
  const txn = await ctx.lifecycle.createCheckout({ terminalId: ctx.terminalId, ...WALMART, amountCents });
  const out = await ctx.auth.authorize(authInput(txn, card));
  expect(out.result).toBe('APPROVED');
  return { ctx, user, citi, card, txn: out.transaction, t: { transactionId: txn.id, terminalId: ctx.terminalId } };
}

describe('PaymentLifecycleService', () => {
  it('captures, settles and fully refunds with balanced journals', async () => {
    const { ctx, citi, t } = await approved();
    const captured = await ctx.lifecycle.capture(t);
    expect(captured.state).toBe('CAPTURED');
    expect(await fundingRow(ctx.db, citi)).toMatchObject({ pending_holds_cents: 0, current_balance_cents: 10_000 });

    expect((await ctx.lifecycle.beginSettlement(t)).state).toBe('SETTLEMENT_PENDING');
    expect((await ctx.lifecycle.completeSettlement(t.transactionId)).state).toBe('SETTLED');
    expect(await ctx.ledger.balance(ctx.db, 'SYS:SETTLEMENT_CASH')).toBe(-10_000);

    const r = await ctx.lifecycle.refund({ ...t, idempotencyKey: 'refund-key-1' });
    expect(r.transaction.state).toBe('REFUNDED');
    expect(r.transaction.refundedCents).toBe(10_000);
    expect((await fundingRow(ctx.db, citi)).current_balance_cents).toBe(0);
    expect(await ctx.ledger.balance(ctx.db, 'SYS:SETTLEMENT_CASH')).toBe(0);
    expect(await ctx.ledger.findUnbalancedJournals(ctx.db)).toEqual([]);

    const journals = await ctx.db.query<{ journal_type: string }>(
      'select journal_type from ledger_journals where payment_transaction_id = $1 order by created_at',
      [t.transactionId],
    );
    expect(journals.rows.map((j) => j.journal_type)).toEqual(['AUTHORIZATION_HOLD', 'CAPTURE', 'SETTLEMENT', 'REFUND']);
  });

  it('supports partial refunds, then a final refund, and rejects over-refunds', async () => {
    const { ctx, t } = await approved();
    await ctx.lifecycle.capture(t);
    const p1 = await ctx.lifecycle.refund({ ...t, amountCents: 2_500, idempotencyKey: 'refund-part-1' });
    expect(p1.transaction.state).toBe('PARTIALLY_REFUNDED');
    await expect(ctx.lifecycle.refund({ ...t, amountCents: 9_000, idempotencyKey: 'refund-too-much' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const p2 = await ctx.lifecycle.refund({ ...t, amountCents: 7_500, idempotencyKey: 'refund-part-2' });
    expect(p2.transaction.state).toBe('REFUNDED');
    await expect(ctx.lifecycle.refund({ ...t, idempotencyKey: 'refund-after' })).rejects.toMatchObject({ code: 'INVALID_PAYMENT_STATE' });
    expect(await ctx.ledger.findUnbalancedJournals(ctx.db)).toEqual([]);
  });

  it('treats a repeated refund idempotency key as a replay', async () => {
    const { ctx, t } = await approved();
    await ctx.lifecycle.capture(t);
    const a = await ctx.lifecycle.refund({ ...t, amountCents: 1_000, idempotencyKey: 'same-key-123' });
    const b = await ctx.lifecycle.refund({ ...t, amountCents: 1_000, idempotencyKey: 'same-key-123' });
    expect(b.replayed).toBe(true);
    expect(b.refundId).toBe(a.refundId);
    const count = await ctx.db.query('select 1 from refund_records where payment_transaction_id = $1', [t.transactionId]);
    expect(count.rowCount).toBe(1);
  });

  it('reverses an authorization and releases the hold', async () => {
    const { ctx, citi, t } = await approved();
    const rev = await ctx.lifecycle.reverse(t);
    expect(rev.state).toBe('REVERSED');
    expect(await fundingRow(ctx.db, citi)).toMatchObject({ pending_holds_cents: 0, current_balance_cents: 0 });
    expect(await ctx.ledger.balance(ctx.db, 'SYS:PENDING_MERCHANT_PAYABLE')).toBe(0);
  });

  it('rejects invalid transitions (refund before capture, capture twice, reverse after capture)', async () => {
    const { ctx, t } = await approved();
    await expect(ctx.lifecycle.refund({ ...t, idempotencyKey: 'too-early-1' })).rejects.toMatchObject({ code: 'INVALID_PAYMENT_STATE' });
    await ctx.lifecycle.capture(t);
    await expect(ctx.lifecycle.capture(t)).rejects.toMatchObject({ code: 'INVALID_PAYMENT_STATE' });
    await expect(ctx.lifecycle.reverse(t)).rejects.toMatchObject({ code: 'INVALID_PAYMENT_STATE' });
  });

  it('settles the net amount after a partial refund before settlement', async () => {
    const { ctx, t } = await approved();
    await ctx.lifecycle.capture(t);
    await ctx.lifecycle.refund({ ...t, amountCents: 4_000, idempotencyKey: 'pre-settle-refund' });
    await ctx.lifecycle.beginSettlement(t);
    const settled = await ctx.lifecycle.completeSettlement(t.transactionId);
    expect(settled.state).toBe('SETTLED');
    expect(await ctx.ledger.balance(ctx.db, 'SYS:SETTLEMENT_CASH')).toBe(-6_000);
    expect(await ctx.ledger.balance(ctx.db, 'SYS:MERCHANT_PAYABLE')).toBe(0);
  });

  it('cancels and expires untapped checkouts', async () => {
    const ctx = await setup({ checkoutTtlMs: 1 });
    const txn = await ctx.lifecycle.createCheckout({ terminalId: ctx.terminalId, ...WALMART, amountCents: 500 });
    await new Promise((r) => setTimeout(r, 10));
    expect(await ctx.lifecycle.expireCheckouts()).toEqual([txn.id]);
    const ctx2 = await setup();
    const t2 = await ctx2.lifecycle.createCheckout({ terminalId: ctx2.terminalId, ...WALMART, amountCents: 500 });
    expect((await ctx2.lifecycle.cancelCheckout({ transactionId: t2.id, terminalId: ctx2.terminalId })).state).toBe('FAILED');
  });

  it('hides transactions from other terminals', async () => {
    const { ctx, t } = await approved();
    await expect(ctx.lifecycle.capture({ ...t, terminalId: '00000000-0000-4000-8000-000000000009' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
