import { describe, expect, it } from 'vitest';
import {
  applyPaymentIntentEvent, chargeTransaction, classifyStripeError, idempotencyKey,
  type AttemptRow, type ChargeCard, type ChargeContext, type PaymentGateway, type PaymentIntentLike,
  type PaymentIntentParams, type WebhookStore,
} from '../src/stripe-charge.js';

const AMEX: ChargeCard = { id: 'amex', productName: 'Amex Gold', paymentMethodId: 'pm_amex', isActive: true };
const VENTURE: ChargeCard = { id: 'venture', productName: 'Capital One Venture', paymentMethodId: 'pm_venture', isActive: true };

function context(over: Partial<ChargeContext> = {}): ChargeContext {
  return {
    transactionId: 'txn-1', status: 'approved', chargeStatus: 'pending', amountCents: 1300,
    merchantName: 'Knight Bites', mcc: '5812', category: 'dining', onetapLast4: '2776',
    customerId: 'cus_1', routed: AMEX, fallback: VENTURE, attempts: [], ...over,
  };
}

/** In-memory stand-in for the pg store, mirroring its guards. */
function memoryStore(ctx: ChargeContext) {
  const state = {
    ctx: structuredClone(ctx),
    txn: { charge_status: ctx.chargeStatus as string, stripe_payment_intent_id: null as string | null, charged_card_id: null as string | null, charged_at: null as Date | null },
    attempts: new Map<number, AttemptRow & { errorCode?: string | null }>(ctx.attempts.map((a) => [a.attemptNo, { ...a }])),
  };
  const store: WebhookStore = {
    async load() {
      return { ...state.ctx, chargeStatus: state.txn.charge_status as ChargeContext['chargeStatus'], attempts: [...state.attempts.values()].map((a) => ({ ...a })) };
    },
    async saveAttempt(_id, a) {
      const prev = state.attempts.get(a.attemptNo);
      state.attempts.set(a.attemptNo, {
        attemptNo: a.attemptNo, fundingAccountId: a.fundingAccountId, status: a.status, errorCode: a.errorCode ?? null,
        paymentIntentId: a.paymentIntentId ?? prev?.paymentIntentId ?? null,
      });
    },
    async finish(_id, f) {
      if (state.txn.charge_status !== 'pending') return;
      state.txn = { charge_status: f.chargeStatus, stripe_payment_intent_id: f.paymentIntentId, charged_card_id: f.chargedCardId, charged_at: f.chargedAt };
    },
    async markInFlight(_id, f) {
      if (state.txn.charge_status !== 'pending') return;
      state.txn.stripe_payment_intent_id = f.paymentIntentId;
      state.txn.charged_card_id = f.chargedCardId;
    },
    async settlePendingAttempt(_id, e) {
      const a = state.attempts.get(e.attemptNo) ?? { attemptNo: e.attemptNo, fundingAccountId: e.fundingAccountId, paymentIntentId: null, status: 'pending' as const };
      if (a.status !== 'pending') return;
      state.attempts.set(e.attemptNo, { ...a, paymentIntentId: e.paymentIntentId, status: e.outcome, errorCode: e.errorCode ?? null });
    },
  };
  return { store, state };
}

type Behavior = 'succeed' | 'decline' | 'unreachable' | 'processing' | ((p: PaymentIntentParams) => PaymentIntentLike);

/** Fake Stripe: behavior per payment method, records every call with its idempotency key. */
function fakeGateway(behaviors: Record<string, Behavior | Behavior[]>) {
  const calls: { params: PaymentIntentParams; key: string }[] = [];
  const created = new Map<string, PaymentIntentLike>();
  const byKey = new Map<string, PaymentIntentLike>();
  let n = 0;
  const gateway: PaymentGateway & { retrieveStatus?: string } = {
    async createPaymentIntent(params, key) {
      calls.push({ params, key });
      if (byKey.has(key)) return byKey.get(key)!; // Stripe idempotent replay
      const list = behaviors[params.payment_method];
      const b = Array.isArray(list) ? list.shift() ?? 'succeed' : list ?? 'succeed';
      if (typeof b === 'function') return b(params);
      if (b === 'unreachable') throw Object.assign(new Error('connect ECONNREFUSED'), { type: 'StripeConnectionError' });
      const id = `pi_${++n}`;
      if (b === 'decline') {
        const pi = { id, status: 'requires_payment_method' };
        created.set(id, pi); byKey.set(key, pi);
        throw Object.assign(new Error('Your card was declined.'), {
          type: 'StripeCardError', code: 'card_declined', decline_code: 'generic_decline', payment_intent: { id },
        });
      }
      const pi = { id, status: b === 'processing' ? 'processing' : 'succeeded' };
      created.set(id, pi); byKey.set(key, pi);
      return pi;
    },
    async retrievePaymentIntent(id) {
      return { ...created.get(id)!, ...(gateway.retrieveStatus ? { status: gateway.retrieveStatus } : {}) };
    },
  };
  return { gateway, calls };
}

