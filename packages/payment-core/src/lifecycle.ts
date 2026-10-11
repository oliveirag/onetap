import { ReclaimedError, type PaymentState, type SimulatedTransactionDto } from '@reclaimed/shared';
import type { Database, Queryable } from '@reclaimed/database';
import type { FundingProvider } from './funding.js';
import { newBatchReference, newPaymentReference } from './ids.js';
import { fundingHoldsAccount, fundingSpendAccount, SYSTEM_ACCOUNTS, TransactionLedger } from './ledger.js';
import { loadTransaction, toTransactionDto, type PaymentTransactionRow } from './mappers.js';
import type { PaymentProcessor } from './processor.js';
import { assertTransition } from './state-machine.js';

export interface SettlementService {
  capture(args: { transactionId: string; terminalId: string; amountCents?: number }): Promise<SimulatedTransactionDto>;
  beginSettlement(args: { transactionId: string; terminalId: string }): Promise<SimulatedTransactionDto>;
  completeSettlement(transactionId: string): Promise<SimulatedTransactionDto>;
}

export interface RefundService {
  reverse(args: { transactionId: string; terminalId: string }): Promise<SimulatedTransactionDto>;
  refund(args: {
    transactionId: string;
    terminalId: string;
    amountCents?: number;
    reason?: string;
    idempotencyKey: string;
  }): Promise<{ transaction: SimulatedTransactionDto; refundId: string; replayed: boolean }>;
}

export interface CheckoutInput {
  terminalId: string;
  merchantId: string;
  merchantName: string;
  mcc: string;
  amountCents: number;
  currency: string;
}

/**
 * Checkout creation, capture, settlement, reversal and refunds for simulated
 * Reclaimed transactions. All money movement is mock funding + ledger only.
 */
export class PaymentLifecycleService implements SettlementService, RefundService {
  constructor(
    private readonly db: Database,
    private readonly deps: { funding: FundingProvider; processor: PaymentProcessor; ledger: TransactionLedger },
    private readonly options: { checkoutTtlMs: number },
  ) {}

  async createCheckout(input: CheckoutInput): Promise<SimulatedTransactionDto> {
    // Expire any stale open checkout on this terminal first so it does not block.
    await this.expireCheckouts(input.terminalId);
    try {
      const { rows } = await this.db.query<PaymentTransactionRow>(
        `insert into payment_transactions
           (reference, terminal_id, merchant_id, merchant_name, mcc, amount_cents, currency, processor, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($9 || ' milliseconds')::interval)
         returning *`,
        [
          newPaymentReference(),
          input.terminalId,
          input.merchantId,
          input.merchantName,
          input.mcc,
          input.amountCents,
          input.currency,
          this.deps.processor.name,
          String(this.options.checkoutTtlMs),
        ],
      );
      const row = rows[0]!;
      await this.event(this.db, row.id, 'CHECKOUT_CREATED', null, 'CREATED', { amountCents: input.amountCents });
      return toTransactionDto(row);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new ReclaimedError('TERMINAL_BUSY');
      throw err;
    }
  }

  /** Cancels an untapped checkout (CREATED → FAILED). */
  async cancelCheckout(args: { transactionId: string; terminalId: string }): Promise<SimulatedTransactionDto> {
    return this.db.transaction(async (tx) => {
      const txn = await this.lockOwned(tx, args.transactionId, args.terminalId);
      assertTransition(txn.state, 'FAILED');
      await tx.query(`update payment_transactions set state = 'FAILED', decline_reason = 'CHECKOUT_CANCELED' where id = $1`, [txn.id]);
      await this.event(tx, txn.id, 'STATE_CHANGED', txn.state, 'FAILED', { reason: 'CHECKOUT_CANCELED' });
      return toTransactionDto((await loadTransaction(tx, txn.id))!);
    });
  }

