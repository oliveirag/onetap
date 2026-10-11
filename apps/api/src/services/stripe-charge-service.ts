import type { Database } from '@reclaimed/database';
import {
  applyPaymentIntentEvent,
  chargeTransaction,
  type ChargeCard,
  type ChargeContext,
  type ChargeOutcome,
  type WebhookStore,
} from '@reclaimed/payment-core';
import type { StripeGateway, StripePaymentIntentEvent } from '../integrations/stripe/stripe.js';
import type { Logger } from '../logger.js';

/** Stripe's saved test cards by network; card numbers never pass through our API. */
const TEST_PAYMENT_METHOD: Record<string, string> = {
  VISA: 'pm_card_visa',
  MASTERCARD: 'pm_card_mastercard',
  AMEX: 'pm_card_amex',
  DISCOVER: 'pm_card_discover',
};
export const testPaymentMethodFor = (network: string | null | undefined) => TEST_PAYMENT_METHOD[(network ?? '').toUpperCase()] ?? 'pm_card_visa';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Approved and not undone: the states an approved checkout moves through.
const APPROVED_STATES = new Set(['AUTHORIZED', 'CAPTURED', 'SETTLEMENT_PENDING', 'SETTLED', 'PARTIALLY_REFUNDED', 'REFUNDED']);

interface CardRow {
  id: string;
  name: string;
  status: string;
  priority: number;
  stripe_payment_method_id: string | null;
}
const toCard = (c: CardRow | undefined): ChargeCard | null =>
  c ? { id: c.id, productName: c.name, paymentMethodId: c.stripe_payment_method_id, isActive: c.status === 'ACTIVE' } : null;

