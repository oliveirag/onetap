import { ReclaimedError, type AuthorizationResult, type MockFundingKind, type MockFundingStatus } from '@reclaimed/shared';
import type { Queryable } from '@reclaimed/database';

export interface MockFundingRow {
  id: string;
  user_id: string;
  display_name: string;
  fictional_issuer: string;
  kind: MockFundingKind;
  card_product_id: string | null;
  credit_limit_cents: number;
  current_balance_cents: number;
  pending_holds_cents: number;
  status: MockFundingStatus;
  priority: number;
}

export function availableCents(a: Pick<MockFundingRow, 'kind' | 'credit_limit_cents' | 'current_balance_cents' | 'pending_holds_cents'>): number {
  return a.kind === 'CREDIT'
    ? a.credit_limit_cents - a.current_balance_cents - a.pending_holds_cents
    : a.current_balance_cents - a.pending_holds_cents;
}

export interface FundingDecision {
  ok: boolean;
  result: AuthorizationResult;
  reason: string | null;
  /** Whether the authorization engine may try the next configured funding source. */
  fallbackEligible: boolean;
}

/**
 * A source of (simulated) funds. Phase 1 ships only MockFundingProvider; a future
 * provider backed by an approved issuer integration would implement the same shape.
 */
export interface FundingProvider {
  readonly name: string;
  /** Loads and row-locks a funding account for the duration of tx. */
  lock(tx: Queryable, fundingAccountId: string, userId: string): Promise<MockFundingRow | null>;
  evaluate(account: MockFundingRow, amountCents: number): FundingDecision;
  placeHold(tx: Queryable, account: MockFundingRow, amountCents: number): Promise<void>;
  releaseHold(tx: Queryable, fundingAccountId: string, amountCents: number): Promise<void>;
  /** Converts a hold into posted activity (capture / bill-payment completion). */
  postFromHold(tx: Queryable, fundingAccountId: string, holdCents: number, postCents: number): Promise<void>;
  /** Credits posted activity back (refund / returned bill payment). */
  creditBack(tx: Queryable, fundingAccountId: string, amountCents: number): Promise<void>;
}

export class MockFundingProvider implements FundingProvider {
  readonly name = 'mock';

  async lock(tx: Queryable, fundingAccountId: string, userId: string): Promise<MockFundingRow | null> {
    const { rows } = await tx.query<MockFundingRow>(
      'select * from mock_funding_accounts where id = $1 and user_id = $2 for update',
      [fundingAccountId, userId],
    );
    return rows[0] ?? null;
  }

  evaluate(account: MockFundingRow, amountCents: number): FundingDecision {
    if (account.status !== 'ACTIVE') {
      return { ok: false, result: 'DECLINED', reason: `FUNDING_ACCOUNT_${account.status}`, fallbackEligible: true };
    }
    const available = availableCents(account);
    if (available < amountCents) {
      return {
        ok: false,
        result: 'INSUFFICIENT_FUNDS',
        reason: `Available ${available} < requested ${amountCents}`,
        fallbackEligible: true,
      };
    }
    return { ok: true, result: 'APPROVED', reason: null, fallbackEligible: false };
  }

  async placeHold(tx: Queryable, account: MockFundingRow, amountCents: number): Promise<void> {
    const decision = this.evaluate(account, amountCents);
    if (!decision.ok) throw new ReclaimedError('INSUFFICIENT_FUNDS');
    await tx.query('update mock_funding_accounts set pending_holds_cents = pending_holds_cents + $2 where id = $1', [
      account.id,
      amountCents,
    ]);
  }

  async releaseHold(tx: Queryable, fundingAccountId: string, amountCents: number): Promise<void> {
    await tx.query(
      'update mock_funding_accounts set pending_holds_cents = greatest(0, pending_holds_cents - $2) where id = $1',
      [fundingAccountId, amountCents],
    );
  }

  async postFromHold(tx: Queryable, fundingAccountId: string, holdCents: number, postCents: number): Promise<void> {
    // CREDIT: balance owed goes up. DEPOSIT: funds on deposit go down.
    await tx.query(
      `update mock_funding_accounts
          set pending_holds_cents = greatest(0, pending_holds_cents - $2),
              current_balance_cents = case when kind = 'CREDIT' then current_balance_cents + $3
                                           else greatest(0, current_balance_cents - $3) end
        where id = $1`,
      [fundingAccountId, holdCents, postCents],
    );
  }

  async creditBack(tx: Queryable, fundingAccountId: string, amountCents: number): Promise<void> {
    await tx.query(
      `update mock_funding_accounts
          set current_balance_cents = case when kind = 'CREDIT' then greatest(0, current_balance_cents - $2)
                                           else current_balance_cents + $2 end
        where id = $1`,
      [fundingAccountId, amountCents],
    );
  }
}
