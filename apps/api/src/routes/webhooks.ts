import { createHash } from 'node:crypto';
import { Router, type Request } from 'express';
import { ReclaimedError } from '@reclaimed/shared';
import type { AppContext } from '../context.js';
import { ok } from '../lib/http.js';
import { decideAsa, type AsaRequest } from '../integrations/lithic/asa.js';
import type { StripePaymentIntentEvent } from '../integrations/stripe/stripe.js';

function headerRecord(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') out[k] = v;
  return out;
}

async function storeWebhook(ctx: AppContext, provider: 'plaid' | 'lithic' | 'stripe',externalId: string | null, type: string, verified: boolean, payload: unknown) {
  const { rows } = await ctx.db.query<{ id: string }>(
    `insert into webhook_events (provider, external_id, event_type, verified, payload) values ($1, $2, $3, $4, $5)
     on conflict do nothing returning id`,
    [provider, externalId, type, verified, JSON.stringify(payload ?? {})],
  );
  return rows[0]?.id ?? null;
}

export function webhookRoutes(ctx: AppContext): Router {
  const r = Router();

  // ---------- Plaid ----------
  r.post('/webhooks/plaid', async (req, res) => {
    const raw = req.rawBody ?? Buffer.from('');
    const body = req.body as { webhook_type?: string; webhook_code?: string; item_id?: string; error?: { error_code?: string; error_message?: string } };
    const type = `${body.webhook_type ?? 'UNKNOWN'}.${body.webhook_code ?? 'UNKNOWN'}`;
    let verified = false;
    if (ctx.config.PLAID_VERIFY_WEBHOOKS) {
      verified = ctx.plaidWebhookVerifier ? await ctx.plaidWebhookVerifier.verify(raw, req.header('plaid-verification')) : false;
      if (!verified) {
        await storeWebhook(ctx, 'plaid', null, type, false, { rejected: true, type });
        throw new ReclaimedError('WEBHOOK_VERIFICATION_FAILED');
      }
    }
    const eventId = await storeWebhook(ctx, 'plaid', createHash('sha256').update(raw).digest('hex'), type, verified, body);
    // Acknowledge quickly; process asynchronously (Plaid retries non-2xx responses).
    ok(res, { received: true, duplicate: eventId === null });
    if (eventId === null || !body.item_id) return;
    void processPlaidWebhook(ctx, eventId, body as Required<Pick<typeof body, 'item_id'>> & typeof body);
  });

  // ---------- Lithic Auth Stream Access ----------
  r.post('/webhooks/lithic/asa', async (req, res) => {
    const raw = (req.rawBody ?? Buffer.from('')).toString('utf8');
    if (!ctx.lithic || !ctx.config.LITHIC_ASA_SECRET) throw new ReclaimedError('LITHIC_NOT_CONFIGURED');
    try {
      ctx.lithic.verifySignature(raw, headerRecord(req), ctx.config.LITHIC_ASA_SECRET);
    } catch {
      throw new ReclaimedError('WEBHOOK_VERIFICATION_FAILED');
    }
    const asa = req.body as AsaRequest;
    const decision = await decideAsa(ctx.db, asa);
    await storeWebhook(ctx, 'lithic', `asa:${asa.token}`, 'asa.request', true, { token: asa.token, amount: asa.amount, decision });
    // Documented ASA response shape: { token, result }. Not wrapped in the API envelope.
    res.status(200).json({ token: asa.token, result: decision.result });
  });

  // ---------- Lithic events (transaction sync) ----------
  r.post('/webhooks/lithic/events', async (req, res) => {
    const raw = (req.rawBody ?? Buffer.from('')).toString('utf8');
    if (!ctx.lithic || !ctx.config.LITHIC_WEBHOOK_SECRET) throw new ReclaimedError('LITHIC_NOT_CONFIGURED');
    try {
      ctx.lithic.verifySignature(raw, headerRecord(req), ctx.config.LITHIC_WEBHOOK_SECRET);
    } catch {
      throw new ReclaimedError('WEBHOOK_VERIFICATION_FAILED');
    }
    const body = req.body as { event_type?: string; token?: string; payload?: { token?: string; status?: string; result?: string } };
    const id = await storeWebhook(ctx, 'lithic', req.header('webhook-id') ?? null, body.event_type ?? 'unknown', true, body);
    const lithicTxnToken = body.payload?.token ?? body.token;
    if (id && lithicTxnToken) {
      const txn = await ctx.db.query<{ id: string }>(`select id from payment_transactions where processor = 'lithic_sandbox' and processor_reference = $1`, [lithicTxnToken]);
      await ctx.db.query(
        `insert into processor_events (processor, event_type, external_id, payment_transaction_id, payload) values ('lithic_sandbox', $1, $2, $3, $4)
         on conflict do nothing`,
        [body.event_type ?? 'unknown', req.header('webhook-id') ?? null, txn.rows[0]?.id ?? null, JSON.stringify(body)],
      );
    }
    ok(res, { received: true });
  });

  // ---------- Stripe (charge status) ----------
  r.post('/webhooks/stripe', async (req, res) => {
    const raw = (req.rawBody ?? Buffer.from('')).toString('utf8');
    if (!ctx.stripe || !ctx.services.charges || !ctx.config.STRIPE_WEBHOOK_SECRET) throw new ReclaimedError('STRIPE_NOT_CONFIGURED');
    let event: StripePaymentIntentEvent;
    try {
      event = ctx.stripe.constructEvent(raw, req.header('stripe-signature') ?? '', ctx.config.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new ReclaimedError('WEBHOOK_VERIFICATION_FAILED');
    }
    // Stripe redelivers until it gets a 2xx, so a stored event that failed earlier is processed again.
    const id =
      (await storeWebhook(ctx, 'stripe', event.id, event.type, true, event)) ??
      (await ctx.db.query<{ id: string }>(`select id from webhook_events where provider = 'stripe' and external_id = $1 and processed_at is null`, [event.id])).rows[0]?.id ??
      null;
    if (id === null) return ok(res, { received: true, duplicate: true });
    try {
      const outcome = await ctx.services.charges.handleEvent(event);
      await ctx.db.query('update webhook_events set processed_at = now() where id = $1', [id]);
      ok(res, { received: true, outcome: outcome.kind });
    } catch (err) {
      await ctx.db.query('update webhook_events set error = $2 where id = $1', [id, (err as Error).message?.slice(0, 500) ?? 'error']);
      throw err;
    }
  });
  return r;
}

async function processPlaidWebhook(
  ctx: AppContext,
  eventId: string,
  body: { webhook_type?: string; webhook_code?: string; item_id: string; error?: { error_code?: string; error_message?: string } },
) {
  const plaid = ctx.services.plaid;
  try {
    const item = await plaid.findItemByPlaidId(body.item_id);
    if (!item) return;
    const key = `${body.webhook_type}.${body.webhook_code}`;
    if (key === 'TRANSACTIONS.SYNC_UPDATES_AVAILABLE' || key === 'TRANSACTIONS.INITIAL_UPDATE' || key === 'TRANSACTIONS.HISTORICAL_UPDATE') {
      await plaid.syncTransactions(item.id);
      await plaid.refreshAccounts(item.id);
    } else if (key === 'LIABILITIES.DEFAULT_UPDATE') {
      await plaid.refreshLiabilities(item.id);
    } else if (key === 'ITEM.ERROR' && body.error?.error_code) {
      const status = body.error.error_code === 'ITEM_LOGIN_REQUIRED' ? 'LOGIN_REQUIRED' : 'ERROR';
      await plaid.markItemStatus(body.item_id, status, body.error.error_code, body.error.error_message ?? null);
    } else if (key === 'ITEM.PENDING_EXPIRATION' || key === 'ITEM.PENDING_DISCONNECT') {
      await plaid.markItemStatus(body.item_id, 'LOGIN_REQUIRED', body.webhook_code ?? null, 'Connection will expire soon. Please reconnect.');
    } else if (key === 'ITEM.USER_PERMISSION_REVOKED' || key === 'ITEM.USER_ACCOUNT_REVOKED') {
      await plaid.markItemStatus(body.item_id, 'REMOVED', body.webhook_code ?? null, 'Access revoked at the institution.');
    } else if (key === 'ITEM.LOGIN_REPAIRED') {
      await plaid.markItemStatus(body.item_id, 'ACTIVE', null, null);
    }
    ctx.realtime.toUser(item.user_id, { type: 'plaid.synced', plaidItemId: item.id });
    await ctx.db.query('update webhook_events set processed_at = now() where id = $1', [eventId]);
  } catch (err) {
    ctx.logger.error({ err, eventId }, 'plaid webhook processing failed');
    await ctx.db.query('update webhook_events set error = $2 where id = $1', [eventId, (err as Error).message?.slice(0, 500) ?? 'error']);
  }
}
