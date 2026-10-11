import { Router } from 'express';
import { createCheckoutSchema, refundSchema, ReclaimedError } from '@reclaimed/shared';
import { loadAuthorizationDto, loadTransaction, toTransactionDto } from '@reclaimed/payment-core';
import type { AppContext } from '../context.js';
import { ok, param, parse } from '../lib/http.js';
import { requireTerminal } from '../middleware/auth.js';
import { idempotencyKey, withIdempotency } from '../lib/idempotency.js';

/** Payment terminal simulator endpoints (HMAC-signed terminal credential). */
export function terminalRoutes(ctx: AppContext): Router {
  const r = Router();
  r.use('/test-terminal', requireTerminal(ctx));
  const lc = ctx.services.lifecycle;

  const publish = async (transactionId: string) => {
    const row = await loadTransaction(ctx.db, transactionId);
    if (!row) return;
    const event = { type: 'payment.updated' as const, transaction: toTransactionDto(row) };
    ctx.realtime.toTerminal(row.terminal_id, event);
    if (row.user_id) ctx.realtime.toUser(row.user_id, event);
  };

  r.get('/test-terminal/status', async (req, res) => ok(res, { terminal: req.terminal, ...(await ctx.services.hardware.status({ terminalId: req.terminal!.id })) }));

  r.post('/test-terminal/transactions', async (req, res) => {
    const body = parse(createCheckoutSchema, req.body);
    const out = await withIdempotency(ctx.db, { scope: 'checkout', ownerId: req.terminal!.id, key: idempotencyKey(req, false), body }, async () => ({
      status: 201,
      data: await lc.createCheckout({ terminalId: req.terminal!.id, ...body }),
    }));
    if (!out.replayed) ctx.realtime.toTerminal(req.terminal!.id, { type: 'payment.updated', transaction: out.data });
    ok(res, out.data, out.status);
  });

  r.get('/test-terminal/transactions/:id', async (req, res) => {
    const row = await loadTransaction(ctx.db, param(req, 'id'));
    if (!row || row.terminal_id !== req.terminal!.id) throw new ReclaimedError('NOT_FOUND', 'Transaction not found for this terminal.');
    ok(res, { transaction: toTransactionDto(row), authorization: await loadAuthorizationDto(ctx.db, { paymentTransactionId: row.id }) });
  });

  const action = (name: string, fn: (id: string, terminalId: string, body: unknown, key: string | null) => Promise<unknown>) =>
    r.post(`/test-terminal/transactions/:id/${name}`, async (req, res) => {
      const id = param(req, 'id');
      const data = await fn(id, req.terminal!.id, req.body ?? {}, idempotencyKey(req, false));
      await publish(id);
      ok(res, data);
    });

  action('capture', (id, terminalId, body) => lc.capture({ transactionId: id, terminalId, amountCents: (body as { amountCents?: number }).amountCents }));
  action('reverse', (id, terminalId) => lc.reverse({ transactionId: id, terminalId }));
  action('cancel', (id, terminalId) => lc.cancelCheckout({ transactionId: id, terminalId }));
  action('settle', async (id, terminalId, body) => {
    const started = await lc.beginSettlement({ transactionId: id, terminalId });
    return (body as { immediate?: boolean }).immediate ? lc.completeSettlement(id) : started;
  });
  action('refund', async (id, terminalId, body, key) => {
    const b = parse(refundSchema, body);
    const out = await lc.refund({ transactionId: id, terminalId, amountCents: b.amountCents, reason: b.reason, idempotencyKey: key ?? `refund:${id}:${b.amountCents ?? 'full'}:${Date.now()}` });
    return out.transaction;
  });
  return r;
}