/** The charge state machine's storage, over payment_transactions and stripe_charge_attempts. */
export function pgChargeStore(db: Database): WebhookStore {
  return {
    async load(transactionId) {
      const t = await db.query<{
        user_id: string | null; state: string; authorization_result: string | null; charge_status: ChargeContext['chargeStatus'] | null;
        amount_cents: number; merchant_name: string; mcc: string; category_id: string | null; funding_account_id: string | null; display_id: string | null;
      }>(
        `select p.user_id, p.state, p.authorization_result, p.charge_status, p.amount_cents::int as amount_cents, p.merchant_name, p.mcc,
                p.category_id, p.funding_account_id, rc.display_id
           from payment_transactions p left join reclaimed_cards rc on rc.id = p.reclaimed_card_id
          where p.id = $1`,
        [transactionId],
      );
      const txn = t.rows[0];
      if (!txn?.user_id) return null;

      const [profile, cards, attempts] = await Promise.all([
        db.query<{ stripe_customer_id: string | null; default_card_id: string | null }>('select stripe_customer_id, default_card_id from profiles where id = $1', [txn.user_id]),
        db.query<CardRow>(
          `select m.id, coalesce(cp.product_name, m.display_name) as name, m.status, m.priority, m.stripe_payment_method_id
             from mock_funding_accounts m left join card_products cp on cp.id = m.card_product_id
            where m.user_id = $1 and m.kind = 'CREDIT'`,
          [txn.user_id],
        ),
        db.query<{ attempt_no: 1 | 2; funding_account_id: string | null; stripe_payment_intent_id: string | null; status: 'pending' | 'succeeded' | 'failed' }>(
          'select attempt_no, funding_account_id, stripe_payment_intent_id, status from stripe_charge_attempts where payment_transaction_id = $1',
          [transactionId],
        ),
      ]);
      const p = profile.rows[0];
      const byId = new Map(cards.rows.map((c) => [c.id, c]));
      // Same default resolution as routing: the default card if active, else the first active card by priority.
      const def = p?.default_card_id ? byId.get(p.default_card_id) : undefined;
      const fallback = def?.status === 'ACTIVE' ? def : [...cards.rows].filter((c) => c.status === 'ACTIVE').sort((a, b) => a.priority - b.priority)[0];

      return {
        transactionId,
        status: txn.authorization_result === 'APPROVED' && APPROVED_STATES.has(txn.state) ? 'approved' : 'declined',
        chargeStatus: txn.charge_status ?? 'not_applicable',
        amountCents: txn.amount_cents,
        merchantName: txn.merchant_name,
        mcc: txn.mcc,
        category: txn.category_id ?? 'general',
        onetapLast4: (txn.display_id ?? '').replace(/[^0-9A-Z]/gi, '').slice(-4),
        customerId: p?.stripe_customer_id ?? null,
        routed: toCard(txn.funding_account_id ? byId.get(txn.funding_account_id) : undefined),
        fallback: toCard(fallback),
        attempts: attempts.rows.map((a) => ({ attemptNo: a.attempt_no, fundingAccountId: a.funding_account_id, paymentIntentId: a.stripe_payment_intent_id, status: a.status })),
      };
    },

    async saveAttempt(transactionId, a) {
      await db.query(
        `insert into stripe_charge_attempts (payment_transaction_id, attempt_no, funding_account_id, stripe_payment_intent_id, status, error_code, error_message)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (payment_transaction_id, attempt_no) do update set
           funding_account_id = excluded.funding_account_id,
           stripe_payment_intent_id = coalesce(excluded.stripe_payment_intent_id, stripe_charge_attempts.stripe_payment_intent_id),
           status = excluded.status, error_code = excluded.error_code, error_message = excluded.error_message, updated_at = now()`,
        [transactionId, a.attemptNo, a.fundingAccountId, a.paymentIntentId, a.status, a.errorCode ?? null, a.errorMessage ?? null],
      );
    },

    async finish(transactionId, f) {
      await db.query(
        `update payment_transactions set charge_status = $2, stripe_payment_intent_id = $3, charged_funding_account_id = $4, charged_at = $5
          where id = $1 and charge_status = 'pending'`,
        [transactionId, f.chargeStatus, f.paymentIntentId, f.chargedCardId, f.chargedAt],
      );
    },

    async markInFlight(transactionId, f) {
      await db.query(
        `update payment_transactions set stripe_payment_intent_id = $2, charged_funding_account_id = $3 where id = $1 and charge_status = 'pending'`,
        [transactionId, f.paymentIntentId, f.chargedCardId],
      );
    },

    async settlePendingAttempt(transactionId, e) {
      // Fill in an attempt we never heard back about (e.g. the create call timed out but went through).
      await db.query(
        `insert into stripe_charge_attempts (payment_transaction_id, attempt_no, funding_account_id, status) values ($1, $2, $3, 'pending')
         on conflict (payment_transaction_id, attempt_no) do nothing`,
        [transactionId, e.attemptNo, e.fundingAccountId],
      );
      await db.query(
        `update stripe_charge_attempts set stripe_payment_intent_id = $3, status = $4, error_code = $5, error_message = $6, updated_at = now()
          where payment_transaction_id = $1 and attempt_no = $2 and status = 'pending'`,
        [transactionId, e.attemptNo, e.paymentIntentId, e.outcome, e.errorCode ?? null, e.errorMessage ?? null],
      );
    },
  };
}

/**
 * Charges the routed card through Stripe test mode after an approved tap. Runs after the tap has
 * been answered and never blocks it. Owns the per-transaction lock and the retry sweep.
 */
