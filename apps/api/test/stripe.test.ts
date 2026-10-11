import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import type { PaymentIntentLike, PaymentIntentParams } from '@reclaimed/payment-core';
import { StripeSdkGateway, type StripeGateway } from '../src/integrations/stripe/stripe.js';
import { bridgePost, createHarness, createUser, enrollCard, fundingSetup, tap, terminalReq, type Harness } from './helpers.js';

const WEBHOOK_SECRET = 'whsec_test_secret_for_onetap';
type Behavior = 'succeed' | 'decline' | 'unreachable' | 'processing';

/** Fake Stripe: records every call; webhook signatures use the REAL SDK verifier. */
class FakeStripe implements StripeGateway {
  readonly real = new StripeSdkGateway('sk_test_not_used');
  customers: string[] = [];
  attached: { testPm: string; customer: string; key: string }[] = [];
  intents: { params: PaymentIntentParams; key: string }[] = [];
  /** Next behaviors, consumed in order; then 'succeed'. */
  next: Behavior[] = [];
  private byKey = new Map<string, PaymentIntentLike>();
  private n = 0;

  async createCustomer(_a: { userId: string; email: string | null }, key: string) {
    this.customers.push(key);
    return `cus_${this.customers.length}`;
  }
  async attachPaymentMethod(testPm: string, customer: string, key: string) {
    this.attached.push({ testPm, customer, key });
    return `pm_saved_${this.attached.length}`;
  }
  async createPaymentIntent(params: PaymentIntentParams, key: string): Promise<PaymentIntentLike> {
    this.intents.push({ params, key });
    if (this.byKey.has(key)) return this.byKey.get(key)!;
    const b = this.next.shift() ?? 'succeed';
    if (b === 'unreachable') throw Object.assign(new Error('connect ECONNREFUSED'), { type: 'StripeConnectionError' });
    const id = `pi_${++this.n}`;
    if (b === 'decline') {
      this.byKey.set(key, { id, status: 'requires_payment_method' });
      throw Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined', decline_code: 'generic_decline', payment_intent: { id } });
    }
    const pi = { id, status: b === 'processing' ? 'processing' : 'succeeded' };
    this.byKey.set(key, pi);
    return pi;
  }
  async retrievePaymentIntent(id: string) {
    return [...this.byKey.values()].find((p) => p.id === id)!;
  }
  constructEvent(raw: string, sig: string, secret: string) {
    return this.real.constructEvent(raw, sig, secret);
  }
}

let uid = 0x10;
async function setup(stripe: FakeStripe | null, env: Record<string, string> = {}) {
  const h = await createHarness({ stripe, env: { TAP_DEBOUNCE_MS: '0', ...env } });
  const user = await createUser(h.db);
  const card = `04AABBCCDD${(uid++).toString(16).toUpperCase().padStart(4, '0')}`;
  const cardId = await enrollCard(h, user, card);
  const { funding } = await fundingSetup(h, user, cardId);
  return { h, user, card, funding };
}

async function pay(h: Harness, card: string) {
  const c = (await terminalReq(h, 'POST', '/test-terminal/transactions', { merchantId: 'MID-KB-1', merchantName: 'Knight Bites', mcc: '5812', amountCents: 1_300, currency: 'USD' })).body.data;
  const t = await bridgePost(h, '/hardware/tap-events', tap(card, { presentedAt: new Date(Date.now() + 5000).toISOString() }));
  expect(t.body.data.authorization.result).toBe('APPROVED');
  return c.id as string;
}

type ChargeRow = { charge_status: string | null; stripe_payment_intent_id: string | null; charged_funding_account_id: string | null; funding_account_id: string };
async function row(h: Harness, id: string) {
  return (await h.db.query<ChargeRow>('select charge_status, stripe_payment_intent_id, charged_funding_account_id, funding_account_id from payment_transactions where id = $1', [id])).rows[0]!;
}
/** The charge runs in the background after the tap answer; wait for it to leave `pending`. */
async function settled(h: Harness, id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await row(h, id);
    if (r.charge_status !== 'pending') return r;
    await new Promise((res) => setTimeout(res, 20));
  }
  return row(h, id);
}

