import { Router } from 'express';
import { z } from 'zod';
import {
  ReclaimedError,
  cardProductSearchSchema,
  confirmCardProductSchema,
  createBillPaymentSchema,
  createMockFundingAccountSchema,
  exchangeTokenSchema,
  linkTokenRequestSchema,
  paginationQuerySchema,
  startEnrollmentSchema,
  transactionsQuerySchema,
  updateCardFundingSchema,
  updateCardStatusSchema,
  updateMockFundingAccountSchema,
  updateProfileSchema,
} from '@reclaimed/shared';
import { loadAuthorizationDto, loadBillPaymentDto, toBillPaymentDto, type BillPaymentRow } from '@reclaimed/payment-core';
import type { AppContext } from '../context.js';
import { ok, param, parse, encodeCursor, decodeCursor } from '../lib/http.js';
import { requireUser } from '../middleware/auth.js';
import { idempotencyKey } from '../lib/idempotency.js';
import { audit } from '../lib/audit.js';

/** Routes for the signed-in cardholder (Supabase JWT). Every query is scoped to req.user. */
export function userRoutes(ctx: AppContext): Router {
  const r = Router();
  r.use(requireUser(ctx));
  const s = ctx.services;
  const uid = (req: { user?: { userId: string } }) => req.user!.userId;

  // ---------- Profile ----------
  r.get('/me', async (req, res) => ok(res, await s.profile.get(uid(req))));
  r.patch('/me', async (req, res) => ok(res, await s.profile.update(uid(req), parse(updateProfileSchema, req.body))));
  r.delete('/me', async (req, res) => {
    await s.profile.delete(uid(req), res.locals.requestId);
    ok(res, { deleted: true });
  });

  // ---------- Plaid ----------
  r.post('/plaid/link-token', async (req, res) => {
    const body = parse(linkTokenRequestSchema, req.body ?? {});
    ok(res, await s.plaid.createLinkToken(uid(req), body.itemId, body.platform));
  });
  r.post('/plaid/exchange-token', async (req, res) => {
    const body = parse(exchangeTokenSchema, req.body);
    const result = await s.plaid.exchangePublicToken(uid(req), body.publicToken, body.institution);
    await audit(ctx.db, { actorType: 'user', actorId: uid(req), userId: uid(req), action: 'plaid.item_linked', entityType: 'plaid_item', entityId: result.itemId, requestId: res.locals.requestId });
    ok(res, result, 201);
  });
  r.get('/plaid/items', async (req, res) => ok(res, await s.plaid.listItems(uid(req))));
  r.post('/plaid/items/:id/sync', async (req, res) => {
    const id = param(req, 'id');
    await s.plaid.ownedItem(ctx.db, uid(req), id);
    const accounts = await s.plaid.refreshAccounts(id);
    const transactions = await s.plaid.syncTransactions(id);
    const liabilities = await s.plaid.refreshLiabilities(id);
    ctx.realtime.toUser(uid(req), { type: 'plaid.synced', plaidItemId: id });
    ok(res, { accounts, transactions, liabilities });
  });
  r.delete('/plaid/items/:id', async (req, res) => {
    const id = param(req, 'id');
    await s.plaid.removeItem(uid(req), id);
    await audit(ctx.db, { actorType: 'user', actorId: uid(req), userId: uid(req), action: 'plaid.item_removed', entityType: 'plaid_item', entityId: id, requestId: res.locals.requestId });
    ok(res, { removed: true });
  });

  // ---------- Financial accounts (Plaid-reported) ----------
  r.get('/accounts', async (req, res) => {
    const q = parse(z.object({ type: z.string().max(30).optional() }), req.query);
    ok(res, await s.accounts.list(uid(req), q));
  });
  r.get('/accounts/:id', async (req, res) => ok(res, await s.accounts.get(uid(req), param(req, 'id'))));
  r.get('/accounts/:id/transactions', async (req, res) => {
    const q = parse(transactionsQuerySchema, req.query);
    ok(res, await s.accounts.transactions(uid(req), { ...q, accountId: param(req, 'id') }));
  });
  r.get('/accounts/:id/liabilities', async (req, res) => ok(res, await s.accounts.liability(uid(req), param(req, 'id'))));
  r.get('/accounts/:id/card-product-matches', async (req, res) => ok(res, await s.matching.suggest(param(req, 'id'), uid(req))));
  r.put('/accounts/:id/card-product', async (req, res) => {
    const body = parse(confirmCardProductSchema, req.body);
    await s.matching.confirm(uid(req), param(req, 'id'), body.cardProductId);
    ok(res, await s.accounts.get(uid(req), param(req, 'id')));
  });
  r.get('/transactions', async (req, res) => ok(res, await s.accounts.transactions(uid(req), parse(transactionsQuerySchema, req.query))));

  // ---------- Seeded card products ----------
  r.get('/card-products', async (req, res) => ok(res, await s.matching.listProducts(parse(cardProductSearchSchema, req.query).search)));
  r.get('/card-products/:id', async (req, res) => ok(res, await s.matching.getProduct(param(req, 'id'))));

  // ---------- Mock funding accounts (simulation only) ----------
  r.get('/mock-funding-accounts', async (req, res) => ok(res, await s.cards.listFunding(uid(req))));
  r.post('/mock-funding-accounts', async (req, res) => ok(res, await s.cards.createFunding(uid(req), parse(createMockFundingAccountSchema, req.body)), 201));
  r.patch('/mock-funding-accounts/:id', async (req, res) =>
    ok(res, await s.cards.updateFunding(uid(req), param(req, 'id'), parse(updateMockFundingAccountSchema, req.body))),
  );

  // ---------- Reclaimed cards ----------
  r.get('/reclaimed-cards', async (req, res) => ok(res, await s.cards.list(uid(req))));
  r.post('/reclaimed-cards/test-enroll', async (req, res) => {
    if (!ctx.config.isDev && !ctx.config.HARDWARE_TEST_MODE) throw new ReclaimedError('FEATURE_DISABLED', 'Test enrollment is development-only.');
    ok(res, await s.hardware.startEnrollment(uid(req), parse(startEnrollmentSchema, req.body ?? {})), 201);
  });
  r.get('/reclaimed-cards/enrollments/:id', async (req, res) => ok(res, await s.hardware.getEnrollment(uid(req), param(req, 'id'))));
  r.post('/reclaimed-cards/enrollments/:id/cancel', async (req, res) => ok(res, await s.hardware.cancelEnrollment(uid(req), param(req, 'id'))));
  r.get('/reclaimed-cards/:id', async (req, res) => ok(res, await s.cards.get(uid(req), param(req, 'id'))));
  r.patch('/reclaimed-cards/:id/status', async (req, res) => {
    const body = parse(updateCardStatusSchema, req.body);
    const card = await s.cards.setStatus(uid(req), param(req, 'id'), body.status, res.locals.requestId);
    ctx.realtime.toUser(uid(req), { type: 'card.updated', reclaimedCardId: card.id });
    ok(res, card);
  });
  r.put('/reclaimed-cards/:id/funding', async (req, res) => ok(res, await s.cards.setFunding(uid(req), param(req, 'id'), parse(updateCardFundingSchema, req.body))));
  r.get('/reclaimed-cards/:id/transactions', async (req, res) => {
    const q = parse(transactionsQuerySchema, req.query);
    ok(res, await s.cards.transactions(uid(req), { ...q, cardId: param(req, 'id') }));
  });
  r.post('/reclaimed-cards/:id/lithic-card', async (req, res) => ok(res, await s.cards.provisionLithicCard(uid(req), param(req, 'id'))));

  // ---------- Simulated transactions & authorizations ----------
  r.get('/simulated-transactions', async (req, res) => ok(res, await s.cards.transactions(uid(req), parse(transactionsQuerySchema, req.query))));
  r.get('/simulated-transactions/:id', async (req, res) => {
    const txn = await s.cards.simulatedTransaction(uid(req), param(req, 'id'));
    const authorization = await loadAuthorizationDto(ctx.db, { paymentTransactionId: txn.id });
    ok(res, { transaction: txn, authorization, ledger: await s.cards.ledgerForTransaction(uid(req), txn.id) });
  });
  r.get('/authorizations/:id', async (req, res) => {
    const a = await loadAuthorizationDto(ctx.db, { id: param(req, 'id') });
    const owner = a ? await ctx.db.query('select 1 from authorization_attempts where id = $1 and user_id = $2', [a.id, uid(req)]) : null;
    if (!a || !owner?.rowCount) throw new ReclaimedError('NOT_FOUND', 'Authorization not found.');
    ok(res, a);
  });

  // ---------- Bill pay (TEST MODE) ----------
  r.get('/bill-pay/accounts', async (req, res) => {
    const accounts = await s.accounts.list(uid(req), { type: 'credit' });
    ok(res, await Promise.all(accounts.map(async (account) => ({ account, liability: await s.accounts.liability(uid(req), account.id) }))));
  });
  r.get('/bill-pay/payments', async (req, res) => {
    const q = parse(paginationQuerySchema, req.query);
    const c = decodeCursor(q.cursor);
    const { rows } = await ctx.db.query<BillPaymentRow>(
      `select * from bill_payment_intents where user_id = $1 and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
        order by created_at desc, id desc limit $4`,
      [uid(req), c?.createdAt ?? null, c?.id ?? null, q.limit + 1],
    );
    const items = rows.slice(0, q.limit);
    const last = items[items.length - 1];
    ok(res, { items: items.map((i) => toBillPaymentDto(i, [])), nextCursor: rows.length > q.limit && last ? encodeCursor(last.created_at, last.id) : null });
  });
  r.post('/bill-pay/payments', async (req, res) => {
    const body = parse(createBillPaymentSchema, req.body);
    const out = await s.billPay.create(uid(req), body, idempotencyKey(req, false));
    if (!out.replayed) ctx.realtime.toUser(uid(req), { type: 'bill_payment.updated', billPaymentId: out.payment.id, state: out.payment.state });
    ok(res, out.payment, out.replayed ? 200 : 201);
  });
  r.get('/bill-pay/payments/:id', async (req, res) => {
    const p = await loadBillPaymentDto(ctx.db, param(req, 'id'), uid(req));
    if (!p) throw new ReclaimedError('NOT_FOUND', 'Bill payment not found.');
    ok(res, p);
  });
  r.post('/bill-pay/payments/:id/submit', async (req, res) => ok(res, await s.billPay.submit(uid(req), param(req, 'id'))));
  r.post('/bill-pay/payments/:id/cancel', async (req, res) => ok(res, await s.billPay.cancel(uid(req), param(req, 'id'))));

  // ---------- OneTap app setup (mobile/src/lib/api.ts) ----------
  // After Plaid Link + /plaid/exchange-token: one routable card per connected credit account.
  r.post('/onetap/connect-cards', async (req, res) => ok(res, await s.onetap.connectCards(uid(req))));
  // The OneTap card: created digital at once; the physical card attaches with a tap.
  r.post('/onetap/card', async (req, res) => ok(res, await s.onetap.card(uid(req))));
  // Waits up to ONETAP_ENROLL_WAIT_MS for the physical NFC card to be tapped on the reader.
  r.post('/onetap/card/physical', async (req, res) => ok(res, await s.onetap.linkPhysical(uid(req))));

  // ---------- Dashboard & dev hardware view ----------
  r.get('/dashboard/summary', async (req, res) => ok(res, await s.dashboard.summary(uid(req))));
  return r;
}
