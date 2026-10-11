import { ReclaimedError } from '@reclaimed/shared';
import type { Queryable } from '@reclaimed/database';

export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type JournalType =
  | 'AUTHORIZATION_HOLD'
  | 'AUTHORIZATION_REVERSAL'
  | 'CAPTURE'
  | 'SETTLEMENT'
  | 'REFUND'
  | 'BILL_PAYMENT_HOLD'
  | 'BILL_PAYMENT_RELEASE'
  | 'BILL_PAYMENT_COMPLETION'
  | 'BILL_PAYMENT_RETURN';

export interface LedgerAccountRef {
  code: string;
  name: string;
  type: LedgerAccountType;
  userId?: string | null;
  fundingAccountId?: string | null;
}

export interface JournalLine {
  account: LedgerAccountRef;
  direction: 'DEBIT' | 'CREDIT';
  amountCents: number;
}

export interface JournalInput {
  type: JournalType;
  description: string;
  idempotencyKey: string;
  paymentTransactionId?: string | null;
  billPaymentIntentId?: string | null;
  lines: JournalLine[];
}

/** Well-known system ledger accounts for the simulation. */
export const SYSTEM_ACCOUNTS = {
  pendingMerchantPayable: { code: 'SYS:PENDING_MERCHANT_PAYABLE', name: 'Pending merchant payable (auth holds)', type: 'LIABILITY' },
  merchantPayable: { code: 'SYS:MERCHANT_PAYABLE', name: 'Merchant payable (captured, unsettled)', type: 'LIABILITY' },
  settlementCash: { code: 'SYS:SETTLEMENT_CASH', name: 'Simulated settlement cash', type: 'ASSET' },
  billPayInTransit: { code: 'SYS:BILL_PAY_IN_TRANSIT', name: 'Simulated bill payments in transit', type: 'LIABILITY' },
  issuerRemittance: { code: 'SYS:ISSUER_REMITTANCE', name: 'Simulated issuer remittances (test mode)', type: 'LIABILITY' },
} as const satisfies Record<string, LedgerAccountRef>;

export function fundingHoldsAccount(fundingAccountId: string, name: string, userId: string | null): LedgerAccountRef {
  return { code: `FUNDING_HOLDS:${fundingAccountId}`, name: `Holds — ${name}`, type: 'ASSET', userId, fundingAccountId };
}

export function fundingSpendAccount(fundingAccountId: string, name: string, userId: string | null): LedgerAccountRef {
  return { code: `FUNDING_SPEND:${fundingAccountId}`, name: `Posted activity — ${name}`, type: 'ASSET', userId, fundingAccountId };
}

/**
 * Append-only double-entry ledger for simulated money movement.
 * Every journal is validated as balanced here AND by a deferred constraint
 * trigger in Postgres. Journals are idempotent on idempotencyKey.
 */
export class TransactionLedger {
  async post(tx: Queryable, input: JournalInput): Promise<{ journalId: string; created: boolean }> {
    validateJournal(input);
    const existing = await tx.query<{ id: string }>('select id from ledger_journals where idempotency_key = $1', [
      input.idempotencyKey,
    ]);
    if (existing.rows[0]) return { journalId: existing.rows[0].id, created: false };

    const journal = await tx.query<{ id: string }>(
      `insert into ledger_journals (journal_type, description, payment_transaction_id, bill_payment_intent_id, idempotency_key)
       values ($1, $2, $3, $4, $5) returning id`,
      [input.type, input.description, input.paymentTransactionId ?? null, input.billPaymentIntentId ?? null, input.idempotencyKey],
    );
    const journalId = journal.rows[0]!.id;
    for (const line of input.lines) {
      const accountId = await this.ensureAccount(tx, line.account);
      await tx.query(
        'insert into ledger_entries (journal_id, ledger_account_id, direction, amount_cents) values ($1, $2, $3, $4)',
        [journalId, accountId, line.direction, line.amountCents],
      );
    }
    return { journalId, created: true };
  }

  private async ensureAccount(tx: Queryable, ref: LedgerAccountRef): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `insert into ledger_accounts (code, name, account_type, user_id, mock_funding_account_id)
       values ($1, $2, $3, $4, $5)
       on conflict (code) do update set name = excluded.name
       returning id`,
      [ref.code, ref.name, ref.type, ref.userId ?? null, ref.fundingAccountId ?? null],
    );
    return rows[0]!.id;
  }

  /** Net balance (debits − credits) for an account code. */
  async balance(db: Queryable, code: string): Promise<number> {
    const { rows } = await db.query<{ net: number | null }>(
      `select sum(case when e.direction = 'DEBIT' then e.amount_cents else -e.amount_cents end)::bigint as net
         from ledger_entries e join ledger_accounts a on a.id = e.ledger_account_id
        where a.code = $1`,
      [code],
    );
    return rows[0]?.net ?? 0;
  }

  /** Returns ids of any journals whose debits and credits differ (should always be empty). */
  async findUnbalancedJournals(db: Queryable): Promise<string[]> {
    const { rows } = await db.query<{ journal_id: string }>(
      `select journal_id from ledger_entries group by journal_id
       having sum(case when direction = 'DEBIT' then amount_cents else 0 end)
           <> sum(case when direction = 'CREDIT' then amount_cents else 0 end)`,
    );
    return rows.map((r) => r.journal_id);
  }
}

export function validateJournal(input: JournalInput): void {
  if (input.lines.length < 2) throw new ReclaimedError('INTERNAL_ERROR', 'A journal needs at least two lines.');
  let debits = 0;
  let credits = 0;
  for (const l of input.lines) {
    if (!Number.isInteger(l.amountCents) || l.amountCents <= 0) {
      throw new ReclaimedError('INTERNAL_ERROR', 'Ledger amounts must be positive integer cents.');
    }
    if (l.direction === 'DEBIT') debits += l.amountCents;
    else credits += l.amountCents;
  }
  if (debits !== credits) {
    throw new ReclaimedError('INTERNAL_ERROR', `Unbalanced journal (${debits} debits vs ${credits} credits).`);
  }
}