  /** Marks open checkouts past their deadline as FAILED. Returns affected ids. */
  async expireCheckouts(terminalId?: string): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>(
      `update payment_transactions
          set state = 'FAILED', decline_reason = 'CHECKOUT_EXPIRED'
        where state = 'CREATED' and expires_at < now() and ($1::uuid is null or terminal_id = $1)
        returning id`,
      [terminalId ?? null],
    );
    for (const r of rows) await this.event(this.db, r.id, 'STATE_CHANGED', 'CREATED', 'FAILED', { reason: 'CHECKOUT_EXPIRED' });
    return rows.map((r) => r.id);
  }

  async capture(args: { transactionId: string; terminalId: string; amountCents?: number }): Promise<SimulatedTransactionDto> {
    return this.db.transaction(async (tx) => {
      const txn = await this.lockOwned(tx, args.transactionId, args.terminalId);
      assertTransition(txn.state, 'CAPTURED');
      const amount = args.amountCents ?? txn.amount_cents;
      if (amount <= 0 || amount > txn.amount_cents) {
        throw new ReclaimedError('VALIDATION_FAILED', 'Capture amount must be between 1 cent and the authorized amount.');
      }
      const funding = await this.fundingFor(tx, txn);
      const resp = await this.deps.processor.capture({ processorReference: txn.processor_reference, amountCents: amount });
      if (!resp.ok) throw new ReclaimedError('PAYMENT_DECLINED', 'Processor rejected the capture.');
      await this.deps.funding.postFromHold(tx, funding.id, txn.amount_cents, amount);
      await this.deps.ledger.post(tx, {
        type: 'CAPTURE',
        description: `Capture ${txn.reference} ${txn.merchant_name}`,
        idempotencyKey: `capture:${txn.id}`,
        paymentTransactionId: txn.id,
        lines: [
          { account: SYSTEM_ACCOUNTS.pendingMerchantPayable, direction: 'DEBIT', amountCents: txn.amount_cents },
          { account: fundingHoldsAccount(funding.id, funding.display_name, funding.user_id), direction: 'CREDIT', amountCents: txn.amount_cents },
          { account: fundingSpendAccount(funding.id, funding.display_name, funding.user_id), direction: 'DEBIT', amountCents: amount },
          { account: SYSTEM_ACCOUNTS.merchantPayable, direction: 'CREDIT', amountCents: amount },
        ],
      });
      await tx.query(`update payment_transactions set state = 'CAPTURED', captured_cents = $2, captured_at = now() where id = $1`, [
        txn.id,
        amount,
      ]);
      await this.processorEvent(tx, txn, 'capture', resp.processorReference);
      await this.event(tx, txn.id, 'STATE_CHANGED', txn.state, 'CAPTURED', { amountCents: amount });
      return toTransactionDto((await loadTransaction(tx, txn.id))!);
    });
  }

  async reverse(args: { transactionId: string; terminalId: string }): Promise<SimulatedTransactionDto> {
    return this.db.transaction(async (tx) => {
      const txn = await this.lockOwned(tx, args.transactionId, args.terminalId);
      assertTransition(txn.state, 'REVERSED');
      const funding = await this.fundingFor(tx, txn);
      const resp = await this.deps.processor.reverse({ processorReference: txn.processor_reference, amountCents: txn.amount_cents });
      if (!resp.ok) throw new ReclaimedError('INTERNAL_ERROR', 'Processor rejected the reversal.');
      await this.deps.funding.releaseHold(tx, funding.id, txn.amount_cents);
      await this.deps.ledger.post(tx, {
        type: 'AUTHORIZATION_REVERSAL',
        description: `Reversal ${txn.reference} ${txn.merchant_name}`,
        idempotencyKey: `reversal:${txn.id}`,
        paymentTransactionId: txn.id,
        lines: [
          { account: SYSTEM_ACCOUNTS.pendingMerchantPayable, direction: 'DEBIT', amountCents: txn.amount_cents },
          { account: fundingHoldsAccount(funding.id, funding.display_name, funding.user_id), direction: 'CREDIT', amountCents: txn.amount_cents },
        ],
      });
      await tx.query(`update payment_transactions set state = 'REVERSED', reversed_at = now() where id = $1`, [txn.id]);
      await this.processorEvent(tx, txn, 'reversal', resp.processorReference);
      await this.event(tx, txn.id, 'STATE_CHANGED', txn.state, 'REVERSED');
      return toTransactionDto((await loadTransaction(tx, txn.id))!);
    });
  }

  async beginSettlement(args: { transactionId: string; terminalId: string }): Promise<SimulatedTransactionDto> {
    return this.db.transaction(async (tx) => {
      const txn = await this.lockOwned(tx, args.transactionId, args.terminalId);
      if (txn.settled_at) throw new ReclaimedError('INVALID_PAYMENT_STATE', 'Transaction is already settled.');
      assertTransition(txn.state, 'SETTLEMENT_PENDING');
      await tx.query(
        `insert into settlement_records (payment_transaction_id, batch_reference, amount_cents) values ($1, $2, $3)`,
        [txn.id, newBatchReference(), txn.captured_cents - txn.refunded_cents],
      );
      await tx.query(`update payment_transactions set state = 'SETTLEMENT_PENDING' where id = $1`, [txn.id]);
      await this.event(tx, txn.id, 'STATE_CHANGED', txn.state, 'SETTLEMENT_PENDING');
      return toTransactionDto((await loadTransaction(tx, txn.id))!);
    });
  }

  async completeSettlement(transactionId: string): Promise<SimulatedTransactionDto> {
    return this.db.transaction(async (tx) => {
      const txn = (await tx.query<PaymentTransactionRow>('select * from payment_transactions where id = $1 for update', [transactionId]))
        .rows[0];
      if (!txn) throw new ReclaimedError('NOT_FOUND');
      assertTransition(txn.state, 'SETTLED');
      const net = txn.captured_cents - txn.refunded_cents;
      if (net > 0) {
        await this.deps.ledger.post(tx, {
          type: 'SETTLEMENT',
          description: `Settle ${txn.reference} to ${txn.merchant_name} (simulated)`,
          idempotencyKey: `settlement:${txn.id}`,
          paymentTransactionId: txn.id,
          lines: [
            { account: SYSTEM_ACCOUNTS.merchantPayable, direction: 'DEBIT', amountCents: net },
            { account: SYSTEM_ACCOUNTS.settlementCash, direction: 'CREDIT', amountCents: net },
          ],
        });
      }
      await tx.query(`update settlement_records set status = 'SETTLED', settled_at = now(), amount_cents = $2 where payment_transaction_id = $1`, [
        txn.id,
        net,
      ]);
      await tx.query(`update payment_transactions set state = 'SETTLED', settled_at = now() where id = $1`, [txn.id]);
      await this.event(tx, txn.id, 'STATE_CHANGED', txn.state, 'SETTLED', { netCents: net });
      return toTransactionDto((await loadTransaction(tx, txn.id))!);
    });
  }

  /** Completes settlement for every transaction pending longer than delayMs. */
  async completeDueSettlements(delayMs: number): Promise<SimulatedTransactionDto[]> {
    const { rows } = await this.db.query<{ payment_transaction_id: string }>(
      `select payment_transaction_id from settlement_records
        where status = 'PENDING' and created_at < now() - ($1 || ' milliseconds')::interval`,
      [String(delayMs)],
    );
    const out: SimulatedTransactionDto[] = [];
    for (const r of rows) out.push(await this.completeSettlement(r.payment_transaction_id));
    return out;
  }

  async refund(args: {
    transactionId: string;
    terminalId: string;
    amountCents?: number;
    reason?: string;
    idempotencyKey: string;
  }): Promise<{ transaction: SimulatedTransactionDto; refundId: string; replayed: boolean }> {
    return this.db.transaction(async (tx) => {
      const txn = await this.lockOwned(tx, args.transactionId, args.terminalId);
      const prior = await tx.query<{ id: string; amount_cents: number }>(
        'select id, amount_cents from refund_records where payment_transaction_id = $1 and idempotency_key = $2',
        [txn.id, args.idempotencyKey],
      );
      if (prior.rows[0]) {
        return { transaction: toTransactionDto(txn), refundId: prior.rows[0].id, replayed: true };
      }
      const refundable = txn.captured_cents - txn.refunded_cents;
      const amount = args.amountCents ?? refundable;
      if (refundable <= 0) throw new ReclaimedError('INVALID_PAYMENT_STATE', 'Nothing left to refund.');
      if (amount <= 0 || amount > refundable) {
        throw new ReclaimedError('VALIDATION_FAILED', `Refund must be between 1 and ${refundable} cents.`);
      }
      const nextState: PaymentState = amount === refundable ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      if (txn.state === 'SETTLEMENT_PENDING') {
        throw new ReclaimedError('INVALID_PAYMENT_STATE', 'Wait for settlement to complete before refunding.');
      }
      assertTransition(txn.state, nextState);
      const funding = await this.fundingFor(tx, txn);
      const card = (await tx.query<{ lithic_card_token: string | null }>('select lithic_card_token from reclaimed_cards where id = $1', [txn.reclaimed_card_id])).rows[0];
      const resp = await this.deps.processor.refund({
        processorReference: txn.processor_reference,
        amountCents: amount,
        merchantName: txn.merchant_name,
        lithicCardToken: card?.lithic_card_token ?? null,
      });
      if (!resp.ok) throw new ReclaimedError('INTERNAL_ERROR', 'Processor rejected the refund.');
      await this.deps.funding.creditBack(tx, funding.id, amount);
      const refund = (
        await tx.query<{ id: string }>(
          `insert into refund_records (payment_transaction_id, amount_cents, reason, processor_reference, idempotency_key)
           values ($1, $2, $3, $4, $5) returning id`,
          [txn.id, amount, args.reason ?? null, resp.processorReference, args.idempotencyKey],
        )
      ).rows[0]!;
      const source = txn.settled_at ? SYSTEM_ACCOUNTS.settlementCash : SYSTEM_ACCOUNTS.merchantPayable;
      await this.deps.ledger.post(tx, {
        type: 'REFUND',
        description: `Refund ${txn.reference} ${txn.merchant_name}${txn.settled_at ? ' (post-settlement)' : ''}`,
        idempotencyKey: `refund:${refund.id}`,
        paymentTransactionId: txn.id,
        lines: [
          { account: source, direction: 'DEBIT', amountCents: amount },
          { account: fundingSpendAccount(funding.id, funding.display_name, funding.user_id), direction: 'CREDIT', amountCents: amount },
        ],
      });
      await tx.query(`update payment_transactions set state = $2, refunded_cents = refunded_cents + $3 where id = $1`, [
        txn.id,
        nextState,
        amount,
      ]);
      await this.processorEvent(tx, txn, 'refund', resp.processorReference);
      await this.event(tx, txn.id, 'STATE_CHANGED', txn.state, nextState, { amountCents: amount, refundId: refund.id });
      return { transaction: toTransactionDto((await loadTransaction(tx, txn.id))!), refundId: refund.id, replayed: false };
    });
  }

  private async lockOwned(tx: Queryable, transactionId: string, terminalId: string): Promise<PaymentTransactionRow> {
    const txn = (await tx.query<PaymentTransactionRow>('select * from payment_transactions where id = $1 for update', [transactionId]))
      .rows[0];
    if (!txn || txn.terminal_id !== terminalId) throw new ReclaimedError('NOT_FOUND', 'Transaction not found for this terminal.');
    return txn;
  }

  private async fundingFor(tx: Queryable, txn: PaymentTransactionRow) {
    if (!txn.funding_account_id || !txn.user_id) {
      throw new ReclaimedError('INVALID_PAYMENT_STATE', 'Transaction has no funding account.');
    }
    const account = await this.deps.funding.lock(tx, txn.funding_account_id, txn.user_id);
    if (!account) throw new ReclaimedError('INVALID_PAYMENT_STATE', 'Funding account no longer exists.');
    return account;
  }

  private async processorEvent(tx: Queryable, txn: PaymentTransactionRow, type: string, ref: string | null): Promise<void> {
    await tx.query(
      `insert into processor_events (processor, event_type, external_id, payment_transaction_id, payload) values ($1, $2, $3, $4, '{}')`,
      [txn.processor, type, ref ? `${type}:${ref}` : null, txn.id],
    );
  }

  private async event(db: Queryable, txnId: string, type: string, from: string | null, to: string | null, detail: Record<string, unknown> = {}) {
    await db.query(
      `insert into authorization_events (payment_transaction_id, event_type, from_state, to_state, detail) values ($1, $2, $3, $4, $5)`,
      [txnId, type, from, to, JSON.stringify(detail)],
    );
  }
}
