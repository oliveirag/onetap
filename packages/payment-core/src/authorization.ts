import { ReclaimedError, type AuthorizationResult, type PaymentState } from '@reclaimed/shared';
import type { Database, Queryable } from '@reclaimed/database';
import { systemClock, hrnow, msSince, type Clock } from './clock.js';
import type { FundingProvider, MockFundingRow } from './funding.js';
import type { FundingSelector } from './funding-selector.js';
import { fundingHoldsAccount, SYSTEM_ACCOUNTS, TransactionLedger } from './ledger.js';
import {
  loadAuthorizationDto,
  loadTransaction,
  toTransactionDto,
  type PaymentTransactionRow,
  type ReclaimedCardRow,
} from './mappers.js';
import { AbortError, type PaymentProcessor } from './processor.js';
import { assertTransition, SPEND_COUNTING_STATES } from './state-machine.js';
import type { AuthorizationDto, SimulatedTransactionDto } from '@reclaimed/shared';

export interface AuthorizationInput {
  transactionId: string;
  reclaimedCardId: string | null;
  merchantId: string;
  merchantName: string;
  mcc: string;
  amountCents: number;
  currency: string;
  terminalId: string;
  timestamp: string;
  tapEventId?: string | null;
}

export interface AuthorizationOutcome {
  result: AuthorizationResult;
  transaction: SimulatedTransactionDto;
  authorization: AuthorizationDto;
  /** True when this call returned a previously computed result (idempotent replay). */
  replayed: boolean;
}

export interface AuthorizationServiceOptions {
  /** Hard ceiling for the processor round trip. */
  authorizationTimeoutMs: number;
}

interface AuthLog {
  event: string;
  detail?: Record<string, unknown>;
}

const DECLINE_STATE: Record<AuthorizationResult, PaymentState> = {
  APPROVED: 'AUTHORIZED',
  DECLINED: 'DECLINED',
  CARD_FROZEN: 'DECLINED',
  INVALID_CARD: 'DECLINED',
  INSUFFICIENT_FUNDS: 'DECLINED',
  LIMIT_EXCEEDED: 'DECLINED',
  AUTHORIZATION_TIMEOUT: 'FAILED',
  INTERNAL_ERROR: 'FAILED',
};

/**
 * Deterministic, real-time authorization engine for simulated Reclaimed card
 * transactions. No AI or probabilistic logic is involved.
 *
 * Pipeline:
 *  1. Lock checkout → validate terminal, state, deadline, amount/currency/merchant.
 *  2. Validate card (status) and user (status); apply per-transaction and daily limits.
 *  3. Ask the FundingSelector for an ordered candidate list (primary, optional secondary).
 *  4. For each candidate: lock + evaluate mock funds → place hold (+ ledger) → processor.
 *     Eligible failures (insufficient funds / inactive account / processor NSF) fall back.
 *  5. Persist the result, latencies, funding attempts and events.
 */
export class AuthorizationService {
  constructor(
    private readonly db: Database,
    private readonly deps: {
      funding: FundingProvider;
      selector: FundingSelector;
      processor: PaymentProcessor;
      ledger: TransactionLedger;
      clock?: Clock;
    },
    private readonly options: AuthorizationServiceOptions,
  ) {}

  private get clock(): Clock {
    return this.deps.clock ?? systemClock;
  }