export class StripeChargeService {
  private readonly store: WebhookStore;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: Database,
    private readonly stripe: StripeGateway,
    private readonly logger: Logger,
  ) {
    this.store = pgChargeStore(db);
  }

  /** Marks an approved checkout as pending and charges it in the background. */
  async start(transactionId: string): Promise<void> {
    const r = await this.db.query(`update payment_transactions set charge_status = 'pending' where id = $1 and charge_status is null`, [transactionId]);
    if (!r.rowCount) return;
    void this.chargeNow(transactionId);
  }

  /** Charge (or resume charging) one transaction. Never throws; "retry_later" is left to the sweep. */
  async chargeNow(transactionId: string): Promise<ChargeOutcome> {
    let outcome: ChargeOutcome;
    try {
      outcome = await this.withLock(transactionId, async () => {
        const owner = await this.db.query<{ user_id: string | null }>('select user_id from payment_transactions where id = $1', [transactionId]);
        if (owner.rows[0]?.user_id) await this.ensureSetup(owner.rows[0].user_id);
        return chargeTransaction(transactionId, { store: this.store, gateway: this.stripe });
      });
    } catch (err) {
      // Stripe setup or our own storage failed: keep the charge pending for the sweep.
      outcome = { kind: 'retry_later', attemptNo: 1, reason: (err as Error).message };
    }
    const log = outcome.kind === 'retry_later' ? this.logger.warn.bind(this.logger) : this.logger.info.bind(this.logger);
    log({ transactionId, outcome }, 'stripe charge step');
    return outcome;
  }

  /** Resumes recent charges still pending (Stripe was unreachable, or the server restarted). */
  async resumePending(): Promise<void> {
    const { rows } = await this.db.query<{ id: string }>(
      `select id from payment_transactions
        where charge_status = 'pending' and authorized_at between now() - interval '15 minutes' and now() - interval '20 seconds'
        order by authorized_at limit 20`,
    );
    for (const { id } of rows) if (!this.locks.has(id)) await this.chargeNow(id);
  }

  /** Stripe webhook: finalize a charge that was not final when it was created. */
  async handleEvent(e: StripePaymentIntentEvent): Promise<ChargeOutcome | { kind: 'ignored'; reason: string }> {
    if (e.type !== 'payment_intent.succeeded' && e.type !== 'payment_intent.payment_failed') return { kind: 'ignored', reason: e.type };
    const pi = e.paymentIntent;
    const transactionId = pi?.metadata.transaction_id;
    const attempt = Number(pi?.metadata.attempt);
    // Not one of ours (a dashboard test payment, or another app on the same Stripe account).
    if (!pi || !transactionId || !UUID.test(transactionId) || (attempt !== 1 && attempt !== 2)) return { kind: 'ignored', reason: 'no OneTap metadata' };
    const known = await this.db.query('select 1 from payment_transactions where id = $1', [transactionId]);
    if (!known.rowCount) return { kind: 'ignored', reason: 'unknown transaction' };

    const err = pi.lastPaymentError;
    const fundingAccountId = pi.metadata.charged_card_id;
    return this.withLock(transactionId, () =>
      applyPaymentIntentEvent(
        {
          transactionId,
          attemptNo: attempt,
          paymentIntentId: pi.id,
          outcome: e.type === 'payment_intent.succeeded' ? 'succeeded' : 'failed',
          errorCode: err?.declineCode || err?.code || null,
          errorMessage: err?.message ?? null,
          fundingAccountId: fundingAccountId && UUID.test(fundingAccountId) ? fundingAccountId : null,
        },
        { store: this.store, gateway: this.stripe },
      ),
    );
  }

  /** One Stripe customer per user and one saved test card per credit funding account, created once. */
  async ensureSetup(userId: string): Promise<void> {
    const p = await this.db.query<{ stripe_customer_id: string | null; email: string | null }>('select stripe_customer_id, email from profiles where id = $1', [userId]);
    let customerId = p.rows[0]?.stripe_customer_id ?? null;
    if (!customerId) {
      const created = await this.stripe.createCustomer({ userId, email: p.rows[0]?.email ?? null }, `cus:${userId}`);
      await this.db.query('update profiles set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null', [userId, created]);
      customerId = (await this.db.query<{ stripe_customer_id: string }>('select stripe_customer_id from profiles where id = $1', [userId])).rows[0]!.stripe_customer_id;
    }
    const cards = await this.db.query<{ id: string; card_network: string | null }>(
      `select m.id, cp.card_network from mock_funding_accounts m left join card_products cp on cp.id = m.card_product_id
        where m.user_id = $1 and m.kind = 'CREDIT' and m.stripe_payment_method_id is null`,
      [userId],
    );
    for (const c of cards.rows) {
      const pm = await this.stripe.attachPaymentMethod(testPaymentMethodFor(c.card_network), customerId, `pm:${c.id}`);
      await this.db.query('update mock_funding_accounts set stripe_payment_method_id = $2 where id = $1 and stripe_payment_method_id is null', [c.id, pm]);
    }
  }

  // One charge flow per transaction at a time (inline, sweep, webhook). Single instance.
  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.locks.set(key, tail);
    void tail.then(() => {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    });
    return run;
  }
}