const now = () => new Date('2026-10-10T12:00:00Z');

describe('chargeTransaction', () => {
  it('charges the routed card once with descriptor, metadata and the transaction ID as idempotency key', async () => {
    const { store, state } = memoryStore(context());
    const { gateway, calls } = fakeGateway({});
    const out = await chargeTransaction('txn-1', { store, gateway, now });

    expect(out).toMatchObject({ kind: 'succeeded', attemptNo: 1, cardId: 'amex' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe('txn-1');
    expect(calls[0]!.params).toMatchObject({
      amount: 1300, currency: 'usd', customer: 'cus_1', payment_method: 'pm_amex',
      payment_method_types: ['card'], confirm: true, off_session: true, statement_descriptor_suffix: 'KNIGHT BITES',
    });
    expect(calls[0]!.params.metadata).toEqual({
      transaction_id: 'txn-1', merchant_name: 'Knight Bites', mcc: '5812', category: 'dining',
      routed_card: 'Amex Gold', routed_card_id: 'amex', charged_card: 'Amex Gold', charged_card_id: 'amex',
      attempt: '1', onetap_last4: '2776',
    });
    for (const v of Object.values(calls[0]!.params.metadata)) expect(typeof v).toBe('string');
    expect(state.txn).toMatchObject({ charge_status: 'succeeded', charged_card_id: 'amex', stripe_payment_intent_id: 'pi_1' });
    expect(state.txn.charged_at).toEqual(now());
    expect(state.attempts.get(1)).toMatchObject({ status: 'succeeded', paymentIntentId: 'pi_1' });
  });

  it('decline on the routed card falls back once to the default card under a derived key', async () => {
    const { store, state } = memoryStore(context());
    const { gateway, calls } = fakeGateway({ pm_amex: 'decline' });
    const out = await chargeTransaction('txn-1', { store, gateway, now });

    expect(out).toMatchObject({ kind: 'succeeded', attemptNo: 2, cardId: 'venture' });
    expect(calls.map((c) => c.key)).toEqual(['txn-1', 'txn-1:fallback']);
    expect(calls[1]!.params.metadata).toMatchObject({ attempt: '2', routed_card: 'Amex Gold', charged_card: 'Capital One Venture', charged_card_id: 'venture' });
    expect(state.attempts.get(1)).toMatchObject({ status: 'failed', errorCode: 'generic_decline', paymentIntentId: 'pi_1' });
    expect(state.attempts.get(2)).toMatchObject({ status: 'succeeded', paymentIntentId: 'pi_2' });
    expect(state.txn).toMatchObject({ charge_status: 'succeeded', charged_card_id: 'venture', stripe_payment_intent_id: 'pi_2' });
  });

  it('both cards declining marks the charge failed on the default card', async () => {
    const { store, state } = memoryStore(context());
    const { gateway, calls } = fakeGateway({ pm_amex: 'decline', pm_venture: 'decline' });
    expect(await chargeTransaction('txn-1', { store, gateway, now })).toEqual({ kind: 'failed', attemptNo: 2 });
    expect(calls).toHaveLength(2);
    expect(state.txn).toMatchObject({ charge_status: 'failed', charged_card_id: 'venture', charged_at: null });
  });

  it('routed card is the default: one attempt, then failed', async () => {
    const { store, state } = memoryStore(context({ routed: VENTURE, fallback: VENTURE }));
    const { gateway, calls } = fakeGateway({ pm_venture: 'decline' });
    expect(await chargeTransaction('txn-1', { store, gateway, now })).toEqual({ kind: 'failed', attemptNo: 1 });
    expect(calls).toHaveLength(1);
    expect(state.attempts.size).toBe(1);
    expect(state.txn).toMatchObject({ charge_status: 'failed', charged_card_id: 'venture' });
  });

  it('inactive default card: no fallback', async () => {
    const { store, state } = memoryStore(context({ fallback: { ...VENTURE, isActive: false } }));
    const { gateway, calls } = fakeGateway({ pm_amex: 'decline' });
    expect(await chargeTransaction('txn-1', { store, gateway, now })).toEqual({ kind: 'failed', attemptNo: 1 });
    expect(calls).toHaveLength(1);
    expect(state.txn.charge_status).toBe('failed');
  });

  it('routed card without a saved payment method counts as a failed attempt, then falls back', async () => {
    const { store, state } = memoryStore(context({ routed: { ...AMEX, paymentMethodId: null } }));
    const { gateway, calls } = fakeGateway({});
    const out = await chargeTransaction('txn-1', { store, gateway, now });
    expect(out).toMatchObject({ kind: 'succeeded', attemptNo: 2, cardId: 'venture' });
    expect(calls).toHaveLength(1);
    expect(state.attempts.get(1)).toMatchObject({ status: 'failed', errorCode: 'no_payment_method' });
  });

  it('no Stripe customer: both attempts fail without calling Stripe', async () => {
    const { store, state } = memoryStore(context({ customerId: null }));
    const { gateway, calls } = fakeGateway({});
    expect(await chargeTransaction('txn-1', { store, gateway, now })).toEqual({ kind: 'failed', attemptNo: 2 });
    expect(calls).toHaveLength(0);
    expect(state.txn.charge_status).toBe('failed');
  });

  it('Stripe unreachable leaves the charge pending; the retry reuses the same key and succeeds once', async () => {
    const { store, state } = memoryStore(context());
    const { gateway, calls } = fakeGateway({ pm_amex: ['unreachable', 'succeed'] });

    const first = await chargeTransaction('txn-1', { store, gateway, now });
    expect(first).toMatchObject({ kind: 'retry_later', attemptNo: 1 });
    expect(state.txn.charge_status).toBe('pending');
    expect(state.attempts.get(1)).toMatchObject({ status: 'pending', errorCode: 'stripe_unreachable' });

    const second = await chargeTransaction('txn-1', { store, gateway, now });
    expect(second).toMatchObject({ kind: 'succeeded', attemptNo: 1, cardId: 'amex' });
    expect(calls.map((c) => c.key)).toEqual(['txn-1', 'txn-1']);
    expect(state.txn.charge_status).toBe('succeeded');
  });

  it('5xx and rate limits are "unreachable", not declines', () => {
    expect(classifyStripeError({ type: 'StripeAPIError', statusCode: 500, message: 'x' }).kind).toBe('unreachable');
    expect(classifyStripeError({ type: 'StripeRateLimitError', statusCode: 429, message: 'x' }).kind).toBe('unreachable');
    expect(classifyStripeError(new TypeError('fetch failed')).kind).toBe('unreachable');
    expect(classifyStripeError({ type: 'StripeCardError', code: 'card_declined', message: 'x' }).kind).toBe('declined');
    expect(classifyStripeError({ type: 'StripeInvalidRequestError', statusCode: 400, code: 'resource_missing', message: 'x' }).kind).toBe('declined');
  });

  it('skips declined, already-final and missing transactions', async () => {
    const { gateway, calls } = fakeGateway({});
    for (const ctx of [context({ status: 'declined', chargeStatus: 'not_applicable' }), context({ chargeStatus: 'succeeded' })]) {
      const { store } = memoryStore(ctx);
      expect((await chargeTransaction('txn-1', { store, gateway, now })).kind).toBe('skipped');
    }
    const { store } = memoryStore(context());
    expect((await chargeTransaction('nope', { store: { ...store, load: async () => null }, gateway, now })).kind).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('running twice after success charges only once', async () => {
    const { store } = memoryStore(context());
    const { gateway, calls } = fakeGateway({});
    await chargeTransaction('txn-1', { store, gateway, now });
    expect((await chargeTransaction('txn-1', { store, gateway, now })).kind).toBe('skipped');
    expect(calls).toHaveLength(1);
  });

  it('idempotency keys', () => {
    expect(idempotencyKey('t', 1)).toBe('t');
    expect(idempotencyKey('t', 2)).toBe('t:fallback');
  });
});

describe('Stripe webhook events', () => {
  it('a processing charge stays pending until the succeeded event finalizes it', async () => {
    const { store, state } = memoryStore(context());
    const { gateway } = fakeGateway({ pm_amex: 'processing' });
    expect(await chargeTransaction('txn-1', { store, gateway, now })).toMatchObject({ kind: 'in_flight', paymentIntentId: 'pi_1' });
    expect(state.txn).toMatchObject({ charge_status: 'pending', stripe_payment_intent_id: 'pi_1', charged_card_id: 'amex' });

    await applyPaymentIntentEvent(
      { transactionId: 'txn-1', attemptNo: 1, paymentIntentId: 'pi_1', outcome: 'succeeded', fundingAccountId: 'amex' },
      { store, gateway, now },
    );
    expect(state.txn).toMatchObject({ charge_status: 'succeeded', charged_card_id: 'amex', stripe_payment_intent_id: 'pi_1' });
  });

  it('a payment_failed event for the in-flight first attempt starts the fallback', async () => {
    const { store, state } = memoryStore(context());
    const { gateway, calls } = fakeGateway({ pm_amex: 'processing' });
    await chargeTransaction('txn-1', { store, gateway, now });

    await applyPaymentIntentEvent(
      { transactionId: 'txn-1', attemptNo: 1, paymentIntentId: 'pi_1', outcome: 'failed', errorCode: 'insufficient_funds', fundingAccountId: 'amex' },
      { store, gateway, now },
    );
    expect(calls.map((c) => c.key)).toEqual(['txn-1', 'txn-1:fallback']);
    expect(state.txn).toMatchObject({ charge_status: 'succeeded', charged_card_id: 'venture' });
  });

  it('a late failure event for attempt 1 does not undo a fallback success', async () => {
    const { store, state } = memoryStore(context());
    const { gateway, calls } = fakeGateway({ pm_amex: 'decline' });
    await chargeTransaction('txn-1', { store, gateway, now });
    const before = structuredClone(state.txn);

    const out = await applyPaymentIntentEvent(
      { transactionId: 'txn-1', attemptNo: 1, paymentIntentId: 'pi_1', outcome: 'failed', errorCode: 'generic_decline', fundingAccountId: 'amex' },
      { store, gateway, now },
    );
    expect(out.kind).toBe('skipped');
    expect(state.txn).toEqual(before);
    expect(state.txn).toMatchObject({ charge_status: 'succeeded', charged_card_id: 'venture' });
    expect(calls).toHaveLength(2);
  });

  it('a succeeded event fills in an attempt whose create call never answered', async () => {
    const { store, state } = memoryStore(context());
    const { gateway, calls } = fakeGateway({ pm_amex: 'unreachable' });
    await chargeTransaction('txn-1', { store, gateway, now });
    expect(state.txn.charge_status).toBe('pending');

    await applyPaymentIntentEvent(
      { transactionId: 'txn-1', attemptNo: 1, paymentIntentId: 'pi_x', outcome: 'succeeded', fundingAccountId: 'amex' },
      { store, gateway, now },
    );
    expect(state.txn).toMatchObject({ charge_status: 'succeeded', stripe_payment_intent_id: 'pi_x', charged_card_id: 'amex' });
    expect(calls).toHaveLength(1);
  });

  it('a duplicate succeeded event is a no-op', async () => {
    const { store, state } = memoryStore(context());
    const { gateway, calls } = fakeGateway({});
    await chargeTransaction('txn-1', { store, gateway, now });
    const out = await applyPaymentIntentEvent(
      { transactionId: 'txn-1', attemptNo: 1, paymentIntentId: 'pi_1', outcome: 'succeeded', fundingAccountId: 'amex' },
      { store, gateway, now },
    );
    expect(out.kind).toBe('skipped');
    expect(calls).toHaveLength(1);
    expect(state.txn.charge_status).toBe('succeeded');
  });
});
