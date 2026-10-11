import Stripe from 'stripe';
import type { PaymentGateway, PaymentIntentLike, PaymentIntentParams } from '@reclaimed/payment-core';

/** Pinned so a dashboard API-version change can't alter response shapes under us. */
export const STRIPE_API_VERSION = '2026-08-26.dahlia';

/** Only the PaymentIntent fields the charge flow reads from a webhook event. */
export interface StripePaymentIntentEvent {
  id: string;
  type: string;
  paymentIntent: {
    id: string;
    metadata: Record<string, string>;
    lastPaymentError: { code: string | null; declineCode: string | null; message: string | null } | null;
  } | null;
}

/**
 * Thin wrapper over the Stripe SDK (test mode only). Card numbers never pass through us:
 * each funding account gets one of Stripe's saved test cards (pm_card_visa, ...).
 */
export interface StripeGateway extends PaymentGateway {
  createCustomer(args: { userId: string; email: string | null }, idempotencyKey: string): Promise<string>;
  /** Attaches a Stripe test payment method to the customer; returns the new saved pm_… id. */
  attachPaymentMethod(testPaymentMethod: string, customerId: string, idempotencyKey: string): Promise<string>;
  /** Throws if the Stripe-Signature header doesn't match the raw body. */
  constructEvent(rawBody: string, signature: string, secret: string): StripePaymentIntentEvent;
}

export class StripeSdkGateway implements StripeGateway {
  private readonly client: Stripe;

  constructor(secretKey: string) {
    // No SDK retries: the charge flow owns retries and idempotency keys.
    this.client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 0, timeout: 10_000 });
  }

  async createCustomer(args: { userId: string; email: string | null }, idempotencyKey: string) {
    const c = await this.client.customers.create(
      { email: args.email ?? undefined, description: 'OneTap user', metadata: { user_id: args.userId } },
      { idempotencyKey },
    );
    return c.id;
  }

  async attachPaymentMethod(testPaymentMethod: string, customerId: string, idempotencyKey: string) {
    const pm = await this.client.paymentMethods.attach(testPaymentMethod, { customer: customerId }, { idempotencyKey });
    return pm.id;
  }

  createPaymentIntent(params: PaymentIntentParams, idempotencyKey: string): Promise<PaymentIntentLike> {
    return this.client.paymentIntents.create(params, { idempotencyKey });
  }

  retrievePaymentIntent(id: string): Promise<PaymentIntentLike> {
    return this.client.paymentIntents.retrieve(id);
  }

  constructEvent(rawBody: string, signature: string, secret: string): StripePaymentIntentEvent {
    return toEvent(this.client.webhooks.constructEvent(rawBody, signature, secret));
  }
}

export function toEvent(event: Stripe.Event): StripePaymentIntentEvent {
  const isPi = event.type.startsWith('payment_intent.');
  const pi = isPi ? (event.data.object as Stripe.PaymentIntent) : null;
  const err = pi?.last_payment_error;
  return {
    id: event.id,
    type: event.type,
    paymentIntent: pi
      ? {
          id: pi.id,
          metadata: pi.metadata ?? {},
          lastPaymentError: err ? { code: err.code ?? null, declineCode: err.decline_code ?? null, message: err.message ?? null } : null,
        }
      : null,
  };
}
