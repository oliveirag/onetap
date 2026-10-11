// Stripe charge state machine, ported from the reclaimed backend. Pure logic over injected Stripe and storage, so every path is
// unit-testable. Attempt 1 charges the routed card; if it is declined, attempt 2 charges the
// default card once. "Stripe unreachable" leaves the charge pending for a later retry.
import { descriptorSuffix } from './stripe-descriptor.js';

export type AttemptStatus = 'pending' | 'succeeded' | 'failed';

export interface ChargeCard {
  id: string;
  productName: string;
  paymentMethodId: string | null;
  isActive: boolean;
}

export interface AttemptRow {
  attemptNo: 1 | 2;
  fundingAccountId: string | null;
  paymentIntentId: string | null;
  status: AttemptStatus;
}

export interface ChargeContext {
  transactionId: string;
  status: 'approved' | 'declined';
  chargeStatus: 'pending' | 'succeeded' | 'failed' | 'not_applicable';
  amountCents: number;
  merchantName: string;
  mcc: string;
  category: string;
  onetapLast4: string;
  customerId: string | null;
  routed: ChargeCard | null;
  /** The default card (or first active card by priority), used for the one fallback attempt. */
  fallback: ChargeCard | null;
  attempts: AttemptRow[];
}

export interface AttemptWrite {
  attemptNo: 1 | 2;
  fundingAccountId: string | null;
  paymentIntentId: string | null;
  status: AttemptStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export interface ChargeStore {
  load(transactionId: string): Promise<ChargeContext | null>;
  /** Insert or update by (transaction_id, attempt_no); a null paymentIntentId never erases a stored one. */
  saveAttempt(transactionId: string, a: AttemptWrite): Promise<void>;
  /** Moves the transaction out of `pending`; no-op if it is already final. */
  finish(
    transactionId: string,
    f: { chargeStatus: 'succeeded' | 'failed'; paymentIntentId: string | null; chargedCardId: string | null; chargedAt: Date | null },
  ): Promise<void>;
  /** Records the in-flight PaymentIntent while the charge is still pending (async confirmation). */
  markInFlight(transactionId: string, f: { paymentIntentId: string; chargedCardId: string }): Promise<void>;
}

export interface PaymentIntentParams {
  amount: number;
  currency: 'usd';
  customer: string;
  payment_method: string;
  payment_method_types: ['card'];
  confirm: true;
  off_session: true;
  statement_descriptor_suffix: string;
  description: string;
  metadata: Record<string, string>;
}

export interface PaymentIntentLike {
  id: string;
  status: string;
  last_payment_error?: { code?: string | null; decline_code?: string | null; message?: string | null } | null;
}

export interface PaymentGateway {
  createPaymentIntent(params: PaymentIntentParams, idempotencyKey: string): Promise<PaymentIntentLike>;
  retrievePaymentIntent(id: string): Promise<PaymentIntentLike>;
}

export interface ChargeDeps {
  store: ChargeStore;
  gateway: PaymentGateway;
  now?: () => Date;
}

export type ChargeOutcome =
  | { kind: 'succeeded'; attemptNo: 1 | 2; cardId: string; paymentIntentId: string }
  | { kind: 'failed'; attemptNo: 1 | 2 }
  | { kind: 'in_flight'; attemptNo: 1 | 2; paymentIntentId: string }
  | { kind: 'retry_later'; attemptNo: 1 | 2; reason: string }
  | { kind: 'skipped'; reason: string };

/** Attempt 1 uses the transaction ID as the Stripe idempotency key; the fallback derives its own. */
export function idempotencyKey(transactionId: string, attemptNo: 1 | 2): string {
  return attemptNo === 1 ? transactionId : `${transactionId}:fallback`;
}

export function buildPaymentIntentParams(ctx: ChargeContext, card: ChargeCard, attemptNo: 1 | 2): PaymentIntentParams {
  return {
    amount: ctx.amountCents,
    currency: 'usd',
    customer: ctx.customerId!,
    payment_method: card.paymentMethodId!,
    payment_method_types: ['card'],
    confirm: true,
    off_session: true,
    statement_descriptor_suffix: descriptorSuffix(ctx.merchantName),
    description: `OneTap purchase at ${ctx.merchantName}`,
    metadata: {
      transaction_id: ctx.transactionId,
      merchant_name: ctx.merchantName,
      mcc: ctx.mcc,
      category: ctx.category,
      routed_card: ctx.routed?.productName ?? '',
      routed_card_id: ctx.routed?.id ?? '',
      charged_card: card.productName,
      charged_card_id: card.id,
      attempt: String(attemptNo),
      onetap_last4: ctx.onetapLast4,
    },
  };
}

type ErrorClass =
  | { kind: 'declined'; code: string; message: string; paymentIntentId: string | null }
  | { kind: 'unreachable'; message: string };

/**
 * A card decline (or a request Stripe will never accept) fails the attempt; anything that
 * might succeed on a retry with the same idempotency key (network, 5xx, 429, auth config)
 * keeps the charge pending.
 */
export function classifyStripeError(err: unknown): ErrorClass {
  const e = (err ?? {}) as {
    type?: string; code?: string; decline_code?: string; message?: string; statusCode?: number;
    payment_intent?: { id?: string } | null; raw?: { payment_intent?: { id?: string } };
  };
  const message = e.message ?? String(err);
  const piId = e.payment_intent?.id ?? e.raw?.payment_intent?.id ?? null;
  switch (e.type) {
    case 'StripeCardError':
      return { kind: 'declined', code: e.decline_code || e.code || 'card_declined', message, paymentIntentId: piId };
    case 'StripeInvalidRequestError':
    case 'StripeIdempotencyError':
      if ((e.statusCode ?? 400) < 500) return { kind: 'declined', code: e.code || 'invalid_request', message, paymentIntentId: piId };
      return { kind: 'unreachable', message };
    default:
      return { kind: 'unreachable', message };
  }
}

const FAILED_PI_STATUSES = new Set(['requires_payment_method', 'canceled']);

/**
 * Advance the charge for one transaction as far as it can go right now. Safe to call
 * repeatedly (inline after approval, from the retry job, or a webhook).
 */
export async function chargeTransaction(transactionId: string, deps: ChargeDeps): Promise<ChargeOutcome> {
  const { store, gateway } = deps;
  const now = deps.now ?? (() => new Date());

  const ctx = await store.load(transactionId);
  if (!ctx) return { kind: 'skipped', reason: 'transaction not found' };
  if (ctx.status !== 'approved') return { kind: 'skipped', reason: 'not approved' };
  if (ctx.chargeStatus !== 'pending') return { kind: 'skipped', reason: `already ${ctx.chargeStatus}` };

  const attempts = new Map(ctx.attempts.map((a) => [a.attemptNo, { ...a }]));
  const cardFor = (attemptNo: 1 | 2) => (attemptNo === 1 ? ctx.routed : ctx.fallback);

  const record = async (a: AttemptWrite) => {
    await store.saveAttempt(transactionId, a);
    const prev = attempts.get(a.attemptNo);
    attempts.set(a.attemptNo, {
      attemptNo: a.attemptNo,
      fundingAccountId: a.fundingAccountId,
      paymentIntentId: a.paymentIntentId ?? prev?.paymentIntentId ?? null,
      status: a.status,
    });
  };

  const settle = async (attemptNo: 1 | 2, card: ChargeCard, pi: PaymentIntentLike): Promise<ChargeOutcome | null> => {
    if (pi.status === 'succeeded') {
      await record({ attemptNo, fundingAccountId: card.id, paymentIntentId: pi.id, status: 'succeeded' });
      await store.finish(transactionId, { chargeStatus: 'succeeded', paymentIntentId: pi.id, chargedCardId: card.id, chargedAt: now() });
      return { kind: 'succeeded', attemptNo, cardId: card.id, paymentIntentId: pi.id };
    }
    if (FAILED_PI_STATUSES.has(pi.status)) {
      const err = pi.last_payment_error;
      await record({
        attemptNo, fundingAccountId: card.id, paymentIntentId: pi.id, status: 'failed',
        errorCode: err?.decline_code || err?.code || pi.status, errorMessage: err?.message ?? null,
      });
      return null; // failed: caller moves on
    }
    // processing / requires_action / requires_confirmation: the webhook finishes it.
    await record({ attemptNo, fundingAccountId: card.id, paymentIntentId: pi.id, status: 'pending' });
    await store.markInFlight(transactionId, { paymentIntentId: pi.id, chargedCardId: card.id });
    return { kind: 'in_flight', attemptNo, paymentIntentId: pi.id };
  };

  /** Run (or resume) one attempt. Returns an outcome, or null if the attempt failed. */
  const runAttempt = async (attemptNo: 1 | 2): Promise<ChargeOutcome | null> => {
    const card = cardFor(attemptNo);
    const existing = attempts.get(attemptNo);
    if (!card || !card.paymentMethodId || !ctx.customerId) {
      await record({
        attemptNo, fundingAccountId: card?.id ?? null, paymentIntentId: null, status: 'failed',
        errorCode: 'no_payment_method',
        errorMessage: !card ? 'no card to charge' : !ctx.customerId ? 'user has no Stripe customer' : 'card has no saved payment method',
      });
      return null;
    }
    try {
      // A pending attempt with a known PaymentIntent is resumed by reading it, not re-creating it.
      const pi = existing?.status === 'pending' && existing.paymentIntentId
        ? await gateway.retrievePaymentIntent(existing.paymentIntentId)
        : await gateway.createPaymentIntent(buildPaymentIntentParams(ctx, card, attemptNo), idempotencyKey(transactionId, attemptNo));
      return await settle(attemptNo, card, pi);
    } catch (err) {
      const c = classifyStripeError(err);
      if (c.kind === 'unreachable') {
        await record({ attemptNo, fundingAccountId: card.id, paymentIntentId: null, status: 'pending', errorCode: 'stripe_unreachable', errorMessage: c.message.slice(0, 500) });
        return { kind: 'retry_later', attemptNo, reason: c.message };
      }
      await record({ attemptNo, fundingAccountId: card.id, paymentIntentId: c.paymentIntentId, status: 'failed', errorCode: c.code, errorMessage: c.message.slice(0, 500) });
      return null;
    }
  };

  const fallbackAllowed = () =>
    !!ctx.fallback && ctx.fallback.isActive && ctx.fallback.id !== ctx.routed?.id;

  const failAll = async (last: 1 | 2): Promise<ChargeOutcome> => {
    const a = attempts.get(last);
    await store.finish(transactionId, {
      chargeStatus: 'failed', paymentIntentId: a?.paymentIntentId ?? null, chargedCardId: a?.fundingAccountId ?? null, chargedAt: null,
    });
    return { kind: 'failed', attemptNo: last };
  };

  // Walk the state machine from the latest recorded attempt.
  for (let step = 0; step < 4; step++) {
    const latestNo: 1 | 2 | 0 = attempts.has(2) ? 2 : attempts.has(1) ? 1 : 0;
    const latest = latestNo ? attempts.get(latestNo)! : null;

    if (!latest) {
      const out = await runAttempt(1);
      if (out) return out;
      continue;
    }
    if (latest.status === 'succeeded') {
      await store.finish(transactionId, {
        chargeStatus: 'succeeded', paymentIntentId: latest.paymentIntentId, chargedCardId: latest.fundingAccountId, chargedAt: now(),
      });
      return { kind: 'succeeded', attemptNo: latest.attemptNo, cardId: latest.fundingAccountId ?? '', paymentIntentId: latest.paymentIntentId ?? '' };
    }
    if (latest.status === 'pending') {
      const out = await runAttempt(latest.attemptNo);
      if (out) return out;
      continue;
    }
    // latest failed
    if (latest.attemptNo === 1 && fallbackAllowed()) {
      const out = await runAttempt(2);
      if (out) return out;
      continue;
    }
    return failAll(latest.attemptNo);
  }
  return { kind: 'retry_later', attemptNo: attempts.has(2) ? 2 : 1, reason: 'state machine did not settle' };
}

export interface PaymentIntentEvent {
  transactionId: string;
  attemptNo: 1 | 2;
  paymentIntentId: string;
  outcome: 'succeeded' | 'failed';
  errorCode?: string | null;
  errorMessage?: string | null;
  fundingAccountId: string | null;
}

export interface WebhookStore extends ChargeStore {
  /** Finalize a still-pending attempt from a Stripe event; finalized attempts are left alone. */
  settlePendingAttempt(transactionId: string, e: PaymentIntentEvent): Promise<void>;
}

/**
 * Stripe webhook: record the attempt's final state, then let the state machine decide
 * what that means for the transaction. A late event for an older attempt can't override a
 * newer attempt or a final charge status, because the machine only follows the latest attempt
 * and never leaves a final status.
 */
export async function applyPaymentIntentEvent(e: PaymentIntentEvent, deps: ChargeDeps & { store: WebhookStore }): Promise<ChargeOutcome> {
  await deps.store.settlePendingAttempt(e.transactionId, e);
  return chargeTransaction(e.transactionId, deps);
}
