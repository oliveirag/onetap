import {
  ReclaimedError,
  type BillPaymentDto,
  type BillPaymentScenario,
  type BillPaymentState,
  type CreateBillPaymentInput,
} from '@reclaimed/shared';
import type { Database, Queryable } from '@reclaimed/database';
import type { FundingProvider } from './funding.js';
import { newProviderReference } from './ids.js';
import { fundingHoldsAccount, fundingSpendAccount, SYSTEM_ACCOUNTS, TransactionLedger } from './ledger.js';
import { loadBillPaymentDto, type BillPaymentRow } from './mappers.js';

/**
 * A bill-payment rail. Phase 1 ships only MockBillPaymentProvider, which NEVER
 * initiates ACH or contacts an issuer.
 */
export interface BillPaymentProvider {
  readonly name: 'mock';
  validate(input: { amountCents: number; targetAccountType: string }): { ok: boolean; reason?: string };
  submit(input: { intentId: string; amountCents: number; scenario: BillPaymentScenario }): Promise<{ accepted: boolean; reference: string; detail?: string }>;
  /** Given the current state, decide the next simulated state (or null when final). */
  nextState(state: BillPaymentState, scenario: BillPaymentScenario): { state: BillPaymentState; note: string } | null;
}

export class MockBillPaymentProvider implements BillPaymentProvider {
  readonly name = 'mock' as const;

  validate(input: { amountCents: number; targetAccountType: string }) {
    if (input.targetAccountType !== 'credit') return { ok: false, reason: 'Only credit card accounts can receive test bill payments.' };
    if (input.amountCents < 100) return { ok: false, reason: 'Minimum test payment is $1.00.' };
    return { ok: true };
  }

  async submit(input: { intentId: string; amountCents: number; scenario: BillPaymentScenario }) {
    return { accepted: true, reference: newProviderReference('MOCKBILL'), detail: `scenario=${input.scenario}` };
  }

  nextState(state: BillPaymentState, scenario: BillPaymentScenario) {
    switch (state) {
      case 'SUBMITTED':
        return { state: 'PROCESSING' as const, note: 'Simulated provider began processing.' };
      case 'PROCESSING':
        return scenario === 'FAIL'
          ? { state: 'FAILED' as const, note: 'Simulated failure: issuer rejected the test payment.' }
          : { state: 'COMPLETED' as const, note: 'Simulated payment completed. No real money moved.' };
      case 'COMPLETED':
        return scenario === 'RETURN' ? { state: 'RETURNED' as const, note: 'Simulated return (R01-style test return).' } : null;
      default:
        return null;
    }
  }
}

export interface BillPayTimings {
  submittedToProcessingMs: number;
  processingToFinalMs: number;
  completedToReturnMs: number;
}

/**
 * TEST MODE credit-card bill payments funded from mock funding accounts.
 * Plaid-reported balances in financial_accounts are NEVER modified.
 */
export class BillPaymentService {
  constructor(
    private readonly db: Database,
    private readonly deps: { provider: BillPaymentProvider; funding: FundingProvider; ledger: TransactionLedger },
    private readonly timings: BillPayTimings,
  ) {}