  async authorize(input: AuthorizationInput): Promise<AuthorizationOutcome> {
    const started = hrnow();
    const logs: AuthLog[] = [];

    // ---------- Stage 1: validation & reservation (single DB transaction) ----------
    const dbStart = hrnow();
    const stage1 = await this.db.transaction(async (tx) => {
      const txn = (
        await tx.query<PaymentTransactionRow>('select * from payment_transactions where id = $1 for update', [
          input.transactionId,
        ])
      ).rows[0];
      if (!txn) throw new ReclaimedError('NOT_FOUND', 'Checkout not found.');
      if (txn.terminal_id !== input.terminalId) {
        throw new ReclaimedError('TERMINAL_AUTH_FAILED', 'Checkout does not belong to this terminal.');
      }

      // Idempotency: any checkout that already has an authorization attempt is replayed.
      const existing = await tx.query<{ id: string; result: string | null }>(
        'select id, result from authorization_attempts where payment_transaction_id = $1',
        [txn.id],
      );
      if (existing.rows[0]) return { kind: 'replay' as const };

      if (txn.state !== 'CREATED') {
        throw new ReclaimedError('INVALID_PAYMENT_STATE', `Checkout is ${txn.state}.`);
      }
      if (
        txn.amount_cents !== input.amountCents ||
        txn.currency !== input.currency.toUpperCase() ||
        txn.merchant_id !== input.merchantId ||
        txn.mcc !== input.mcc
      ) {
        throw new ReclaimedError('VALIDATION_FAILED', 'Authorization request does not match the pending checkout.');
      }

      const card = (
        await tx.query<ReclaimedCardRow>('select * from reclaimed_cards where id = $1 for update', [input.reclaimedCardId])
      ).rows[0];
      const profile = card
        ? (await tx.query<{ status: string }>('select status from profiles where id = $1', [card.user_id])).rows[0]
        : undefined;

      const attempt = (
        await tx.query<{ id: string }>(
          `insert into authorization_attempts
             (payment_transaction_id, tap_event_id, user_id, reclaimed_card_id, processor, request)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [
            txn.id,
            input.tapEventId ?? null,
            card?.user_id ?? null,
            card?.id ?? null,
            this.deps.processor.name,
            JSON.stringify({ ...input, reclaimedCardId: card?.id ?? null }),
          ],
        )
      ).rows[0]!;

      assertTransition(txn.state, 'AUTHORIZATION_PENDING');
      await tx.query(
        `update payment_transactions
            set state = 'AUTHORIZATION_PENDING', user_id = $2, reclaimed_card_id = $3, processor = $4
          where id = $1`,
        [txn.id, card?.user_id ?? null, card?.id ?? null, this.deps.processor.name],
      );
      await this.event(tx, txn.id, attempt.id, 'STATE_CHANGED', 'CREATED', 'AUTHORIZATION_PENDING');

      // Pre-funding declines.
      let early: { result: AuthorizationResult; reason: string } | null = null;
      if (this.clock.now() > new Date(txn.expires_at)) {
        early = { result: 'AUTHORIZATION_TIMEOUT', reason: 'CHECKOUT_EXPIRED' };
      } else if (!card) {
        early = { result: 'INVALID_CARD', reason: 'CARD_NOT_ENROLLED' };
      } else if (card.status === 'FROZEN') {
        early = { result: 'CARD_FROZEN', reason: 'CARD_FROZEN' };
      } else if (card.status !== 'ACTIVE') {
        early = { result: 'INVALID_CARD', reason: `CARD_${card.status}` };
      } else if (profile?.status !== 'ACTIVE') {
        early = { result: 'DECLINED', reason: 'USER_ACCOUNT_NOT_ACTIVE' };
      } else if (txn.amount_cents > card.per_transaction_limit_cents) {
        early = { result: 'LIMIT_EXCEEDED', reason: 'PER_TRANSACTION_LIMIT' };
      } else {
        const spent = await this.spentToday(tx, card.id, txn.id);
        if (spent + txn.amount_cents > card.daily_limit_cents) {
          early = { result: 'LIMIT_EXCEEDED', reason: 'DAILY_LIMIT' };
        }
      }
      if (card) await tx.query('update reclaimed_cards set last_tapped_at = now() where id = $1', [card.id]);
      return { kind: 'proceed' as const, txn, card, attemptId: attempt.id, early };
    });
    const dbLookupMs = msSince(dbStart);

    if (stage1.kind === 'replay') {
      return this.replay(input.transactionId);
    }

    const { txn, card, attemptId } = stage1;
    let fundingEvaluationMs = 0;
    let processorMs = 0;

    if (stage1.early || !card) {
      const early = stage1.early ?? { result: 'INVALID_CARD' as const, reason: 'CARD_NOT_ENROLLED' };
      logs.push({ event: 'PRE_FUNDING_DECLINE', detail: early });
      await this.finalize(txn, attemptId, early.result, early.reason, null, null, logs, {
        totalMs: msSince(started),
        dbLookupMs,
        fundingEvaluationMs,
        processorMs,
      });
      return this.replay(txn.id, false);
    }

    // ---------- Stage 2: funding selection with deterministic fallback ----------
    let final: { result: AuthorizationResult; reason: string | null; funding: MockFundingRow | null; ref: string | null } = {
      result: 'DECLINED',
      reason: 'NO_FUNDING_ACCOUNT_CONFIGURED',
      funding: null,
      ref: null,
    };
    try {
      const candidates = await this.deps.selector.selectCandidates(this.db, {
        userId: card.user_id,
        reclaimedCardId: card.id,
        primaryFundingAccountId: card.primary_funding_account_id,
        secondaryFundingAccountId: card.secondary_funding_account_id,
        fallbackEnabled: card.fallback_enabled,
        merchantId: txn.merchant_id,
        merchantName: txn.merchant_name,
        mcc: txn.mcc,
        amountCents: txn.amount_cents,
      });
      logs.push({ event: 'FUNDING_CANDIDATES', detail: { selector: this.deps.selector.name, candidates } });

      let sequence = 0;
      for (const fundingId of candidates) {
        sequence += 1;
        const fStart = hrnow();
        const hold = await this.db.transaction(async (tx) => {
          const account = await this.deps.funding.lock(tx, fundingId, card.user_id);
          if (!account) {
            await this.fundingAttempt(tx, attemptId, null, 'Unknown account', sequence, 'DECLINED', 'FUNDING_ACCOUNT_NOT_FOUND');
            return { ok: false as const, fallbackEligible: true, result: 'DECLINED' as AuthorizationResult, reason: 'FUNDING_ACCOUNT_NOT_FOUND', account: null };
          }
          const decision = this.deps.funding.evaluate(account, txn.amount_cents);
          if (!decision.ok) {
            await this.fundingAttempt(tx, attemptId, account.id, account.display_name, sequence, decision.result, decision.reason);
            return { ok: false as const, fallbackEligible: decision.fallbackEligible, result: decision.result, reason: decision.reason, account };
          }
          await this.deps.funding.placeHold(tx, account, txn.amount_cents);
          await this.deps.ledger.post(tx, {
            type: 'AUTHORIZATION_HOLD',
            description: `Hold ${txn.reference} ${txn.merchant_name} on ${account.display_name}`,
            idempotencyKey: `auth-hold:${txn.id}:${account.id}`,
            paymentTransactionId: txn.id,
            lines: [
              { account: fundingHoldsAccount(account.id, account.display_name, account.user_id), direction: 'DEBIT', amountCents: txn.amount_cents },
              { account: SYSTEM_ACCOUNTS.pendingMerchantPayable, direction: 'CREDIT', amountCents: txn.amount_cents },
            ],
          });
          return { ok: true as const, account };
        });
        fundingEvaluationMs += msSince(fStart);

        if (!hold.ok) {
          logs.push({ event: 'FUNDING_DECLINED', detail: { fundingId, sequence, result: hold.result, reason: hold.reason } });
          final = { result: hold.result, reason: hold.reason, funding: hold.account, ref: null };
          if (hold.fallbackEligible) continue;
          break;
        }

        // Processor round trip with a hard deadline.
        const account = hold.account;
        const pStart = hrnow();
        const remaining = Math.max(0, new Date(txn.expires_at).getTime() - this.clock.now().getTime());
        const timeoutMs = Math.min(this.options.authorizationTimeoutMs, remaining || this.options.authorizationTimeoutMs);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
          response = await this.deps.processor.authorize(
            {
              paymentTransactionId: txn.id,
              reference: txn.reference,
              amountCents: txn.amount_cents,
              currency: txn.currency,
              merchantId: txn.merchant_id,
              merchantName: txn.merchant_name,
              mcc: txn.mcc,
              reclaimedCardId: card.id,
              lithicCardToken: card.lithic_card_token,
              fundingAccountId: account.id,
            },
            controller.signal,
          );
        } catch (err) {
          const timedOut = err instanceof AbortError || controller.signal.aborted;
          processorMs += msSince(pStart);
          await this.releaseHold(txn, account, attemptId, sequence, timedOut ? 'AUTHORIZATION_TIMEOUT' : 'INTERNAL_ERROR',
            timedOut ? `Processor exceeded ${timeoutMs}ms` : errorMessage(err));
          logs.push({ event: timedOut ? 'PROCESSOR_TIMEOUT' : 'PROCESSOR_ERROR', detail: { message: errorMessage(err) } });
          final = { result: timedOut ? 'AUTHORIZATION_TIMEOUT' : 'INTERNAL_ERROR', reason: timedOut ? 'PROCESSOR_TIMEOUT' : 'PROCESSOR_ERROR', funding: account, ref: null };
          break;
        } finally {
          clearTimeout(timer);
        }
        processorMs += msSince(pStart);
        await this.db.query(
          `insert into processor_events (processor, event_type, external_id, payment_transaction_id, payload)
           values ($1, 'authorization.response', $2, $3, $4)`,
          [this.deps.processor.name, response.processorReference ? `authorization:${response.processorReference}` : null, txn.id, JSON.stringify({ approved: response.approved, declineCode: response.declineCode ?? null, raw: response.raw ?? null })],
        );

        if (response.approved) {
          await this.db.query(
            `insert into funding_attempts (authorization_attempt_id, funding_account_id, funding_account_name, sequence, result)
             values ($1, $2, $3, $4, 'APPROVED')`,
            [attemptId, account.id, account.display_name, sequence],
          );
          final = { result: 'APPROVED', reason: null, funding: account, ref: response.processorReference };
          logs.push({ event: 'PROCESSOR_APPROVED', detail: { fundingId: account.id, sequence } });
          break;
        }

        const code = response.declineCode ?? 'DECLINED';
        const result: AuthorizationResult = code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'DECLINED';
        await this.releaseHold(txn, account, attemptId, sequence, result, response.declineReason ?? 'PROCESSOR_DECLINED');
        logs.push({ event: 'PROCESSOR_DECLINED', detail: { fundingId: account.id, code } });
        final = { result, reason: response.declineReason ?? 'PROCESSOR_DECLINED', funding: account, ref: response.processorReference };
        if (result !== 'INSUFFICIENT_FUNDS') break;
      }
    } catch (err) {
      logs.push({ event: 'INTERNAL_ERROR', detail: { message: errorMessage(err) } });
      final = { result: 'INTERNAL_ERROR', reason: 'INTERNAL_ERROR', funding: final.funding, ref: null };
    }

    await this.finalize(txn, attemptId, final.result, final.reason, final.result === 'APPROVED' ? final.funding : null, final.ref, logs, {
      totalMs: msSince(started),
      dbLookupMs,
      fundingEvaluationMs,
      processorMs,
    });
    return this.replay(txn.id, false);
  }

  private async releaseHold(
    txn: PaymentTransactionRow,
    account: MockFundingRow,
    attemptId: string,
    sequence: number,
    result: AuthorizationResult,
    reason: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.deps.funding.releaseHold(tx, account.id, txn.amount_cents);
      await this.deps.ledger.post(tx, {
        type: 'AUTHORIZATION_REVERSAL',
        description: `Release hold ${txn.reference} (${result})`,
        idempotencyKey: `auth-release:${txn.id}:${account.id}`,
        paymentTransactionId: txn.id,
        lines: [
          { account: SYSTEM_ACCOUNTS.pendingMerchantPayable, direction: 'DEBIT', amountCents: txn.amount_cents },
          { account: fundingHoldsAccount(account.id, account.display_name, account.user_id), direction: 'CREDIT', amountCents: txn.amount_cents },
        ],
      });
      await this.fundingAttempt(tx, attemptId, account.id, account.display_name, sequence, result, reason);
    });
  }

  private async finalize(
    txn: PaymentTransactionRow,
    attemptId: string,
    result: AuthorizationResult,
    reason: string | null,
    funding: MockFundingRow | null,
    processorReference: string | null,
    logs: AuthLog[],
    latency: { totalMs: number; dbLookupMs: number; fundingEvaluationMs: number; processorMs: number },
  ): Promise<void> {
    const toState = DECLINE_STATE[result];
    assertTransition('AUTHORIZATION_PENDING', toState);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `update payment_transactions
            set state = $2, authorization_result = $3, decline_reason = $4,
                funding_account_id = $5, funding_account_name = $6, processor_reference = $7,
                authorized_at = case when $3 = 'APPROVED' then now() else authorized_at end
          where id = $1 and state = 'AUTHORIZATION_PENDING'`,
        [txn.id, toState, result, reason, funding?.id ?? null, funding?.display_name ?? null, processorReference],
      );
      await tx.query(
        `update authorization_attempts
            set result = $2, decline_reason = $3, total_ms = $4, db_lookup_ms = $5,
                funding_evaluation_ms = $6, processor_ms = $7, completed_at = now()
          where id = $1`,
        [attemptId, result, reason, latency.totalMs, latency.dbLookupMs, latency.fundingEvaluationMs, latency.processorMs],
      );
      for (const l of logs) await this.event(tx, txn.id, attemptId, l.event, null, null, l.detail);
      await this.event(tx, txn.id, attemptId, 'STATE_CHANGED', 'AUTHORIZATION_PENDING', toState, { result, reason, latency });
    });
  }

  private async replay(transactionId: string, replayed = true): Promise<AuthorizationOutcome> {
    // A duplicate request that races an in-flight authorization waits for its final result.
    const deadline = Date.now() + this.options.authorizationTimeoutMs + 5_000;
    while (replayed && Date.now() < deadline) {
      const { rows } = await this.db.query<{ completed_at: Date | null }>(
        'select completed_at from authorization_attempts where payment_transaction_id = $1',
        [transactionId],
      );
      if (rows[0]?.completed_at) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const txn = await loadTransaction(this.db, transactionId);
    const authorization = await loadAuthorizationDto(this.db, { paymentTransactionId: transactionId });
    if (!txn || !authorization) throw new ReclaimedError('INTERNAL_ERROR', 'Authorization record missing.');
    return { result: authorization.result, transaction: toTransactionDto(txn), authorization, replayed };
  }

  private async spentToday(tx: Queryable, cardId: string, excludeTxnId: string): Promise<number> {
    const { rows } = await tx.query<{ total: number | null }>(
      `select coalesce(sum(amount_cents - refunded_cents), 0)::bigint as total
         from payment_transactions
        where reclaimed_card_id = $1 and id <> $2
          and state = any($3::text[])
          and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
      [cardId, excludeTxnId, SPEND_COUNTING_STATES],
    );
    return rows[0]?.total ?? 0;
  }

  private async fundingAttempt(
    tx: Queryable,
    attemptId: string,
    fundingId: string | null,
    name: string,
    sequence: number,
    result: AuthorizationResult,
    reason: string | null,
  ): Promise<void> {
    await tx.query(
      `insert into funding_attempts (authorization_attempt_id, funding_account_id, funding_account_name, sequence, result, reason)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (authorization_attempt_id, sequence) do update set result = excluded.result, reason = excluded.reason`,
      [attemptId, fundingId, name, sequence, result, reason],
    );
  }

  private async event(
    tx: Queryable,
    paymentTransactionId: string,
    attemptId: string | null,
    type: string,
    from: string | null,
    to: string | null,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await tx.query(
      `insert into authorization_events (payment_transaction_id, authorization_attempt_id, event_type, from_state, to_state, detail)
       values ($1, $2, $3, $4, $5, $6)`,
      [paymentTransactionId, attemptId, type, from, to, JSON.stringify(detail)],
    );
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