describe('Stripe test-mode charge after an approved tap', () => {
  it('charges the routed card once, with the transaction id as idempotency key', async () => {
    const stripe = new FakeStripe();
    const { h, card } = await setup(stripe);
    const id = await pay(h, card);
    const r = await settled(h, id);

    expect(r.charge_status).toBe('succeeded');
    expect(r.charged_funding_account_id).toBe(r.funding_account_id);
    expect(r.stripe_payment_intent_id).toBe('pi_1');
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.attached).toHaveLength(2); // the two credit cards; the checking account is not charged
    expect(stripe.intents).toHaveLength(1);
    expect(stripe.intents[0]!.key).toBe(id);
    expect(stripe.intents[0]!.params).toMatchObject({ amount: 1_300, currency: 'usd', statement_descriptor_suffix: 'KNIGHT BITES', off_session: true });
    expect(stripe.intents[0]!.params.metadata).toMatchObject({ transaction_id: id, mcc: '5812', charged_card_id: r.funding_account_id, attempt: '1' });

    // A second start for the same transaction does nothing.
    await h.ctx.services.charges!.start(id);
    expect(stripe.intents).toHaveLength(1);

    // The next tap reuses the customer and saved cards.
    await settled(h, await pay(h, card));
    expect(stripe.customers).toHaveLength(1);
    expect(stripe.attached).toHaveLength(2);
  });

  it('falls back once to the default card when the routed card is declined', async () => {
    const stripe = new FakeStripe();
    const { h, user, card, funding } = await setup(stripe);
    const routed = (await settled(h, await pay(h, card))).funding_account_id;
    const other = funding.find((f) => f.id !== routed && f.displayName !== 'Mock Checking')!.id;
    await h.db.query('update profiles set default_card_id = $2 where id = $1', [user.id, other]);

    stripe.next = ['decline'];
    const id = await pay(h, card);
    const r = await settled(h, id);
    expect(r).toMatchObject({ charge_status: 'succeeded', funding_account_id: routed, charged_funding_account_id: other });
    expect(stripe.intents.slice(-2).map((i) => i.key)).toEqual([id, `${id}:fallback`]);
    const attempts = await h.db.query<{ attempt_no: number; status: string; error_code: string | null }>(
      'select attempt_no, status, error_code from stripe_charge_attempts where payment_transaction_id = $1 order by attempt_no',
      [id],
    );
    expect(attempts.rows).toEqual([
      { attempt_no: 1, status: 'failed', error_code: 'generic_decline' },
      { attempt_no: 2, status: 'succeeded', error_code: null },
    ]);
  });

  it('keeps the charge pending while Stripe is unreachable, and the sweep finishes it', async () => {
    const stripe = new FakeStripe();
    const { h, card } = await setup(stripe);
    stripe.next = ['unreachable'];
    const id = await pay(h, card);
    await new Promise((res) => setTimeout(res, 200));
    expect((await row(h, id)).charge_status).toBe('pending');

    await h.db.query(`update payment_transactions set authorized_at = now() - interval '1 minute' where id = $1`, [id]);
    await h.ctx.services.charges!.resumePending();
    expect((await row(h, id)).charge_status).toBe('succeeded');
  });

  it('does nothing without a Stripe key', async () => {
    const { h, card } = await setup(null);
    expect(h.ctx.services.charges).toBeNull();
    const id = await pay(h, card);
    expect((await row(h, id)).charge_status).toBeNull();
  });
});

describe('Stripe webhook', () => {
  const signed = (payload: string) => new Stripe('sk_test_not_used').webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const send = (h: Harness, payload: string, signature: string) =>
    h.http().post('/api/v1/webhooks/stripe').set('stripe-signature', signature).set('content-type', 'application/json').send(payload);

  it('rejects a bad signature', async () => {
    const { h } = await setup(new FakeStripe(), { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
    const res = await send(h, JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' }), 't=1,v1=bad');
    expect(res.status).toBe(401);
  });

  it('settles a charge that was still processing when it was created', async () => {
    const stripe = new FakeStripe();
    const { h, card } = await setup(stripe, { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
    stripe.next = ['processing'];
    const id = await pay(h, card);
    await new Promise((res) => setTimeout(res, 200));
    const before = await row(h, id);
    expect(before.charge_status).toBe('pending');

    const event = {
      id: 'evt_settle_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: before.stripe_payment_intent_id, object: 'payment_intent', metadata: { transaction_id: id, attempt: '1', charged_card_id: before.funding_account_id }, last_payment_error: null } },
    };
    const payload = JSON.stringify(event);
    const res = await send(h, payload, signed(payload));
    expect(res.status).toBe(200);
    expect(res.body.data.outcome).toBe('succeeded');
    expect((await row(h, id)).charge_status).toBe('succeeded');

    // Redelivery of the same event is a no-op.
    expect((await send(h, payload, signed(payload))).body.data.duplicate).toBe(true);
  });

  it('ignores payments that are not OneTap charges', async () => {
    const { h } = await setup(new FakeStripe(), { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET });
    const payload = JSON.stringify({ id: 'evt_other', object: 'event', type: 'payment_intent.succeeded', data: { object: { id: 'pi_x', metadata: { transaction_id: 'txn-from-another-app', attempt: '1' } } } });
    const res = await send(h, payload, signed(payload));
    expect(res.body.data.outcome).toBe('ignored');
  });
});