  async create(userId: string, input: CreateBillPaymentInput, idempotencyKey: string | null): Promise<{ payment: BillPaymentDto; replayed: boolean }> {
    if (idempotencyKey) {
      const prior = await this.db.query<{ id: string }>(
        'select id from bill_payment_intents where user_id = $1 and idempotency_key = $2',
        [userId, idempotencyKey],
      );
      if (prior.rows[0]) return { payment: (await loadBillPaymentDto(this.db, prior.rows[0].id, userId))!, replayed: true };
    }
    try {
      const id = await this.db.transaction(async (tx) => {
        const account = (
          await tx.query<{ id: string; name: string; type: string }>(
            'select id, name, type from financial_accounts where id = $1 and user_id = $2 and is_active',
            [input.financialAccountId, userId],
          )
        ).rows[0];
        if (!account) throw new ReclaimedError('NOT_FOUND', 'Credit card account not found.');
        const v = this.deps.provider.validate({ amountCents: input.amountCents, targetAccountType: account.type });
        if (!v.ok) throw new ReclaimedError('VALIDATION_FAILED', v.reason);
        const funding = await this.deps.funding.lock(tx, input.fundingAccountId, userId);
        if (!funding) throw new ReclaimedError('NOT_FOUND', 'Mock funding account not found.');

        const intent = (
          await tx.query<{ id: string }>(
            `insert into bill_payment_intents
               (user_id, financial_account_id, financial_account_name, funding_account_id, funding_account_name,
                amount_cents, scenario, idempotency_key)
             values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
            [userId, account.id, account.name, funding.id, funding.display_name, input.amountCents, input.scenario, idempotencyKey],
          )
        ).rows[0]!;
        await this.event(tx, intent.id, 'DRAFT', 'Draft created.');
        if (input.confirm) await this.submitLocked(tx, intent.id, userId);
        return intent.id;
      });
      return { payment: (await loadBillPaymentDto(this.db, id, userId))!, replayed: false };
    } catch (err) {
      // Concurrent duplicate submission with the same idempotency key.
      if ((err as { code?: string }).code === '23505' && idempotencyKey) {
        const prior = await this.db.query<{ id: string }>(
          'select id from bill_payment_intents where user_id = $1 and idempotency_key = $2',
          [userId, idempotencyKey],
        );
        if (prior.rows[0]) return { payment: (await loadBillPaymentDto(this.db, prior.rows[0].id, userId))!, replayed: true };
      }
      throw err;
    }
  }

  async submit(userId: string, intentId: string): Promise<BillPaymentDto> {
    await this.db.transaction((tx) => this.submitLocked(tx, intentId, userId));
    return (await loadBillPaymentDto(this.db, intentId, userId))!;
  }

  private async submitLocked(tx: Queryable, intentId: string, userId: string): Promise<void> {
    const intent = await this.lock(tx, intentId, userId);
    if (intent.state !== 'DRAFT') throw new ReclaimedError('INVALID_PAYMENT_STATE', `Payment is ${intent.state}.`);
    if (!intent.funding_account_id) throw new ReclaimedError('VALIDATION_FAILED', 'Funding account was removed.');
    const funding = await this.deps.funding.lock(tx, intent.funding_account_id, userId);
    if (!funding) throw new ReclaimedError('NOT_FOUND', 'Mock funding account not found.');
    const decision = this.deps.funding.evaluate(funding, intent.amount_cents);
    if (!decision.ok) {
      throw new ReclaimedError(
        decision.result === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'PAYMENT_DECLINED',
        decision.result === 'INSUFFICIENT_FUNDS'
          ? `${funding.display_name} does not have enough simulated funds.`
          : `${funding.display_name} is not active.`,
      );
    }
    const resp = await this.deps.provider.submit({ intentId, amountCents: intent.amount_cents, scenario: intent.scenario });
    const attempts = await tx.query<{ n: number }>('select count(*)::int as n from bill_payment_attempts where intent_id = $1', [intentId]);
    await tx.query(
      `insert into bill_payment_attempts (intent_id, attempt_number, provider, provider_reference, result, detail)
       values ($1, $2, $3, $4, $5, $6)`,
      [intentId, (attempts.rows[0]?.n ?? 0) + 1, this.deps.provider.name, resp.reference, resp.accepted ? 'ACCEPTED' : 'REJECTED', resp.detail ?? null],
    );
    if (!resp.accepted) throw new ReclaimedError('PAYMENT_DECLINED', 'The simulated bill-pay provider rejected the payment.');

    await this.deps.funding.placeHold(tx, funding, intent.amount_cents);
    await this.deps.ledger.post(tx, {
      type: 'BILL_PAYMENT_HOLD',
      description: `Test bill payment hold to ${intent.financial_account_name ?? 'card'}`,
      idempotencyKey: `bill-hold:${intentId}`,
      billPaymentIntentId: intentId,
      lines: [
        { account: fundingHoldsAccount(funding.id, funding.display_name, userId), direction: 'DEBIT', amountCents: intent.amount_cents },
        { account: SYSTEM_ACCOUNTS.billPayInTransit, direction: 'CREDIT', amountCents: intent.amount_cents },
      ],
    });
    await tx.query(
      `update bill_payment_intents set state = 'SUBMITTED', submitted_at = now(),
              next_transition_at = now() + ($2 || ' milliseconds')::interval where id = $1`,
      [intentId, String(this.timings.submittedToProcessingMs)],
    );
    await this.event(tx, intentId, 'SUBMITTED', 'Submitted to the mock bill-pay provider. TEST MODE — no real money moved.');
  }

  async cancel(userId: string, intentId: string): Promise<BillPaymentDto> {
    await this.db.transaction(async (tx) => {
      const intent = await this.lock(tx, intentId, userId);
      if (intent.state !== 'DRAFT' && intent.state !== 'SUBMITTED') {
        throw new ReclaimedError('INVALID_PAYMENT_STATE', `A ${intent.state} payment can no longer be canceled.`);
      }
      if (intent.state === 'SUBMITTED') await this.release(tx, intent, 'canceled');
      await tx.query(`update bill_payment_intents set state = 'CANCELED', canceled_at = now(), next_transition_at = null where id = $1`, [intentId]);
      await this.event(tx, intentId, 'CANCELED', 'Canceled by user.');
    });
    return (await loadBillPaymentDto(this.db, intentId, userId))!;
  }

  /**
   * Advances simulated payments whose next_transition_at has passed.
   * Called by the API's background job; `now` is injectable for tests.
   */
  async tick(now: Date = new Date()): Promise<{ id: string; userId: string; state: BillPaymentState }[]> {
    const due = await this.db.query<{ id: string }>(
      `select id from bill_payment_intents
        where state in ('SUBMITTED', 'PROCESSING', 'COMPLETED') and next_transition_at is not null and next_transition_at <= $1
        order by next_transition_at limit 100`,
      [now],
    );
    const changed: { id: string; userId: string; state: BillPaymentState }[] = [];
    for (const { id } of due.rows) {
      const r = await this.db.transaction(async (tx) => {
        const intent = (await tx.query<BillPaymentRow>('select * from bill_payment_intents where id = $1 for update', [id])).rows[0];
        if (!intent || !intent.next_transition_at || new Date(intent.next_transition_at) > now) return null;
        const next = this.deps.provider.nextState(intent.state, intent.scenario);
        if (!next) {
          await tx.query('update bill_payment_intents set next_transition_at = null where id = $1', [id]);
          return null;
        }
        await this.apply(tx, intent, next.state);
        await this.event(tx, id, next.state, next.note);
        return { id, userId: intent.user_id, state: next.state };
      });
      if (r) changed.push(r);
    }
    return changed;
  }

  private async apply(tx: Queryable, intent: BillPaymentRow, to: BillPaymentState): Promise<void> {
    const delayFor = (ms: number) => [String(ms)];
    switch (to) {
      case 'PROCESSING':
        await tx.query(
          `update bill_payment_intents set state = 'PROCESSING', processing_at = now(),
                  next_transition_at = now() + ($2 || ' milliseconds')::interval where id = $1`,
          [intent.id, ...delayFor(this.timings.processingToFinalMs)],
        );
        return;
      case 'FAILED':
        await this.release(tx, intent, 'failed');
        await tx.query(
          `update bill_payment_intents set state = 'FAILED', failed_at = now(), next_transition_at = null,
                  failure_reason = 'SIMULATED_ISSUER_REJECTION' where id = $1`,
          [intent.id],
        );
        return;
      case 'COMPLETED': {
        const f = await this.fundingRow(tx, intent);
        await this.deps.funding.postFromHold(tx, f.id, intent.amount_cents, intent.amount_cents);
        await this.deps.ledger.post(tx, {
          type: 'BILL_PAYMENT_COMPLETION',
          description: `Test bill payment completed to ${intent.financial_account_name ?? 'card'} (no real money moved)`,
          idempotencyKey: `bill-complete:${intent.id}`,
          billPaymentIntentId: intent.id,
          lines: [
            { account: SYSTEM_ACCOUNTS.billPayInTransit, direction: 'DEBIT', amountCents: intent.amount_cents },
            { account: fundingHoldsAccount(f.id, f.display_name, intent.user_id), direction: 'CREDIT', amountCents: intent.amount_cents },
            { account: fundingSpendAccount(f.id, f.display_name, intent.user_id), direction: 'DEBIT', amountCents: intent.amount_cents },
            { account: SYSTEM_ACCOUNTS.issuerRemittance, direction: 'CREDIT', amountCents: intent.amount_cents },
          ],
        });
        const returnLater = intent.scenario === 'RETURN';
        await tx.query(
          `update bill_payment_intents set state = 'COMPLETED', completed_at = now(),
                  next_transition_at = case when $2 then now() + ($3 || ' milliseconds')::interval else null end
            where id = $1`,
          [intent.id, returnLater, String(this.timings.completedToReturnMs)],
        );
        return;
      }
      case 'RETURNED': {
        const f = await this.fundingRow(tx, intent);
        await this.deps.funding.creditBack(tx, f.id, intent.amount_cents);
        // Reverse the debit leg: deposit funds come back / owed amount restored.
        await this.deps.ledger.post(tx, {
          type: 'BILL_PAYMENT_RETURN',
          description: `Test bill payment returned from ${intent.financial_account_name ?? 'card'}`,
          idempotencyKey: `bill-return:${intent.id}`,
          billPaymentIntentId: intent.id,
          lines: [
            { account: SYSTEM_ACCOUNTS.issuerRemittance, direction: 'DEBIT', amountCents: intent.amount_cents },
            { account: fundingSpendAccount(f.id, f.display_name, intent.user_id), direction: 'CREDIT', amountCents: intent.amount_cents },
          ],
        });
        await tx.query(
          `update bill_payment_intents set state = 'RETURNED', returned_at = now(), next_transition_at = null,
                  failure_reason = 'SIMULATED_RETURN' where id = $1`,
          [intent.id],
        );
        return;
      }
      default:
        throw new ReclaimedError('INVALID_PAYMENT_STATE', `Unexpected bill payment transition to ${to}.`);
    }
  }

  private async release(tx: Queryable, intent: BillPaymentRow, why: string): Promise<void> {
    const f = await this.fundingRow(tx, intent);
    await this.deps.funding.releaseHold(tx, f.id, intent.amount_cents);
    await this.deps.ledger.post(tx, {
      type: 'BILL_PAYMENT_RELEASE',
      description: `Test bill payment ${why}; hold released`,
      idempotencyKey: `bill-release:${intent.id}`,
      billPaymentIntentId: intent.id,
      lines: [
        { account: SYSTEM_ACCOUNTS.billPayInTransit, direction: 'DEBIT', amountCents: intent.amount_cents },
        { account: fundingHoldsAccount(f.id, f.display_name, intent.user_id), direction: 'CREDIT', amountCents: intent.amount_cents },
      ],
    });
  }

  private async fundingRow(tx: Queryable, intent: BillPaymentRow) {
    if (!intent.funding_account_id) throw new ReclaimedError('INVALID_PAYMENT_STATE', 'Funding account was removed.');
    const f = await this.deps.funding.lock(tx, intent.funding_account_id, intent.user_id);
    if (!f) throw new ReclaimedError('INVALID_PAYMENT_STATE', 'Funding account was removed.');
    return f;
  }

  private async lock(tx: Queryable, intentId: string, userId: string): Promise<BillPaymentRow> {
    const r = (await tx.query<BillPaymentRow>('select * from bill_payment_intents where id = $1 and user_id = $2 for update', [intentId, userId]))
      .rows[0];
    if (!r) throw new ReclaimedError('NOT_FOUND', 'Bill payment not found.');
    return r;
  }

  private async event(tx: Queryable, intentId: string, state: BillPaymentState, note: string): Promise<void> {
    await tx.query('insert into bill_payment_events (intent_id, state, note) values ($1, $2, $3)', [intentId, state, note]);
  }
}
